from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from models import QuestionRequest
from rag.rag_pipeline import ask_rag

app = FastAPI()

# Allow React frontend to talk to FastAPI
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

@app.post("/ask")
def ask_question(data: QuestionRequest):
    answer = ask_rag(
    data.question
    )


    return {
        "question": data.question,
        "answer": answer
    }
