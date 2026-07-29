import os
import json
import random
from dotenv import load_dotenv
from google import genai

from rag.rag_pipeline import retrieve_context

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GOOGLE_API_KEY")
)

def validate_quiz_data(data):
    if not isinstance(data, list):
        return False
    for q in data:
        if not isinstance(q, dict):
            return False
        # Required fields: question, type, difficulty, topic, explanation, correct_answer, source_chunk
        for field in ["question", "type", "difficulty", "topic", "explanation", "correct_answer", "source_chunk"]:
            if field not in q:
                return False
        q_type = q.get("type")
        if q_type not in ["mcq", "true_false", "fill_blank"]:
            return False
        if q_type == "mcq":
            opts = q.get("options")
            if not isinstance(opts, list) or len(opts) != 4:
                return False
            if q.get("correct_answer") not in opts:
                return False
        elif q_type == "true_false":
            if not isinstance(q.get("correct_answer"), bool):
                return False
    return True

def shuffle_mcq_options(data):
    for q in data:
        if q.get("type") == "mcq" and "options" in q:
            opts = list(q["options"])
            correct = q.get("correct_answer")
            if correct in opts:
                random.shuffle(opts)
                q["options"] = opts
    return data

def generate_quiz(pdf_name, chat_id, num_questions=10, difficulty="mixed", question_type="mixed"):
    # Calculate retrieval size k
    k = int(min(30, max(8, num_questions * 1.5)))

    context, _ = retrieve_context(
        query="Generate a comprehensive, diverse quiz containing key concepts, facts, terms, and explanations from this document",
        chat_id=chat_id,
        filename=pdf_name,
        k=k
    )

    if not context or not context.strip():
        return {
            "error": "Not enough information in the uploaded documents to generate the requested quiz."
        }

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
            "error": "Failed to validate quiz structure generated from document after retry. Please try again."
        }
    except Exception as e:
        print(f"Quiz generation failed on retry: {e}")
        return {
            "error": "The study assistant timed out or encountered an error. Please ensure your Gemini API key is valid."
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