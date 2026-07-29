from fastapi import APIRouter
from schemas.quiz_schema import QuizRequest, QuizFeedbackRequest
from services.quiz_services import generate_quiz, get_quiz_feedback

router = APIRouter(prefix="/quiz", tags=["Quiz"])

@router.post("/generate")
def generate_quiz_route(request: QuizRequest):

    quiz = generate_quiz(
        pdf_name=request.pdf_name,
        chat_id=request.chat_id,
        num_questions=request.num_questions,
        difficulty=request.difficulty,
        question_type=request.question_type
    )

    return quiz

@router.post("/feedback")
def quiz_feedback_route(request: QuizFeedbackRequest):
    feedback = get_quiz_feedback(request.results)
    return {"feedback": feedback}

