from pydantic import BaseModel
from typing import Optional

class QuestionRequest(BaseModel):
    question: str
    chat_id: str
    filename: Optional[str] = None