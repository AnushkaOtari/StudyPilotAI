from fastapi import FastAPI
from models import QuestionRequest
from rag.rag_pipeline import ask_rag

app = FastAPI()

@app.get("/")
def root():
    return {
        "message": "StudyPilot Backend Running"
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