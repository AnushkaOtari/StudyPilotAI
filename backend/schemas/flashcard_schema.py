from typing import List, Optional

from pydantic import BaseModel, Field


class FlashcardRequest(BaseModel):
    chat_id: str
    # Optional: only make flashcards from this one PDF (e.g. "notes.pdf").
    # Leave it out to use every PDF uploaded to the chat.
    pdf_name: Optional[str] = None
    # FastAPI rejects values outside 1-30 automatically (HTTP 422).
    num_flashcards: int = Field(default=10, ge=1, le=30)


class Flashcard(BaseModel):
    question: str
    answer: str


class FlashcardResponse(BaseModel):
    flashcards: List[Flashcard]
