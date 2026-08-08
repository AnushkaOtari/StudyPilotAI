import os
import json
import uuid

from dotenv import load_dotenv
from google import genai

from rag.rag_pipeline import retrieve_context, has_vector_store
from schemas.mindmap_schema import MindMapResponse

load_dotenv()

client = genai.Client(
    api_key=os.getenv("GOOGLE_API_KEY")
)

# ---------------------------------------------------------
# Cache
# ---------------------------------------------------------

MINDMAP_CACHE_FOLDER = "mindmaps"


def _cache_folder(user_id, chat_id):
    return os.path.join(
        MINDMAP_CACHE_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )


def _cache_file(user_id, chat_id):
    return os.path.join(
        _cache_folder(user_id, chat_id),
        "mindmap.json"
    )


def _load_cached_mindmap(user_id, chat_id):
    path = _cache_file(user_id, chat_id)

    if not os.path.exists(path):
        return None

    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        validated = MindMapResponse.model_validate(data)
        return validated.model_dump()

    except Exception as e:
        print(f"Failed to load cached mind map: {e}")
        return None


def _save_cached_mindmap(user_id, chat_id, data):
    folder = _cache_folder(user_id, chat_id)
    os.makedirs(folder, exist_ok=True)

    path = _cache_file(user_id, chat_id)

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _delete_cached_mindmap(user_id, chat_id):
    path = _cache_file(user_id, chat_id)

    if os.path.exists(path):
        os.remove(path)

    folder = _cache_folder(user_id, chat_id)

    try:
        if os.path.exists(folder) and not os.listdir(folder):
            os.rmdir(folder)
    except Exception:
        pass


# ---------------------------------------------------------
# Helpers
# ---------------------------------------------------------

def _friendly_generation_error(e):
    msg = str(e).lower()

    if isinstance(e, json.JSONDecodeError) or "json" in msg:
        return "The AI returned an unexpected response format. Please try again."

    if "timeout" in msg or "deadline" in msg:
        return "Mind map generation took too long. Please try again."

    if (
        "api key" in msg
        or "permission" in msg
        or "unauthorized" in msg
        or "401" in msg
    ):
        return "The AI service is temporarily unavailable. Please try again later."

    return "Unable to generate the mind map right now. Please try again."


def _clean_json_response(text):
    text = text.strip()

    if text.startswith("```"):
        lines = text.splitlines()

        if lines and lines[0].startswith("```"):
            lines = lines[1:]

        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]

        text = "\n".join(lines).strip()

    return text


def _assign_ids(node):
    """
    Recursively add an internal ID to every node.

    The current Pydantic schema doesn't expose an ID field,
    so IDs are not stored in the validated response.
    This helper is reserved for future frontend transformation.
    """

    node["id"] = str(uuid.uuid4())

    for child in node.get("children", []):
        _assign_ids(child)

    return node


# ---------------------------------------------------------
# Gemini Prompt
# ---------------------------------------------------------

def _build_prompt(context):
    return f"""
You are StudyPilot AI, an expert educational assistant.

Create a structured study mind map from ONLY the study material provided below.

IMPORTANT SOURCE RULE:

You MUST use ONLY the provided study material.

Do NOT use external knowledge.

Do NOT add facts that are not supported by the provided context.

Do NOT invent topics.

The purpose is to visually organize the student's uploaded study material.

STUDY MATERIAL:

{context}

==================================================
MIND MAP REQUIREMENTS
==================================================

Create one root node representing the main subject.

Organize the material hierarchically.

Use meaningful relationships between concepts.

Avoid duplicate concepts.

Avoid unnecessary nodes.

Maximum depth: 5 levels.

Prefer important concepts over small details.

The root should have the major topics.

Major topics should contain their relevant subtopics.

==================================================
NODE FORMAT
==================================================

Every node MUST contain:

"title"
"summary"
"key_points"
"related_concepts"
"children"

"title":
Short topic name.

"summary":
A concise 1–2 sentence explanation based ONLY on the context.

"key_points":
Important facts or ideas supported by the context.

"related_concepts":
Other concepts from the provided context that are related.

"children":
Nested subtopics.

==================================================
OUTPUT FORMAT
==================================================

Return ONLY valid JSON.

Do NOT return:

- Markdown
- ```json
- explanations outside JSON
- comments
- HTML

The output MUST follow exactly this structure:

{{
    "root": {{
        "title": "Main Topic",
        "summary": "Short summary.",
        "key_points": [
            "Important point 1",
            "Important point 2"
        ],
        "related_concepts": [
            "Related concept"
        ],
        "children": [
            {{
                "title": "Subtopic",
                "summary": "Short summary.",
                "key_points": [],
                "related_concepts": [],
                "children": []
            }}
        ]
    }}
}}

Make the hierarchy useful for a student preparing for an exam.

Return ONLY the JSON object.
"""


# ---------------------------------------------------------
# Generate Mind Map
# ---------------------------------------------------------

def generate_mindmap(user_id, chat_id):
    """
    Generate a mind map from the active chat's RAG context.
    """

    # Check whether this chat has documents
    if not has_vector_store(user_id, chat_id):
        return {
            "error": (
                "No study documents found for this chat. "
                "Please upload a PDF before generating a mind map."
            )
        }

    # Return cached result if available
    cached = _load_cached_mindmap(user_id, chat_id)

    if cached is not None:
        return cached

    # Retrieve broad context
    try:
        context, results = retrieve_context(
            query=(
                "Identify the main topics, important concepts, "
                "definitions, classifications, processes, relationships, "
                "and subtopics from the study material."
            ),
            user_id=user_id,
            chat_id=chat_id,
            filename=None,
            k=20
        )

    except Exception as e:
        print(f"Mind map retrieval failed: {e}")

        return {
            "error": (
                "We couldn't read your study materials right now. "
                "Please try again."
            )
        }

    if not results:
        return {
            "error": (
                "Not enough information was found in your documents "
                "to generate a mind map."
            )
        }

    # Remove duplicate chunks
    seen_chunks = set()
    unique_results = []

    for doc in results:
        text = (doc.get("text") or "").strip()

        if text and text not in seen_chunks:
            seen_chunks.add(text)
            unique_results.append(doc)

    if not unique_results:
        return {
            "error": (
                "Not enough information was found in your documents "
                "to generate a mind map."
            )
        }

    # Build clean context
    context = "\n\n".join(
        f"Source: {doc.get('source', 'Unknown')} "
        f"(Page {doc.get('page', 1)})\n"
        f"{doc.get('text', '')}"
        for doc in unique_results
    )

    prompt = _build_prompt(context)

    def try_generate():
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt
        )

        if not response.text:
            raise ValueError("Gemini returned an empty response.")

        cleaned = _clean_json_response(response.text)

        data = json.loads(cleaned)

        # Validate using our Pydantic schema
        validated = MindMapResponse.model_validate(data)

        return validated.model_dump()

    # -----------------------------------------------------
    # First attempt
    # -----------------------------------------------------

    try:
        data = try_generate()

        _save_cached_mindmap(
            user_id,
            chat_id,
            data
        )

        return data

    except Exception as e:
        print(
            f"Mind map generation failed on first attempt: "
            f"{e}. Retrying..."
        )

    # -----------------------------------------------------
    # Second attempt
    # -----------------------------------------------------

    try:
        data = try_generate()

        _save_cached_mindmap(
            user_id,
            chat_id,
            data
        )

        return data

    except Exception as e:
        print(
            f"Mind map generation failed on retry: {e}"
        )

        return {
            "error": _friendly_generation_error(e)
        }


# ---------------------------------------------------------
# Regenerate
# ---------------------------------------------------------

def regenerate_mindmap(user_id, chat_id):
    """
    Delete the existing cached mind map and generate a fresh one.
    """

    if not has_vector_store(user_id, chat_id):
        return {
            "error": (
                "No study documents found for this chat. "
                "Please upload a PDF before generating a mind map."
            )
        }

    _delete_cached_mindmap(
        user_id,
        chat_id
    )

    return generate_mindmap(
        user_id=user_id,
        chat_id=chat_id
    )


# ---------------------------------------------------------
# Get existing mind map
# ---------------------------------------------------------

def get_mindmap(user_id, chat_id):
    """
    Return the cached mind map for this chat.
    """

    if not has_vector_store(user_id, chat_id):
        return {
            "error": "No study documents found for this chat."
        }

    cached = _load_cached_mindmap(
        user_id,
        chat_id
    )

    if cached is None:
        return {
            "mindmap": None,
            "message": "No mind map has been generated for this chat yet."
        }

    return cached


# ---------------------------------------------------------
# Delete mind map
# ---------------------------------------------------------

def delete_mindmap(user_id, chat_id):
    """
    Delete the cached mind map for this chat.
    """

    _delete_cached_mindmap(
        user_id,
        chat_id
    )

    return {
        "success": True,
        "message": "Mind map deleted successfully."
    }