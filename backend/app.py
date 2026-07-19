import os

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from models import QuestionRequest
from rag.rag_pipeline import ask_rag, load_pdf, delete_pdf_and_rebuild

app = FastAPI()

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

UPLOAD_FOLDER = "uploads"

os.makedirs(
    UPLOAD_FOLDER,
    exist_ok=True
)

# -----------------------------
# Home Route
# -----------------------------

@app.get("/")
def root():
    return {
        "message": "StudyPilot Backend Running"
    }

# -----------------------------
# -----------------------------
# Startup Event
# -----------------------------

@app.on_event("startup")
def startup_event():
    print("Scanning uploads directory on startup...")
    if os.path.exists(UPLOAD_FOLDER):
        for filename in os.listdir(UPLOAD_FOLDER):
            if filename.lower().endswith(".pdf"):
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                try:
                    load_pdf(file_path)
                except Exception as e:
                    print(f"Error loading {filename} on startup: {e}")

# -----------------------------
# Upload PDF
# -----------------------------

@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)):

    file_path = os.path.join(
        UPLOAD_FOLDER,
        file.filename
    )

    with open(file_path, "wb") as f:
        f.write(file.file.read())

    load_pdf(file_path)

    return {
        "message": f"{file.filename} uploaded and indexed successfully."
    }

# -----------------------------
# List Uploaded PDFs
# -----------------------------

@app.get("/files")
def list_files():
    if not os.path.exists(UPLOAD_FOLDER):
        return []
    files = [f for f in os.listdir(UPLOAD_FOLDER) if f.lower().endswith(".pdf")]
    return files

# -----------------------------
# Delete PDF
# -----------------------------

@app.delete("/files/{filename}")
def delete_file(filename: str):
    try:
        delete_pdf_and_rebuild(filename, UPLOAD_FOLDER)
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
        filename=data.filename
    )

    return {
        "question": data.question,
        "answer": response["answer"],
        "sources": response["sources"]
    }