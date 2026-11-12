"""Background processing for Knowledge Graph generation.

A separate single-thread worker with its own queue, so the working PDF
document queue is never touched or slowed down. Nothing in this module can
raise into the document queue: the public hook `trigger_for_completed_job`
swallows every error.

Status is persisted in each document's JSON record (see
knowledge_graph_store), so it survives restarts. Lock order is always
worker lock -> store lock, never the reverse.
"""

import hashlib
import logging
import os
import threading
from collections import deque
from pathlib import PurePath

from services import knowledge_graph_service as kg_service
from services import knowledge_graph_store as store
from services.knowledge_graph_store import (
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_PROCESSING,
)

logger = logging.getLogger(__name__)

# A job that keeps being interrupted (e.g. a PDF that crashes the server)
# is not retried forever.
MAX_ATTEMPTS = 3

INTERRUPTED_MESSAGE = (
    "Graph generation was interrupted by a server restart. "
    "Regenerate it to try again."
)


def _auto_generate_enabled():
    value = os.getenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "1")

    return value.strip().lower() not in ("0", "false", "no", "off")


def _hash_file(path):
    digest = hashlib.sha256()

    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(block)

    return digest.hexdigest()


class _Job:
    def __init__(self, user_id, chat_id, filename, file_path, token):
        self.user_id = str(user_id)
        self.chat_id = str(chat_id)
        self.filename = filename
        self.file_path = file_path
        self.token = token
        self.cancelled = False

    @property
    def key(self):
        return (self.user_id, self.chat_id, self.filename)


class GraphWorker:

    def __init__(self):
        self._cond = threading.Condition(threading.RLock())
        self._queue = deque()
        self._active = {}      # key -> _Job (queued or running)
        self._running = None
        self._thread = None

    # -----------------------------
    # Public API
    # -----------------------------

    def submit(
        self,
        user_id,
        chat_id,
        filename,
        file_path,
        force=False,
        keep_attempts=False
    ):
        """Queue graph generation for one PDF.

        Returns {"accepted": bool, "reason": str, "status": str|None}.
        reason is one of: queued, already_running, up_to_date,
        chat_deleted, file_missing, not_configured.
        """
        key = (str(user_id), str(chat_id), filename)

        if store.is_chat_deleted(user_id, chat_id):
            return self._result(False, "chat_deleted")

        # Token first, then the file check: if the PDF is deleted after
        # this point, its cleanup invalidates this token, so a record for a
        # deleted PDF can never be written.
        token = store.current_token(user_id, chat_id, filename)

        if not os.path.isfile(file_path):
            return self._result(False, "file_missing")

        try:
            content_hash = _hash_file(file_path)
        except OSError:
            return self._result(False, "file_missing")

        with self._cond:

            if key in self._active:
                return self._result(False, "already_running")

            existing = store.read_doc(user_id, chat_id, filename)

            if (
                existing
                and not force
                and existing.get("status") == STATUS_COMPLETED
                and existing.get("graph_hash") == content_hash
            ):
                return self._result(
                    False, "up_to_date", STATUS_COMPLETED
                )

            record = self._new_record(
                user_id, chat_id, filename, file_path,
                content_hash, existing, keep_attempts
            )

            problem = kg_service.gemini_config_error()

            if problem:
                record["status"] = STATUS_FAILED
                record["error"] = problem

                store.save_doc(user_id, chat_id, filename, record, token)

                return self._result(False, "not_configured", STATUS_FAILED)

            job = _Job(user_id, chat_id, filename, file_path, token)

            if not store.save_doc(
                user_id, chat_id, filename, record, token
            ):
                return self._result(False, "chat_deleted")

            self._active[key] = job
            self._queue.append(job)
            self._ensure_thread()
            self._cond.notify_all()

        return self._result(True, "queued", STATUS_PENDING)

    def is_active(self, user_id, chat_id, filename):
        with self._cond:
            return (str(user_id), str(chat_id), filename) in self._active

    def cancel_document(self, user_id, chat_id, filename):
        with self._cond:
            job = self._active.pop(
                (str(user_id), str(chat_id), filename), None
            )

            if job:
                job.cancelled = True

    def cancel_chat(self, user_id, chat_id):
        user_id, chat_id = str(user_id), str(chat_id)

        with self._cond:
            for key in [
                k for k in self._active if k[:2] == (user_id, chat_id)
            ]:
                self._active.pop(key).cancelled = True

    def wait_idle(self, timeout=10):
        """Block until nothing is queued or running (used by tests)."""
        with self._cond:
            return self._cond.wait_for(
                lambda: not self._queue and self._running is None,
                timeout=timeout
            )

    # -----------------------------
    # Internals
    # -----------------------------

    @staticmethod
    def _result(accepted, reason, status=None):
        return {"accepted": accepted, "reason": reason, "status": status}

    @staticmethod
    def _new_record(
        user_id, chat_id, filename, file_path,
        content_hash, existing, keep_attempts
    ):
        existing = existing or {}

        # Keep the last good graph visible while regenerating, but only if
        # it was built from this same PDF content.
        keep_graph = existing.get("graph_hash") == content_hash

        stamp = store.now()

        return {
            "filename": filename,
            "user_id": str(user_id),
            "chat_id": str(chat_id),
            "file_path": file_path,
            "status": STATUS_PENDING,
            "error": None,
            "content_hash": content_hash,
            "graph_hash": existing.get("graph_hash") if keep_graph else None,
            "attempts": existing.get("attempts", 0) if keep_attempts else 0,
            "nodes": existing.get("nodes", []) if keep_graph else [],
            "edges": existing.get("edges", []) if keep_graph else [],
            "stats": existing.get("stats", {}) if keep_graph else {},
            "warnings": [],
            "created_at": existing.get("created_at", stamp),
            "updated_at": stamp,
        }

    def _ensure_thread(self):
        if self._thread is not None and self._thread.is_alive():
            return

        self._thread = threading.Thread(
            target=self._loop,
            name="knowledge-graph-worker",
            daemon=True
        )
        self._thread.start()

    def _loop(self):
        while True:
            with self._cond:
                while not self._queue:
                    self._cond.wait()

                job = self._queue.popleft()

                if job.cancelled:
                    self._cond.notify_all()
                    continue

                self._running = job

            try:
                self._run(job)
            except Exception as e:
                # Never let a bug kill the worker thread.
                logger.error(
                    "Knowledge graph job crashed for %s: %s",
                    job.filename, e, exc_info=True
                )
            finally:
                with self._cond:
                    if self._active.get(job.key) is job:
                        del self._active[job.key]

                    self._running = None
                    self._cond.notify_all()

    def _run(self, job):
        user_id, chat_id, filename = job.user_id, job.chat_id, job.filename

        record = store.read_doc(user_id, chat_id, filename)

        if record is None or job.cancelled:
            return

        attempts = record.get("attempts", 0) + 1

        if attempts > MAX_ATTEMPTS:
            record.update(
                status=STATUS_FAILED,
                error=(
                    "Graph generation was interrupted repeatedly. "
                    "Regenerate it to try again."
                ),
                updated_at=store.now()
            )
            store.save_doc(user_id, chat_id, filename, record, job.token)
            return

        record.update(
            status=STATUS_PROCESSING,
            attempts=attempts,
            error=None,
            updated_at=store.now()
        )

        if not store.save_doc(user_id, chat_id, filename, record, job.token):
            return

        def should_abort():
            return job.cancelled or not store.token_valid(
                user_id, chat_id, filename, job.token
            )

        try:
            result = kg_service.extract_document_graph(
                job.file_path,
                filename,
                kg_service.call_gemini,
                should_abort
            )

        except kg_service.GraphAborted:
            return

        except kg_service.GraphGenerationError as e:
            self._fail(job, record, str(e))
            return

        except Exception as e:
            logger.error(
                "Knowledge graph generation failed for %s: %s",
                filename, e, exc_info=True
            )
            self._fail(
                job, record,
                "Something went wrong while generating the knowledge graph."
            )
            return

        record.update(
            status=STATUS_COMPLETED,
            error=None,
            nodes=result["nodes"],
            edges=result["edges"],
            stats=result["stats"],
            warnings=result["warnings"],
            graph_hash=record.get("content_hash"),
            updated_at=store.now()
        )

        store.save_doc(user_id, chat_id, filename, record, job.token)

    @staticmethod
    def _fail(job, record, message):
        # The last good graph (if any) stays in the record.
        record.update(
            status=STATUS_FAILED,
            error=message,
            updated_at=store.now()
        )

        store.save_doc(
            job.user_id, job.chat_id, job.filename, record, job.token
        )


# -----------------------------
# Module-level singleton and helpers
# -----------------------------

_worker = GraphWorker()


def get_worker():
    return _worker


def trigger_for_completed_job(user_id, chat_id, filename, file_path):
    """Hook called by the document queue after a PDF job COMPLETED.

    Never raises: graph problems must not affect upload or indexing.
    """
    try:
        if not _auto_generate_enabled():
            return

        _worker.submit(user_id, chat_id, filename, file_path)

    except Exception as e:
        logger.warning(
            "Could not start knowledge graph generation for %s: %s",
            filename, e
        )


def delete_document_graph(user_id, chat_id, filename):
    """Cancel any running job for this PDF and delete its graph."""
    _worker.cancel_document(user_id, chat_id, filename)

    return store.delete_doc(user_id, chat_id, filename)


def delete_chat_graphs(user_id, chat_id, permanent=False):
    """Cancel jobs for a chat and delete all of its graph data.

    permanent=True is for real chat deletion: the chat can no longer get
    graph data in this process.
    """
    _worker.cancel_chat(user_id, chat_id)

    return store.clear_chat(user_id, chat_id, permanent=permanent)


def _path_matches_layout(file_path, user_id, chat_id, filename):
    parts = PurePath(file_path).parts

    return (
        len(parts) >= 3
        and parts[-1] == filename
        and parts[-2] == f"chat_{chat_id}"
        and parts[-3] == f"user_{user_id}"
    )


def recover_interrupted_jobs():
    """Run once at startup.

    Records left PENDING/PROCESSING by a previous process are re-queued
    (bounded by MAX_ATTEMPTS), dropped if their PDF is gone, or marked
    FAILED so the user can regenerate. Never raises.
    """
    summary = {"requeued": 0, "failed": 0, "dropped": 0}

    try:
        records = list(store.iter_all_docs())
    except Exception as e:
        logger.warning("Knowledge graph recovery scan failed: %s", e)
        return summary

    for user_id, chat_id, record in records:
        try:
            if record.get("status") not in (
                STATUS_PENDING, STATUS_PROCESSING
            ):
                continue

            filename = record["filename"]
            file_path = record.get("file_path", "")

            if (
                not _path_matches_layout(
                    file_path, user_id, chat_id, filename
                )
                or not os.path.isfile(file_path)
            ):
                store.delete_doc(user_id, chat_id, filename)
                summary["dropped"] += 1
                continue

            if record.get("attempts", 0) >= MAX_ATTEMPTS:
                record.update(
                    status=STATUS_FAILED,
                    error=INTERRUPTED_MESSAGE,
                    updated_at=store.now()
                )
                store.save_doc(
                    user_id, chat_id, filename, record,
                    store.current_token(user_id, chat_id, filename)
                )
                summary["failed"] += 1
                continue

            outcome = _worker.submit(
                user_id, chat_id, filename, file_path,
                force=True, keep_attempts=True
            )

            if outcome["accepted"]:
                summary["requeued"] += 1
            else:
                summary["failed"] += 1

        except Exception as e:
            logger.warning(
                "Knowledge graph recovery failed for one record: %s", e
            )

    return summary
