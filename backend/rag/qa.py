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
You are StudyPilot AI, an intelligent study assistant.

Answer directly using the provided study material.

Do NOT introduce yourself.

Do NOT greet the user.

Do NOT start with phrases like:
"Hello"
"Hi"
"I'm StudyPilot AI"
Always start immediately with the answer.
If the answer exists in the notes, explain it clearly.

If the answer is not in the notes, clearly say it is not covered in the uploaded material.

Context:
{context}

Question:
{question}

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