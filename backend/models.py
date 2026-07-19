from pydantic import BaseModel
from typing import Optional

class QuestionRequest(BaseModel):
    question: str
    filename: Optional[str] = None