
import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


def answer_question(question, context, chat_history, mode):

    # -----------------------------
    # Answer Mode
    # -----------------------------

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
Explain clearly and naturally.
"""

    # -----------------------------
    # Format Conversation History
    # -----------------------------

    history_text = ""

    if chat_history:
        history_parts = []

        for item in chat_history[-5:]:
            previous_question = item.get("question", "")
            previous_answer = item.get("answer", "")

            if previous_question and previous_answer:
                history_parts.append(
                    f"Student: {previous_question}\n"
                    f"StudyPilot AI: {previous_answer}"
                )

        history_text = "\n\n".join(history_parts)

    if not history_text:
        history_text = "No previous conversation."

    # -----------------------------
    # Gemini Prompt
    # -----------------------------

    prompt = f"""
You are StudyPilot AI, an AI learning assistant.

Your job is to help students understand their uploaded notes.

CONVERSATION HISTORY:
{history_text}

CURRENT PDF CONTEXT:
{context}

CURRENT STUDENT QUESTION:
{question}

ANSWER INSTRUCTIONS:
{instruction}

RULES:
- Answer the CURRENT student question directly.
- Use conversation history to understand follow-up questions.
- Understand references such as "it", "this", "that", and "the previous answer".
- If the student asks for a simpler explanation, simplify the relevant previous concept.
- If the student asks for an example, provide an example of the relevant concept.
- If the student asks for more detail, expand the relevant previous explanation.
- Do not answer an old question unless it helps answer the current question.
- Use the PDF context for document-based factual answers.
- Do not invent information that is not supported by the PDF context.
- If the required information is not found in the PDF context,
  reply exactly:
  I couldn't find this information in the uploaded notes.
- Explain naturally like a teacher.
- Do not copy the textbook word-for-word.
- Do not unnecessarily repeat the entire previous answer.

Answer:
"""

    # -----------------------------
    # Gemini API
    # -----------------------------

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt
    )

    return response.text
