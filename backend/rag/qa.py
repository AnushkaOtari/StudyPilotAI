import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


def answer_question(question, context, chat_history, mode):

    if mode == "short":
        instruction = """
Answer in 3-5 lines.
Explain simply.
Include one example if helpful.
"""

    elif mode == "detailed":
        instruction = """
Give a detailed explanation.
Use simple English.
Include examples where appropriate.
"""

    else:
        instruction = """
Give a medium-length answer.
"""

    prompt = f"""
You are StudyPilot AI.

You are helping a student understand their uploaded notes.

Context:
{context}

Question:
{question}

Instructions:
{instruction}

Rules:
- Answer ONLY from the context.
- Never invent information.
- Explain naturally like a teacher.
- Do not copy the textbook word-for-word.
- If the answer is not found, reply exactly:
I couldn't find this information in the uploaded notes.

Answer:
"""

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt
    )

    return response.text