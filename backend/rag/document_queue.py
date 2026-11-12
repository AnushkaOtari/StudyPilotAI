
import uuid
import logging
import threading
from collections import deque
from typing import List, Dict, Optional, Tuple

from rag.rag_pipeline import load_pdf

logger = logging.getLogger(__name__)


def _trigger_graph_generation(job) -> None:
    """
    Ask the independent Knowledge Graph worker to process a PDF whose
    indexing just completed.

    This only hands the job over; it never raises, so a graph problem
    can never fail or delay PDF indexing.
    """
    try:
        from services.knowledge_graph_worker import (
            trigger_for_completed_job
        )

        trigger_for_completed_job(
            job.user_id,
            job.chat_id,
            job.filename,
            job.file_path
        )

    except Exception as e:
        logger.warning(
            f"Knowledge graph was not started for {job.filename}: {e}"
        )


class DocumentJob:
    """
    Represents a single document processing job.
    """

    def __init__(
        self,
        file_path: str,
        filename: str,
        user_id: int,
        chat_id: str
    ):
        self.job_id: str = str(uuid.uuid4())
        self.file_path: str = file_path
        self.filename: str = filename
        self.user_id: int = user_id
        self.chat_id: str = chat_id
        self.status: str = "WAITING"
        self.error: Optional[str] = None

    def to_dict(self) -> Dict:
        return {
            "job_id": self.job_id,
            "filename": self.filename,
            "user_id": self.user_id,
            "chat_id": self.chat_id,
            "status": self.status,
            "error": self.error,
        }


class DocumentQueue:
    """
    FIFO document processing queue.
    """

    def __init__(self):
        self._queue = deque()

    def enqueue(self, job: DocumentJob) -> None:
        self._queue.append(job)

    def dequeue(self) -> Optional[DocumentJob]:
        if not self._queue:
            return None
        return self._queue.popleft()

    def is_empty(self) -> bool:
        return len(self._queue) == 0

    def size(self) -> int:
        return len(self._queue)


class QueueProcessor:
    """
    Processes PDF jobs sequentially and safely.
    """

    def __init__(self):
        self.queue = DocumentQueue()

        # Jobs are separated by user and chat
        self.jobs_by_chat: Dict[
            Tuple[int, str], List[DocumentJob]
        ] = {}

        self.is_processing = False

        # Thread synchronization
        self.lock = threading.RLock()
        self.processing_done = threading.Event()
        self.processing_done.set()

        # Chats marked for permanent deletion
        self.deleted_chats = set()

    def add_jobs(self, jobs: List[DocumentJob]) -> List[Dict]:
        """
        Add jobs safely and process them in FIFO order.
        """

        with self.lock:

            # Validate all jobs before adding any
            for job in jobs:
                chat_key = (job.user_id, job.chat_id)

                if chat_key in self.deleted_chats:
                    raise ValueError(
                        "This chat has been deleted."
                    )

            for job in jobs:
                chat_key = (job.user_id, job.chat_id)

                if chat_key not in self.jobs_by_chat:
                    self.jobs_by_chat[chat_key] = []

                self.jobs_by_chat[chat_key].append(job)
                self.queue.enqueue(job)

        self.process_queue()

        return [job.to_dict() for job in jobs]

    def process_queue(self):
        """
        Process queued jobs sequentially and safely.
        """

        with self.lock:
            if self.is_processing:
                return

            self.is_processing = True
            self.processing_done.clear()

        while True:

            with self.lock:
                job = self.queue.dequeue()

                if job is None:
                    self.is_processing = False
                    self.processing_done.set()
                    return

                chat_key = (job.user_id, job.chat_id)

                if chat_key in self.deleted_chats:
                    job.status = "CANCELLED"
                    continue

                job.status = "PROCESSING"

            logger.info(
                f"Processing PDF job: {job.filename} "
                f"for chat {job.chat_id}"
            )

            try:
                load_pdf(
                    job.file_path,
                    job.user_id,
                    job.chat_id
                )

                with self.lock:
                    if chat_key in self.deleted_chats:
                        job.status = "CANCELLED"
                    else:
                        job.status = "COMPLETED"

                logger.info(
                    f"Finished PDF job: {job.filename}"
                )

                if job.status == "COMPLETED":
                    _trigger_graph_generation(job)

            except Exception as e:

                with self.lock:
                    job.status = "FAILED"
                    job.error = str(e)

                logger.error(
                    f"Failed to process PDF {job.filename}: {e}",
                    exc_info=True
                )

    def cancel_chat(self, user_id: int, chat_id: str):
        """
        Mark a chat as deleted, cancel waiting jobs,
        and wait for active queue processing to finish.
        """

        chat_key = (user_id, chat_id)

        with self.lock:

            # Prevent new jobs from entering this chat
            self.deleted_chats.add(chat_key)

            # Cancel waiting jobs for this chat
            remaining_jobs = deque()

            while self.queue._queue:
                job = self.queue._queue.popleft()

                if (job.user_id, job.chat_id) == chat_key:
                    job.status = "CANCELLED"
                else:
                    remaining_jobs.append(job)

            self.queue._queue = remaining_jobs

        # Wait until the processing loop finishes.
        # This also allows an active job to finish before
        # the chat's files and vectorstore are deleted.
        self.processing_done.wait()

        with self.lock:
            self.jobs_by_chat.pop(chat_key, None)

        logger.info(
            f"Cancelled all document jobs for "
            f"user {user_id}, chat {chat_id}"
        )

    def get_chat_job_statuses(
        self,
        user_id: int,
        chat_id: str
    ) -> List[Dict]:
        """
        Return job statuses for a specific user's chat.
        """

        chat_key = (user_id, chat_id)

        with self.lock:
            jobs = self.jobs_by_chat.get(chat_key, [])
            return [job.to_dict() for job in jobs]

    def clear_chat_jobs(self, user_id: int, chat_id: str):
        """
        Clear job history for a specific user's chat.
        """

        chat_key = (user_id, chat_id)

        with self.lock:
            self.jobs_by_chat.pop(chat_key, None)


global_queue_processor = QueueProcessor()
