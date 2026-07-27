from fastapi import APIRouter
from schemas.quiz_schema import QuizRequest
from services.quiz_services import generate_quiz

router = APIRouter(prefix="/quiz", tags=["Quiz"])

@router.post("/generate")
def generate_quiz_route(request: QuizRequest):

    quiz = generate_quiz(
        request.pdf_name,
        request.chat_id,
        request.num_questions
    )

    return quiz

