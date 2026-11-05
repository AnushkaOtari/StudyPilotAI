import os
import re
from routes.quiz import router as quiz_router

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from models import QuestionRequest
from rag.rag_pipeline import ask_rag, delete_pdf_and_rebuild
from rag.document_queue import global_queue_processor, DocumentJob
from rag.resource_hash_table import global_resource_hash_table
from auth.models import User
from auth.router import get_current_user, router as auth_router

app = FastAPI()

app.include_router(auth_router)
app.include_router(quiz_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Upload Folder
# -----------------------------
# Every authenticated user's chat gets its own subfolder:
# uploads/user_<user_id>/chat_<chat_id>/
# This keeps each chat's PDFs (and therefore its FAISS index, built in
# rag_pipeline.py) physically and logically separate from every other chat.

BASE_UPLOAD_FOLDER = "uploads"
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

os.makedirs(
    BASE_UPLOAD_FOLDER,
    exist_ok=True
)


def get_user_chat_upload_folder(user_id: int, chat_id: str) -> str:
    if not SAFE_SEGMENT_RE.match(chat_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid chat id.",
        )
    folder = os.path.join(BASE_UPLOAD_FOLDER, f"user_{user_id}", f"chat_{chat_id}")
    os.makedirs(folder, exist_ok=True)
    return folder


def safe_upload_path(upload_folder: str, filename: str) -> str:
    basename = os.path.basename(filename)
    if basename != filename or not basename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF filenames are allowed.",
        )
    return os.path.join(upload_folder, basename)

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
    print("StudyPilot backend started. Per-chat vector stores load lazily on first use.")

# -----------------------------
# Upload Multiple PDFs (FIFO Queue)
# -----------------------------

@app.post("/upload")
def upload_pdf(
    chat_id: str = Form(...),
    files: list[UploadFile] = File(None),
    file: UploadFile = File(None),
    current_user: User = Depends(get_current_user),
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

    upload_folder = get_user_chat_upload_folder(current_user.id, chat_id)
    jobs = []

    for uploaded_file in upload_files:
        file_path = safe_upload_path(upload_folder, uploaded_file.filename)
        with open(file_path, "wb") as f:
            f.write(uploaded_file.file.read())

        job = DocumentJob(
            file_path=file_path,
            filename=uploaded_file.filename,
            user_id=current_user.id,
            chat_id=chat_id,
        )
        jobs.append(job)

    # Enqueue jobs in FIFO DocumentQueue and process sequentially
    job_statuses = global_queue_processor.add_jobs(jobs)

    count = len(upload_files)
    msg = f"{count} PDF{'s' if count > 1 else ''} processed via FIFO queue."
    return {
        "message": msg,
        "jobs": job_statuses
    }


@app.get("/upload/status")
def get_upload_status(
    chat_id: str,
    current_user: User = Depends(get_current_user)
):
    """Returns real-time processing status for documents queued in this chat."""
    return global_queue_processor.get_chat_job_statuses(chat_id)


@app.get("/resource/metadata")
def get_resource_metadata(
    filename: str,
    chat_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Performs an O(1) average lookup in the custom ResourceHashTable 
    to retrieve metadata for a specific document resource.
    """
    key = f"{current_user.id}:{chat_id}:{filename}"
    metadata = global_resource_hash_table.get(key)
    if not metadata:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Resource metadata for '{filename}' not found in Hash Table."
        )
    return metadata

# -----------------------------
# List Uploaded PDFs
# -----------------------------

@app.get("/files")
def list_files(chat_id: str, current_user: User = Depends(get_current_user)):
    upload_folder = get_user_chat_upload_folder(current_user.id, chat_id)
    files = [f for f in os.listdir(upload_folder) if f.lower().endswith(".pdf")]
    return files

# -----------------------------
# Delete PDF
# -----------------------------

@app.delete("/files/{filename}")
def delete_file(
    filename: str,
    chat_id: str,
    current_user: User = Depends(get_current_user),
):
    upload_folder = get_user_chat_upload_folder(current_user.id, chat_id)
    safe_upload_path(upload_folder, filename)
    try:
        delete_pdf_and_rebuild(filename, current_user.id, chat_id, upload_folder)
        return {"message": f"{filename} deleted successfully."}
    except Exception as e:
        return {"message": f"Error deleting file: {str(e)}"}

# -----------------------------
# Ask Question
# -----------------------------

@app.post("/ask")
def ask_question(
    data: QuestionRequest,
    current_user: User = Depends(get_current_user),
):

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
