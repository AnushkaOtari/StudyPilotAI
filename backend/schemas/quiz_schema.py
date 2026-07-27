from pydantic import BaseModel
from typing import List

class QuizRequest(BaseModel):
    pdf_name: str
    chat_id: str
    num_questions: int = 10


class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_answer: str
    explanation: str