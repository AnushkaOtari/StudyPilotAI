from pydantic import BaseModel
from typing import List, Optional

class QuizRequest(BaseModel):
    pdf_name: Optional[str] = None
    chat_id: str
    num_questions: int = 10
    difficulty: Optional[str] = "mixed"
    question_type: Optional[str] = "mixed"


class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_answer: str
    explanation: str


class QuizFeedbackRequest(BaseModel):
    results: List[dict]