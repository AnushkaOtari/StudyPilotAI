from fastapi import APIRouter, Depends, HTTPException

from auth.models import User
from auth.router import get_current_user
from schemas.flashcard_schema import FlashcardRequest, FlashcardResponse
from services.flashcard_service import FlashcardError, generate_flashcards

router = APIRouter(prefix="/flashcards", tags=["Flashcards"])


@router.post("/generate", response_model=FlashcardResponse)
def generate_flashcards_route(
    request: FlashcardRequest,
    current_user: User = Depends(get_current_user),
):
    # The user id comes from the login token, never from the request body.
    try:
        flashcards = generate_flashcards(
            pdf_name=request.pdf_name,
            user_id=current_user.id,
            chat_id=request.chat_id,
            num_flashcards=request.num_flashcards,
        )
    except FlashcardError as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except Exception as e:
        print(f"Unexpected error in /flashcards/generate: {e}")
        raise HTTPException(
            status_code=500,
            detail="Something went wrong while generating your flashcards. Please try again.",
        )

    return {"flashcards": flashcards}
