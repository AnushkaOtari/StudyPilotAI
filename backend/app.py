
import os
import re
import shutil
from urllib.parse import quote

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form,
    status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from models import QuestionRequest

from routes.quiz import router as quiz_router
from routes.flashcard import router as flashcard_router

from rag.rag_pipeline import (
    ask_rag,
    delete_pdf_and_rebuild,
    delete_chat_data,
    mark_chat_deleting,
    is_chat_deleting
)

from rag.document_queue import (
    global_queue_processor,
    DocumentJob
)

from rag.resource_hash_table import global_resource_hash_table

from auth.models import User
from auth.router import (
    get_current_user,
    router as auth_router
)


# -----------------------------
# FastAPI Application
# -----------------------------

app = FastAPI()

app.include_router(auth_router)
app.include_router(quiz_router)
app.include_router(flashcard_router)


# -----------------------------
# CORS
# -----------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------
# Upload Configuration
# -----------------------------

BASE_UPLOAD_FOLDER = "uploads"

SAFE_SEGMENT_RE = re.compile(
    r"^[A-Za-z0-9_-]+$"
)

os.makedirs(
    BASE_UPLOAD_FOLDER,
    exist_ok=True
)


# -----------------------------
# Validation Helpers
# -----------------------------

def validate_chat_id(chat_id: str):
    """Validate chat ID before using it in filesystem paths."""

    if not SAFE_SEGMENT_RE.fullmatch(str(chat_id)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat id."
        )


def get_user_chat_upload_folder(
    user_id: int,
    chat_id: str
) -> str:

    validate_chat_id(chat_id)

    if is_chat_deleting(user_id, chat_id):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This chat has been deleted."
        )

    folder = os.path.join(
        BASE_UPLOAD_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )

    os.makedirs(
        folder,
        exist_ok=True
    )

    return folder


def safe_upload_path(
    upload_folder: str,
    filename: str
) -> str:

    basename = os.path.basename(filename)

    if (
        basename != filename
        or not basename.lower().endswith(".pdf")
    ):

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF filenames are allowed."
        )

    return os.path.join(
        upload_folder,
        basename
    )


def resolve_user_pdf_path(
    user_id: int,
    chat_id: str,
    filename: str
) -> str:

    """
    Return the real path of one PDF belonging to this user's chat.

    The path is built using the authenticated user ID,
    validated chat ID and validated PDF filename.
    """

    validate_chat_id(chat_id)

    if is_chat_deleting(user_id, chat_id):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This chat has been deleted."
        )

    folder = os.path.join(
        BASE_UPLOAD_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )

    candidate = safe_upload_path(
        folder,
        filename
    )

    real_folder = os.path.realpath(folder)
    real_path = os.path.realpath(candidate)

    if (
        os.path.dirname(real_path) != real_folder
        or not os.path.isfile(real_path)
    ):

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found in this chat."
        )

    return real_path


# -----------------------------
# Home Route
# -----------------------------

@app.get("/")
def root():

    return {
        "message": "StudyPilot Backend Running"
    }


# -----------------------------
# Startup Event
# -----------------------------

@app.on_event("startup")
def startup_event():

    print(
        "StudyPilot backend started. "
        "Per-chat vector stores load lazily on first use."
    )


# -----------------------------
# Upload Multiple PDFs
# -----------------------------

@app.post("/upload")
def upload_pdf(

    chat_id: str = Form(...),

    files: list[UploadFile] = File(None),

    file: UploadFile = File(None),

    current_user: User = Depends(get_current_user)

):

    upload_files = []

    if files:
        upload_files.extend(files)

    if file:
        upload_files.append(file)

    if not upload_files:

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No PDF files provided."
        )

    upload_folder = get_user_chat_upload_folder(
        current_user.id,
        chat_id
    )

    jobs = []

    for uploaded_file in upload_files:

        file_path = safe_upload_path(
            upload_folder,
            uploaded_file.filename
        )

        with open(file_path, "wb") as f:

            f.write(
                uploaded_file.file.read()
            )

        job = DocumentJob(
            file_path=file_path,
            filename=uploaded_file.filename,
            user_id=current_user.id,
            chat_id=chat_id
        )

        jobs.append(job)

    # Enqueue jobs in FIFO DocumentQueue.
    # The queue also rejects chats already marked deleted.

    try:

        job_statuses = global_queue_processor.add_jobs(
            jobs
        )

    except ValueError as e:

        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=str(e)
        )

    count = len(upload_files)

    msg = (
        f"{count} PDF{'s' if count > 1 else ''} "
        "processed via FIFO queue."
    )

    return {
        "message": msg,
        "jobs": job_statuses
    }


# -----------------------------
# Upload Processing Status
# -----------------------------

@app.get("/upload/status")
def get_upload_status(

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    validate_chat_id(chat_id)

    if is_chat_deleting(current_user.id, chat_id):

        return []

    return global_queue_processor.get_chat_job_statuses(
        current_user.id,
        chat_id
    )


# -----------------------------
# Resource Metadata
# -----------------------------

@app.get("/resource/metadata")
def get_resource_metadata(

    filename: str,

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    validate_chat_id(chat_id)

    if is_chat_deleting(current_user.id, chat_id):

        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="This chat has been deleted."
        )

    key = (
        f"{current_user.id}:"
        f"{chat_id}:"
        f"{filename}"
    )

    metadata = global_resource_hash_table.get(key)

    if not metadata:

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"Resource metadata for '{filename}' "
                "not found in Hash Table."
            )
        )

    return metadata


# -----------------------------
# List Uploaded PDFs
# -----------------------------

@app.get("/files")
def list_files(

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    upload_folder = get_user_chat_upload_folder(
        current_user.id,
        chat_id
    )

    files = [
        f
        for f in os.listdir(upload_folder)
        if f.lower().endswith(".pdf")
    ]

    return files


# -----------------------------
# View PDF
# -----------------------------

@app.get("/files/{filename}")
def get_file(

    filename: str,

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    path = resolve_user_pdf_path(
        current_user.id,
        chat_id,
        filename
    )

    return FileResponse(
        path,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"inline; filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# -----------------------------
# Delete One PDF
# -----------------------------

@app.delete("/files/{filename}")
def delete_file(

    filename: str,

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    upload_folder = get_user_chat_upload_folder(
        current_user.id,
        chat_id
    )

    file_path = safe_upload_path(
        upload_folder,
        filename
    )

    if not os.path.isfile(file_path):

        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="PDF not found."
        )

    try:

        delete_pdf_and_rebuild(
            filename,
            current_user.id,
            chat_id,
            upload_folder
        )

        return {
            "message": f"{filename} deleted successfully."
        }

    except Exception as e:

        print(
            f"Error deleting PDF {filename}: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting file: {str(e)}"
        )


# -----------------------------
# Delete Entire Chat
# -----------------------------

@app.delete("/chats/{chat_id}")
def delete_chat(

    chat_id: str,

    current_user: User = Depends(get_current_user)

):

    """
    Permanently delete all backend data belonging to a chat.

    Steps:
    1. Validate authenticated user and chat ID.
    2. Mark chat as deleting.
    3. Cancel queued jobs and wait for processing.
    4. Delete RAG/vectorstore data.
    5. Delete uploaded PDFs.
    6. Remove empty parent directories.
    """

    validate_chat_id(chat_id)

    user_id = current_user.id

    # Build paths using only authenticated user ID
    # and validated chat ID.

    upload_folder = os.path.join(
        BASE_UPLOAD_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )

    user_folder = os.path.join(
        BASE_UPLOAD_FOLDER,
        f"user_{user_id}"
    )

    try:

        # Step 1:
        # Mark chat as deleted before cancelling jobs.
        # This prevents new RAG indexing.

        mark_chat_deleting(
            user_id,
            chat_id
        )

        # Step 2:
        # Cancel waiting jobs and wait for active queue
        # processing to finish.

        global_queue_processor.cancel_chat(
            user_id,
            chat_id
        )

        # Step 3:
        # Remove vectorstore, cached data, history
        # and resource metadata.

        delete_chat_data(
            user_id,
            chat_id
        )

        # Step 4:
        # Safely remove the chat's upload directory.

        real_base = os.path.realpath(
            BASE_UPLOAD_FOLDER
        )

        real_upload_folder = os.path.realpath(
            upload_folder
        )

        if (
            os.path.commonpath([
                real_base,
                real_upload_folder
            ]) != real_base
        ):

            raise ValueError(
                "Invalid upload folder path."
            )

        if os.path.isdir(real_upload_folder):

            shutil.rmtree(
                real_upload_folder
            )

        # Step 5:
        # Remove empty user upload directory.

        if (
            os.path.isdir(user_folder)
            and not os.listdir(user_folder)
        ):

            os.rmdir(user_folder)

        # Step 6:
        # Clear any remaining job history.

        global_queue_processor.clear_chat_jobs(
            user_id,
            chat_id
        )

        print(
            f"Successfully deleted chat {chat_id} "
            f"for user {user_id}"
        )

        return {
            "success": True,
            "message": "Chat and all associated data deleted successfully.",
            "chat_id": chat_id
        }

    except Exception as e:

        print(
            f"Error deleting chat {chat_id}: {e}"
        )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting chat: {str(e)}"
        )


# -----------------------------
# Ask Question
# -----------------------------

@app.post("/ask")
def ask_question(

    data: QuestionRequest,

    current_user: User = Depends(get_current_user)

):

    validate_chat_id(data.chat_id)

    response = ask_rag(
        data.question,
        user_id=current_user.id,
        chat_id=data.chat_id,
        filename=data.filename
    )

    return {
        "question": data.question,
        "answer": response["answer"],
        "sources": response["sources"],
        "citations": response.get("citations", [])
    }