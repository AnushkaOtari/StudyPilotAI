import os
from routes.quiz import router as quiz_router

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from models import QuestionRequest
from rag.rag_pipeline import ask_rag, load_pdf, delete_pdf_and_rebuild
from auth.router import router as auth_router

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
# Every chat gets its own subfolder: uploads/chat_<chat_id>/
# This keeps each chat's PDFs (and therefore its FAISS index, built in
# rag_pipeline.py) physically and logically separate from every other chat.

BASE_UPLOAD_FOLDER = "uploads"

os.makedirs(
    BASE_UPLOAD_FOLDER,
    exist_ok=True
)


def get_chat_upload_folder(chat_id: str) -> str:
    folder = os.path.join(BASE_UPLOAD_FOLDER, f"chat_{chat_id}")
    os.makedirs(folder, exist_ok=True)
    return folder

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
# (vectorstores/chat_<id>/) by rag_pipeline.load_pdf(), and is loaded lazily
# from disk the first time that chat is used (see rag_pipeline._get_store).
# This avoids re-embedding every PDF, for every chat, on every restart.

@app.on_event("startup")
def startup_event():
    print("StudyPilot backend started. Per-chat vector stores load lazily on first use.")

# -----------------------------
# Upload PDF
# -----------------------------

@app.post("/upload")
def upload_pdf(chat_id: str = Form(...), file: UploadFile = File(...)):

    upload_folder = get_chat_upload_folder(chat_id)

    file_path = os.path.join(
        upload_folder,
        file.filename
    )

    with open(file_path, "wb") as f:
        f.write(file.file.read())

    load_pdf(file_path, chat_id)

    return {
        "message": f"{file.filename} uploaded and indexed successfully."
    }

# -----------------------------
# List Uploaded PDFs
# -----------------------------

@app.get("/files")
def list_files(chat_id: str):
    upload_folder = get_chat_upload_folder(chat_id)
    files = [f for f in os.listdir(upload_folder) if f.lower().endswith(".pdf")]
    return files

# -----------------------------
# Delete PDF
# -----------------------------

@app.delete("/files/{filename}")
def delete_file(filename: str, chat_id: str):
    upload_folder = get_chat_upload_folder(chat_id)
    try:
        delete_pdf_and_rebuild(filename, chat_id, upload_folder)
        return {"message": f"{filename} deleted successfully."}
    except Exception as e:
        return {"message": f"Error deleting file: {str(e)}"}

# -----------------------------
# Ask Question
# -----------------------------

@app.post("/ask")
def ask_question(data: QuestionRequest):

    response = ask_rag(
        data.question,
        chat_id=data.chat_id,
        filename=data.filename
    )

    return {
        "question": data.question,
        "answer": response["answer"],
        "sources": response["sources"]
    }
