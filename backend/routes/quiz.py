from fastapi import APIRouter, Depends
from auth.models import User
from auth.router import get_current_user
from schemas.quiz_schema import QuizRequest, QuizFeedbackRequest
from services.quiz_services import generate_quiz, get_quiz_feedback

router = APIRouter(prefix="/quiz", tags=["Quiz"])

@router.post("/generate")
def generate_quiz_route(
    request: QuizRequest,
    current_user: User = Depends(get_current_user),
):

    try:
        quiz = generate_quiz(
            pdf_name=request.pdf_name,
            user_id=current_user.id,
            chat_id=request.chat_id,
            num_questions=request.num_questions,
            difficulty=request.difficulty,
            question_type=request.question_type
        )
    except Exception as e:
        print(f"Unexpected error in /quiz/generate: {e}")
        return {
            "error": "Something went wrong while generating your quiz. Please try again."
        }

    return quiz

@router.post("/feedback")
def quiz_feedback_route(request: QuizFeedbackRequest):
    try:
        feedback = get_quiz_feedback(request.results)
    except Exception as e:
        print(f"Unexpected error in /quiz/feedback: {e}")
        return {"feedback": "Great effort! Keep reviewing your study materials to strengthen your understanding."}
    return {"feedback": feedback}

