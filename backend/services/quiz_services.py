import os
import json
from dotenv import load_dotenv
from google import genai

from rag.rag_pipeline import retrieve_context

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GOOGLE_API_KEY")
)

def generate_quiz(pdf_name, chat_id, num_questions=10):

    context, _ = retrieve_context(
        query="Generate quiz from this document",
        chat_id=chat_id,
        filename=pdf_name,
        k=8
    )

    if not context:
        return {
            "error": "No study material found."
        }

    prompt = f"""
You are StudyPilot AI.

You are an expert teacher.

Study Material:

{context}

Generate exactly {num_questions} multiple-choice questions.

Rules:
- Use ONLY the study material above.
- Do NOT invent information.
- Each question must have exactly 4 options.
- Include one correct answer.
- Include a short explanation.
- Return ONLY valid JSON.

Format:

[
  {{
    "question":"...",
    "options":["A","B","C","D"],
    "correct_answer":"...",
    "explanation":"..."
  }}
]
"""

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt
    )

    quiz = response.text.strip()

    quiz = quiz.replace("```json", "")
    quiz = quiz.replace("```", "")
    quiz = quiz.strip()

    return json.loads(quiz)