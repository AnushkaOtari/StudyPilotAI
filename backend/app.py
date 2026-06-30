from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from models import QuestionRequest
from rag.rag_pipeline import ask_rag,load_pdf

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {
        "message": "StudyPilot Backend Running"
    }


@app.post("/upload")
def upload_pdf(file: UploadFile = File(...)):

    with open("uploaded.pdf", "wb") as f:
        f.write(file.file.read())

    load_pdf("uploaded.pdf")

    return {
        "message": "PDF uploaded and indexed successfully"
    }

@app.post("/ask")
def ask_question(data: QuestionRequest):

    answer = ask_rag(
        data.question
    )

    return {
        "question": data.question,
        "answer": answer
    }