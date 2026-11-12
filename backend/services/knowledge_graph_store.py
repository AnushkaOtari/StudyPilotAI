"""On-disk storage for Knowledge Graph data.

Layout (relative to the working directory, like uploads/ and vectorstores/):

    knowledge_graphs/user_<user_id>/chat_<chat_id>/docs/<doc_id>.json

One JSON file per PDF. The chat-level graph is merged from these files when it
is requested (see knowledge_graph_service.merge_documents), so deleting a PDF's
graph is just deleting its file.

This module has NO dependency on FAISS or the RAG pipeline.

Race protection
---------------
A background job must never recreate data that was deleted while it ran. Every
write goes through `save_doc`, which, under one lock, checks:

  * the chat has not been permanently deleted, and
  * the "epoch" captured when the job was created is still current.

Deleting a PDF's graph bumps that document's epoch; clearing a chat bumps the
chat's epoch (and, for a real chat deletion, marks the chat as deleted). Any
in-flight job then finds its token stale and its write is refused.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import threading
import time
from typing import Dict, Iterator, List, Optional, Tuple

logger = logging.getLogger(__name__)

GRAPH_FOLDER = "knowledge_graphs"
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# Document statuses stored on disk.
STATUS_PENDING = "PENDING"
STATUS_PROCESSING = "PROCESSING"
STATUS_COMPLETED = "COMPLETED"
STATUS_FAILED = "FAILED"
# Reported (never stored) for a PDF that has no graph record yet.
STATUS_NOT_STARTED = "NOT_STARTED"

IN_PROGRESS_STATUSES = (STATUS_PENDING, STATUS_PROCESSING)

_lock = threading.RLock()

# Chats permanently deleted in this process (mirrors rag_pipeline._deleting_chats).
_deleted_chats = set()
_chat_epochs: Dict[Tuple[str, str], int] = {}
_doc_epochs: Dict[Tuple[str, str, str], int] = {}


# -----------------------------
# Paths
# -----------------------------

def _safe_segment(value, name):
    value = str(value)

    if not SAFE_SEGMENT_RE.match(value):
        raise ValueError(f"Invalid {name}.")

    return value


def _chat_key(user_id, chat_id):
    return (str(user_id), str(chat_id))


def chat_folder(user_id, chat_id):
    user_id = _safe_segment(user_id, "user id")
    chat_id = _safe_segment(chat_id, "chat id")

    return os.path.join(
        GRAPH_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )


def _docs_folder(user_id, chat_id):
    return os.path.join(chat_folder(user_id, chat_id), "docs")


def doc_id(filename):
    """Stable, filesystem-safe id for a PDF filename."""
    return hashlib.sha256(
        str(filename).encode("utf-8")
    ).hexdigest()[:24]


def _doc_path(user_id, chat_id, filename):
    return os.path.join(
        _docs_folder(user_id, chat_id),
        f"{doc_id(filename)}.json"
    )


# -----------------------------
# Epoch tokens (race protection)
# -----------------------------

def current_token(user_id, chat_id, filename):
    """Snapshot to attach to a job; see module docstring."""
    ck = _chat_key(user_id, chat_id)

    with _lock:
        return (
            _chat_epochs.get(ck, 0),
            _doc_epochs.get(ck + (doc_id(filename),), 0),
        )


def token_valid(user_id, chat_id, filename, token):
    ck = _chat_key(user_id, chat_id)

    with _lock:
        if ck in _deleted_chats:
            return False

        return token == (
            _chat_epochs.get(ck, 0),
            _doc_epochs.get(ck + (doc_id(filename),), 0),
        )


def is_chat_deleted(user_id, chat_id):
    with _lock:
        return _chat_key(user_id, chat_id) in _deleted_chats


# -----------------------------
# Read
# -----------------------------

def read_doc(user_id, chat_id, filename) -> Optional[dict]:
    path = _doc_path(user_id, chat_id, filename)

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(
            "Unreadable knowledge graph record %s: %s", path, e
        )
        return None

    return data if isinstance(data, dict) else None


def list_docs(user_id, chat_id) -> List[dict]:
    folder = _docs_folder(user_id, chat_id)

    try:
        names = sorted(os.listdir(folder))
    except FileNotFoundError:
        return []

    records = []

    for name in names:
        if not name.endswith(".json"):
            continue

        try:
            with open(
                os.path.join(folder, name), "r", encoding="utf-8"
            ) as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning(
                "Skipping unreadable knowledge graph record %s: %s",
                name, e
            )
            continue

        if isinstance(data, dict) and data.get("filename"):
            records.append(data)

    return records


def iter_all_docs() -> Iterator[Tuple[str, str, dict]]:
    """Yield (user_id, chat_id, record) for every stored record.

    Used only for crash recovery at startup.
    """
    if not os.path.isdir(GRAPH_FOLDER):
        return

    for user_dir in sorted(os.listdir(GRAPH_FOLDER)):
        if not user_dir.startswith("user_"):
            continue

        user_id = user_dir[len("user_"):]
        user_path = os.path.join(GRAPH_FOLDER, user_dir)

        if not os.path.isdir(user_path):
            continue

        for chat_dir in sorted(os.listdir(user_path)):
            if not chat_dir.startswith("chat_"):
                continue

            chat_id = chat_dir[len("chat_"):]

            if not (
                SAFE_SEGMENT_RE.match(user_id)
                and SAFE_SEGMENT_RE.match(chat_id)
            ):
                continue

            for record in list_docs(user_id, chat_id):
                yield user_id, chat_id, record


# -----------------------------
# Write / delete
# -----------------------------

def save_doc(user_id, chat_id, filename, record, token) -> bool:
    """Atomically write a record. Returns False (writing nothing) if the
    chat was deleted or the token is stale."""

    path = _doc_path(user_id, chat_id, filename)

    with _lock:
        if not token_valid(user_id, chat_id, filename, token):
            return False

        os.makedirs(os.path.dirname(path), exist_ok=True)

        tmp_path = f"{path}.{threading.get_ident()}.tmp"

        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False)

            os.replace(tmp_path, path)
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    return True


def delete_doc(user_id, chat_id, filename) -> bool:
    """Delete one PDF's graph record and invalidate in-flight jobs for it.

    Returns True if a record existed.
    """
    ck = _chat_key(user_id, chat_id)
    path = _doc_path(user_id, chat_id, filename)

    with _lock:
        key = ck + (doc_id(filename),)
        _doc_epochs[key] = _doc_epochs.get(key, 0) + 1

        existed = os.path.exists(path)

        if existed:
            os.remove(path)

    return existed


def clear_chat(user_id, chat_id, permanent=False) -> bool:
    """Delete every graph record of a chat.

    permanent=True is used when the whole chat is deleted: the chat is also
    marked deleted so nothing can be written for it again in this process.
    Returns True if a folder was removed.
    """
    ck = _chat_key(user_id, chat_id)
    folder = chat_folder(user_id, chat_id)

    with _lock:
        if permanent:
            _deleted_chats.add(ck)

        _chat_epochs[ck] = _chat_epochs.get(ck, 0) + 1

        removed = False

        real_base = os.path.realpath(GRAPH_FOLDER)
        real_folder = os.path.realpath(folder)

        if os.path.commonpath([real_base, real_folder]) != real_base:
            raise ValueError("Invalid knowledge graph folder path.")

        if os.path.isdir(real_folder):
            shutil.rmtree(real_folder)
            removed = True

        user_folder = os.path.dirname(folder)

        if os.path.isdir(user_folder) and not os.listdir(user_folder):
            os.rmdir(user_folder)

    return removed


def now():
    return time.time()
