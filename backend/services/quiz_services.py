import os
import json
import random
from dotenv import load_dotenv
from google import genai

from rag.rag_pipeline import retrieve_context, has_vector_store

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GOOGLE_API_KEY")
)

def validate_quiz_data(data):
    if not isinstance(data, list) or len(data) == 0:
        return False
    for q in data:
        if not isinstance(q, dict):
            return False
        # Required fields: question, type, difficulty, topic, explanation, correct_answer, source_chunk
        for field in ["question", "type", "difficulty", "topic", "explanation", "correct_answer", "source_chunk"]:
            if field not in q:
                return False

        # question/explanation/source_chunk must be non-empty, meaningful text
        if not isinstance(q.get("question"), str) or not q["question"].strip():
            return False
        if not isinstance(q.get("explanation"), str) or not q["explanation"].strip():
            return False
        if not isinstance(q.get("source_chunk"), str) or not q["source_chunk"].strip():
            return False

        q_type = q.get("type")
        if q_type not in ["mcq", "true_false", "fill_blank"]:
            return False

        if q_type == "mcq":
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4:
                return False
            if any(not isinstance(o, str) or not o.strip() for o in opts):
                return False
            if q.get("correct_answer") not in opts:
                return False
        elif q_type == "true_false":
            if not isinstance(q.get("correct_answer"), bool):
                return False
        elif q_type == "fill_blank":
            if not isinstance(q.get("correct_answer"), str) or not q["correct_answer"].strip():
                return False
    return True

def _friendly_generation_error(e):
    """Map a raw exception from the Gemini call/JSON parse into a
    user-friendly message without exposing internals."""
    msg = str(e).lower()
    if isinstance(e, json.JSONDecodeError) or "json" in msg or "expecting value" in msg:
        return "The study assistant returned an unexpected response format. Please try again."
    if "timeout" in msg or "deadline" in msg:
        return "The study assistant took too long to respond. Please try again."
    if "api key" in msg or "permission" in msg or "unauthorized" in msg or "401" in msg:
        return "The study assistant is temporarily unavailable due to a configuration issue. Please contact support."
    return "The study assistant encountered an error while generating your quiz. Please try again."


def shuffle_mcq_options(data):
    for q in data:
        if q.get("type") == "mcq" and "options" in q:
            opts = list(q["options"])
            correct = q.get("correct_answer")
            if correct in opts:
                random.shuffle(opts)
                q["options"] = opts
    return data

def generate_quiz(pdf_name, user_id, chat_id, num_questions=10, difficulty="mixed", question_type="mixed"):
    # No documents indexed for this chat at all yet
    if not has_vector_store(user_id, chat_id):
        return {
            "error": "No study documents found for this chat yet. Please upload at least one PDF before generating a quiz."
        }

    # Calculate retrieval size k, scaling with how many questions were requested
    k = int(min(30, max(8, num_questions * 1.5)))

    try:
        _, results = retrieve_context(
            query="Generate a comprehensive, diverse quiz containing key concepts, facts, terms, and explanations from this document",
            user_id=user_id,
            chat_id=chat_id,
            filename=pdf_name,
            k=k
        )
    except Exception as e:
        print(f"Retrieval failed while generating quiz: {e}")
        return {
            "error": "We couldn't read your study materials right now. Please try again in a moment."
        }

    if not results:
        return {
            "error": "Not enough information in the uploaded documents to generate the requested quiz."
        }

    # Avoid feeding the model the same chunk more than once, so it isn't
    # nudged toward generating several questions off the same passage.
    seen_chunks = set()
    deduped_results = []
    for doc in results:
        text = (doc.get("text") or "").strip()
        if text and text not in seen_chunks:
            seen_chunks.add(text)
            deduped_results.append(doc)

    if not deduped_results:
        return {
            "error": "Not enough information in the uploaded documents to generate the requested quiz."
        }

    context = "\n\n".join(
        f"Source: {doc.get('source', 'Unknown')} (Page {doc.get('page', 1)})\n{doc['text']}"
        for doc in deduped_results
    )

    difficulty_instruction = ""
    if difficulty != "mixed":
        difficulty_instruction = f"The difficulty level of all questions must be exactly: {difficulty}."
    else:
        difficulty_instruction = "The questions must vary in difficulty level (mix of easy, medium, hard)."

    type_instruction = ""
    if question_type == "mcq":
        type_instruction = "Every question must be a multiple-choice question (type 'mcq')."
    elif question_type == "true_false":
        type_instruction = "Every question must be a true/false question (type 'true_false')."
    elif question_type == "fill_blank":
        type_instruction = "Every question must be a fill-in-the-blank question (type 'fill_blank')."
    else:
        type_instruction = "The questions must be a balanced mix of MCQ, True/False, and Fill-in-the-blank types."

    prompt = f"""
You are StudyPilot AI, an expert teacher.

Generate exactly {num_questions} questions from the provided study material.

Study Material Context:
{context}

Requirements:
1. Use ONLY the provided Study Material Context. Never use external knowledge or invent facts.
2. {difficulty_instruction}
3. {type_instruction}
4. Avoid duplicate questions, repeating concepts, or similar queries. Ensure questions cover multiple topics mentioned in the context.
5. Provide a clear, educational explanation for the correct answer.
6. For each question, extract a sentence or direct quote from the context that justifies/proves the question and correct answer, and include it in the 'source_chunk' field.
7. Return a valid JSON list of objects matching the schemas below. DO NOT return any other text, markdown formatting, or HTML tags outside the JSON.

JSON Schema Formats:

For MCQ (type="mcq"):
{{
    "question": "The question text",
    "type": "mcq",
    "difficulty": "easy/medium/hard",
    "topic": "Topic Name",
    "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
    ],
    "correct_answer": "Option B", // Must EXACTLY match one of the items in the options array
    "explanation": "Why this answer is correct...",
    "source_chunk": "Direct quote from context..."
}}

For True/False (type="true_false"):
{{
    "question": "The statement to evaluate",
    "type": "true_false",
    "difficulty": "easy/medium/hard",
    "topic": "Topic Name",
    "correct_answer": true, // Must be a boolean: true or false
    "explanation": "Why this statement is true or false...",
    "source_chunk": "Direct quote from context..."
}}

For Fill in the blanks (type="fill_blank"):
{{
    "question": "The question with a blank denoted by ________",
    "type": "fill_blank",
    "difficulty": "easy/medium/hard",
    "topic": "Topic Name",
    "correct_answer": "the missing word(s)", // Must be a string
    "explanation": "Explanation of the concept...",
    "source_chunk": "Direct quote from context..."
}}

Generate exactly {num_questions} questions. Return ONLY a valid JSON list.
"""

    def try_generate():
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )
        quiz_text = response.text.strip()
        # Clean markdown codeblocks
        if quiz_text.startswith("```"):
            lines = quiz_text.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            quiz_text = "\n".join(lines).strip()
        return json.loads(quiz_text)

    # First attempt
    try:
        data = try_generate()
        if validate_quiz_data(data):
            return shuffle_mcq_options(data)
        print("Quiz validation failed on first attempt. Retrying...")
    except Exception as e:
        print(f"Quiz generation failed on first attempt: {e}. Retrying...")

    # Second attempt (retry once)
    try:
        data = try_generate()
        if validate_quiz_data(data):
            return shuffle_mcq_options(data)
        return {
            "error": "We couldn't generate a well-formed quiz from your documents. Please try again."
        }
    except Exception as e:
        print(f"Quiz generation failed on retry: {e}")
        return {
            "error": _friendly_generation_error(e)
        }

def get_quiz_feedback(results):
    if not results:
        return "No quiz results available to analyze."

    formatted_results = []
    for r in results:
        q = r.get("question", "")
        topic = r.get("topic", "General")
        is_correct = r.get("is_correct", False)
        formatted_results.append(f"Question: {q}\nTopic: {topic}\nCorrect: {is_correct}\n")

    results_str = "\n".join(formatted_results)

    prompt = f"""
You are StudyPilot AI. The student has just completed a quiz.

Here are the results of the quiz:
{results_str}

Please analyze the student's performance and provide a concise summary feedback.
Ensure you summarize:
- Strongest topics (topics they did well in)
- Weakest topics (topics they struggled with)
- Estimated understanding level
- Recommendation on what to review next

Rules:
1. Do not mention anything outside the topics present in the uploaded PDFs.
2. Keep the feedback encouraging, teacher-like, and very concise (under 120 words).
3. Do not include markdown headers or lists. Just regular text.
"""
    try:
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )
        return response.text.strip()
    except Exception as e:
        print(f"Error getting feedback: {e}")
        return "Excellent effort! Continue reviewing your study materials to reinforce your understanding."
