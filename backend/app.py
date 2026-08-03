import os
import re
from routes.quiz import router as quiz_router

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from models import QuestionRequest
from rag.rag_pipeline import ask_rag, load_pdf, delete_pdf_and_rebuild
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
# NOTE: We no longer eagerly re-parse/re-embed every PDF on startup. Each
# chat's FAISS index + document metadata is now persisted to disk
# (vectorstores/user_<user_id>/chat_<id>/) by rag_pipeline.load_pdf(), and is loaded lazily
# from disk the first time that chat is used (see rag_pipeline._get_store).
# This avoids re-embedding every PDF, for every chat, on every restart.

@app.on_event("startup")
def startup_event():
    print("StudyPilot backend started. Per-chat vector stores load lazily on first use.")

# -----------------------------
# Upload PDF
# -----------------------------

@app.post("/upload")
def upload_pdf(
    chat_id: str = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):

    upload_folder = get_user_chat_upload_folder(current_user.id, chat_id)

    file_path = safe_upload_path(upload_folder, file.filename)

    with open(file_path, "wb") as f:
        f.write(file.file.read())

    load_pdf(file_path, current_user.id, chat_id)

    return {
        "message": f"{file.filename} uploaded successfully."
    }

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
        "sources": response["sources"]
    }
