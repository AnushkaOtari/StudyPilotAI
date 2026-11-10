import json
import os
import re

# Reuse the Gemini client that the quiz feature already creates, instead of
# making a second one.
from services.quiz_services import client
from rag.rag_pipeline import retrieve_context, has_vector_store

# Same model the quiz feature uses.
MODEL_NAME = "gemini-3.1-flash-lite"

# If the retrieved text is shorter than this, there is not enough material to
# make good flashcards (roughly two short paragraphs).
MIN_CONTEXT_CHARS = 200


class FlashcardError(Exception):
    """An error we want to show the user. The route turns it into an HTTP error."""

    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _normalise(text):
    """Lower-case and strip punctuation so near-identical questions match."""
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _only_chunks_from_pdf(results, pdf_name):
    """retrieve_context only checks that a source path *ends with* the name
    (so "a.pdf" would also match "data.pdf"). Keep exact matches only."""
    return [
        doc for doc in results
        if os.path.basename(str(doc.get("source", "")).replace("\\", "/")) == pdf_name
    ]


def _parse_flashcards(raw_text):
    """Turn Gemini's reply into a clean list of {"question", "answer"} dicts.

    Raises ValueError if the reply is not the structure we asked for.
    Cards that are malformed or duplicated are dropped; any extra fields Gemini
    adds are removed, so each card has ONLY question and answer.
    """
    text = raw_text.strip()
    # Gemini sometimes wraps JSON in ```json ... ``` fences.
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    data = json.loads(text)

    if not isinstance(data, dict) or not isinstance(data.get("flashcards"), list):
        raise ValueError("Response is not an object with a 'flashcards' list.")

    cards = []
    seen_questions = set()
    for item in data["flashcards"]:
        if not isinstance(item, dict):
            continue
        question = item.get("question")
        answer = item.get("answer")
        if not isinstance(question, str) or not isinstance(answer, str):
            continue
        question, answer = question.strip(), answer.strip()
        if not question or not answer:
            continue
        key = _normalise(question)
        if key in seen_questions:
            continue
        seen_questions.add(key)
        cards.append({"question": question, "answer": answer})

    if not cards:
        raise ValueError("No valid flashcards in the response.")
    return cards


def _build_prompt(context, num_flashcards):
    return f"""
You are StudyPilot AI, an expert teacher.

Create up to {num_flashcards} flashcards for revision from the study material below.

Study Material:
{context}

Rules:
1. Use ONLY the study material above. Never use outside knowledge or invent facts.
2. Focus on the important concepts, definitions, facts and processes.
3. Every question must be clear and specific, and make sense on its own.
4. Every answer must be accurate and concise (one or two sentences).
5. Do not repeat or rephrase the same question. Cover different topics.
6. If the material does not contain enough for {num_flashcards} good flashcards, return fewer. Do NOT make up cards to reach the number.
7. Return ONLY valid JSON. No text, markdown or code fences outside the JSON.

Return exactly this JSON structure, with ONLY the fields "question" and "answer":
{{
    "flashcards": [
        {{"question": "What is ...?", "answer": "..."}}
    ]
}}
"""


def generate_flashcards(pdf_name, user_id, chat_id, num_flashcards=10):
    """Return a list of {"question", "answer"} flashcards for this user's chat.

    Raises FlashcardError with a user-friendly message when something is wrong.
    """
    if pdf_name is not None:
        pdf_name = pdf_name.strip() or None
    if pdf_name is not None and (
        os.path.basename(pdf_name) != pdf_name or not pdf_name.lower().endswith(".pdf")
    ):
        raise FlashcardError(400, "pdf_name must be a PDF file name such as 'notes.pdf'.")

    # Everything below is looked up with the logged-in user's id AND the chat id,
    # so a user can only ever reach their own chats' documents.
    try:
        has_documents = has_vector_store(user_id, chat_id)
    except ValueError:
        raise FlashcardError(400, "Invalid chat id.")

    if not has_documents:
        raise FlashcardError(
            404,
            "No study documents found for this chat yet. Please upload at least one PDF before generating flashcards.",
        )

    # Ask for more chunks when more cards are requested (same idea as the quiz).
    k = int(min(30, max(8, num_flashcards * 1.5)))

    try:
        _, results = retrieve_context(
            query="Key concepts, definitions, facts, terms and explanations from this document",
            user_id=user_id,
            chat_id=chat_id,
            filename=pdf_name,
            k=k,
        )
    except Exception as e:
        print(f"Retrieval failed while generating flashcards: {e}")
        raise FlashcardError(
            503, "We couldn't read your study materials right now. Please try again in a moment."
        )

    if pdf_name:
        results = _only_chunks_from_pdf(results, pdf_name)
        if not results:
            raise FlashcardError(
                404, f"No content found for '{pdf_name}' in this chat. Check the PDF name and that it has finished processing."
            )

    # The search can return the same chunk more than once; use each only once.
    seen_chunks = set()
    chunk_texts = []
    for doc in results:
        text = (doc.get("text") or "").strip()
        if text and text not in seen_chunks:
            seen_chunks.add(text)
            chunk_texts.append(text)

    context = "\n\n".join(chunk_texts)
    if len(context) < MIN_CONTEXT_CHARS:
        raise FlashcardError(
            422, "Not enough information in the uploaded documents to generate flashcards."
        )

    prompt = _build_prompt(context, num_flashcards)

    # Try twice (like the quiz does) in case Gemini returns bad JSON once.
    last_error = None
    for attempt in (1, 2):
        try:
            response = client.models.generate_content(model=MODEL_NAME, contents=prompt)
            cards = _parse_flashcards(response.text)
            # Never return more than requested.
            return cards[:num_flashcards]
        except (ValueError, TypeError, AttributeError) as e:
            # json.JSONDecodeError is a ValueError: the reply was not what we asked for.
            print(f"Flashcard response was invalid (attempt {attempt}): {e}")
            last_error = e
        except Exception as e:
            print(f"Flashcard generation failed (attempt {attempt}): {e}")
            last_error = e

    if isinstance(last_error, (ValueError, TypeError, AttributeError)):
        raise FlashcardError(
            502, "The study assistant returned an unexpected response format. Please try again."
        )
    raise FlashcardError(
        502, "The study assistant encountered an error while generating your flashcards. Please try again."
    )
