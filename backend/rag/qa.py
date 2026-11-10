
import os
from dotenv import load_dotenv
from google import genai

from rag.citations import parse_source_refs

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


def _build_prompt(question, context, chat_history, mode, include_source_refs=False):

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

    source_reference_rules = ""
    if include_source_refs:
        source_reference_rules = """
SOURCE REFERENCES:
- Each block of the CURRENT PDF CONTEXT starts with a reference label such as [S1].
- These labels are valid only for the CURRENT PDF CONTEXT above. Never use labels from the conversation history.
- Do not write reference labels inside your answer text.
- After your answer, add one final line in exactly this format:
  SOURCE_REFS: S1, S3
  List only the labels of the context blocks whose content you actually used to write the answer.
- If your answer does not use the PDF context (including when you reply that you couldn't find the information), write:
  SOURCE_REFS: NONE
"""

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
{source_reference_rules}
Answer:
"""

    return prompt


def _generate(prompt):

    # -----------------------------
    # Gemini API
    # -----------------------------

    response = client.models.generate_content(
        model="gemini-3.1-flash-lite",
        contents=prompt
    )

    return response.text


def answer_question(question, context, chat_history, mode):
    """Answer a question and return the answer text (original contract)."""

    prompt = _build_prompt(question, context, chat_history, mode)
    return _generate(prompt)


def answer_question_with_sources(question, context, chat_history, mode):
    """Answer a question and report which context blocks the model used.

    Returns (answer_text, claimed_refs). `claimed_refs` are the labels (S1, S2,
    ...) the model says it used. They are NOT verified here; rag_pipeline
    validates them against the chunks that were actually retrieved.
    """

    prompt = _build_prompt(
        question, context, chat_history, mode, include_source_refs=True
    )
    return parse_source_refs(_generate(prompt))
