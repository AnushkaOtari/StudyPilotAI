import uuid
import logging
from collections import deque
from typing import List, Dict, Optional
from rag.rag_pipeline import load_pdf

logger = logging.getLogger(__name__)


class DocumentJob:
    """
    Represents a single document processing job in the queue.
    """
    def __init__(self, file_path: str, filename: str, user_id: int, chat_id: str):
        self.job_id: str = str(uuid.uuid4())
        self.file_path: str = file_path
        self.filename: str = filename
        self.user_id: int = user_id
        self.chat_id: str = chat_id
        self.status: str = "WAITING"  # WAITING, PROCESSING, COMPLETED, FAILED
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
    A FIFO (First-In, First-Out) Document Processing Queue implemented using collections.deque.
    Complexity:
      enqueue  -> O(1)
      dequeue  -> O(1)
      is_empty -> O(1)
      size     -> O(1)
    """

    def __init__(self):
        self._queue = deque()

    def enqueue(self, job: DocumentJob) -> None:
        """Add a job to the end of the queue. O(1)"""
        self._queue.append(job)

    def dequeue(self) -> Optional[DocumentJob]:
        """Remove and return the job at the front of the queue. O(1)"""
        if self.is_empty():
            return None
        return self._queue.popleft()

    def is_empty(self) -> bool:
        """Check if the queue is empty. O(1)"""
        return len(self._queue) == 0

    def size(self) -> int:
        """Return the number of items currently in the queue. O(1)"""
        return len(self._queue)


class QueueProcessor:
    """
    Manages document processing queues and executes document indexing jobs
    sequentially in strict FIFO order using the existing RAG load_pdf() pipeline.
    """

    def __init__(self):
        self.queue = DocumentQueue()
        self.jobs_by_chat: Dict[str, List[DocumentJob]] = {}
        self.is_processing = False

    def add_jobs(self, jobs: List[DocumentJob]) -> List[Dict]:
        """Enqueues new jobs and processes them in FIFO order."""
        for job in jobs:
            if job.chat_id not in self.jobs_by_chat:
                self.jobs_by_chat[job.chat_id] = []
            self.jobs_by_chat[job.chat_id].append(job)
            self.queue.enqueue(job)

        self.process_queue()
        return [job.to_dict() for job in jobs]

    def process_queue(self):
        """Processes all jobs in the queue sequentially in FIFO order."""
        if self.is_processing:
            return

        self.is_processing = True
        try:
            while not self.queue.is_empty():
                job = self.queue.dequeue()
                if job is None:
                    break

                job.status = "PROCESSING"
                logger.info(f"Processing PDF job: {job.filename} for chat {job.chat_id}")

                try:
                    # Reuse existing RAG pipeline load_pdf() function
                    load_pdf(job.file_path, job.user_id, job.chat_id)
                    job.status = "COMPLETED"
                    logger.info(f"Successfully processed PDF: {job.filename}")
                except Exception as e:
                    job.status = "FAILED"
                    job.error = str(e)
                    logger.error(f"Failed to process PDF {job.filename}: {e}", exc_info=True)
        finally:
            self.is_processing = False

    def get_chat_job_statuses(self, chat_id: str) -> List[Dict]:
        """Returns the processing status of all jobs for a specific chat."""
        jobs = self.jobs_by_chat.get(chat_id, [])
        return [job.to_dict() for job in jobs]

    def clear_chat_jobs(self, chat_id: str):
        """Clears job status history for a chat."""
        if chat_id in self.jobs_by_chat:
            del self.jobs_by_chat[chat_id]


global_queue_processor = QueueProcessor()
