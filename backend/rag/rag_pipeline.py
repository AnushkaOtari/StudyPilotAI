import os
import re
import time
from rag.chunker import chunk_text
from rag.pdf_reader import extract_text, extract_text_by_page
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question_with_sources
from rag.citations import format_context, resolve_citations
from rag.resource_hash_table import global_resource_hash_table

# -----------------------------
# Per-chat state
# -----------------------------
# Every authenticated user's chat gets its own FAISS-backed VectorStore and
# short conversational history. Both are keyed by user_id + chat_id so data
# cannot leak between users even if chat ids collide.

# Exact reply the prompt in rag/qa.py requires when the PDF context has no answer.
NOT_FOUND_ANSWER = "I couldn't find this information in the uploaded notes."

VECTORSTORE_FOLDER = "vectorstores"
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

_stores = {}          # (user_id, chat_id) -> VectorStore (in-memory cache)
_chat_histories = {}  # (user_id, chat_id) -> list of {question, answer}


def _store_key(user_id, chat_id):
    return (str(user_id), str(chat_id))


def _safe_segment(value, name):
    value = str(value)
    if not SAFE_SEGMENT_RE.match(value):
        raise ValueError(f"Invalid {name}.")
    return value


def _store_folder(user_id, chat_id):
    user_id = _safe_segment(user_id, "user id")
    chat_id = _safe_segment(chat_id, "chat id")
    return os.path.join(VECTORSTORE_FOLDER, f"user_{user_id}", f"chat_{chat_id}")


def _get_store(user_id, chat_id):
    """Return the VectorStore for this chat, loading it from disk into the
    in-memory cache on first use. Returns None if the chat has no store yet
    (i.e. nothing has been uploaded to it)."""

    key = _store_key(user_id, chat_id)
    if key in _stores:
        return _stores[key]

    loaded = VectorStore.load(_store_folder(user_id, chat_id))
    if loaded is not None:
        _stores[key] = loaded

    return loaded


def load_pdf(pdf_path, user_id, chat_id):
    print(f"Loading PDF into user {user_id}, chat {chat_id}: {pdf_path}")

    pages = extract_text_by_page(pdf_path)
    print("Pages Extracted:", len(pages))

    chunks_with_metadata = []
    for page_num, page_text in pages:
        page_chunks = chunk_text(page_text)
        for chunk in page_chunks:
            chunks_with_metadata.append({
                "text": chunk,
                "source": os.path.basename(pdf_path),
                "page": page_num
            })

    print("Chunks:", len(chunks_with_metadata))
    if len(chunks_with_metadata) == 0:
        print(f"No readable text found in {pdf_path}")
        return

    embeddings = [
        get_embedding(item["text"])
        for item in chunks_with_metadata
    ]

    if len(embeddings) == 0:
        print(f"No embeddings generated for {pdf_path}")
        return

    print("Embeddings:", len(embeddings))

    store = _get_store(user_id, chat_id)
    if store is None:
        store = VectorStore(len(embeddings[0]))

    store.add(
        embeddings,
        chunks_with_metadata,
        pdf_path
    )

    # Persist to disk immediately so the index survives a server restart
    # without needing to re-embed every PDF.
    store.save(_store_folder(user_id, chat_id))
    _stores[_store_key(user_id, chat_id)] = store

    # A new upload changes the chat's knowledge base, so its conversational
    # context is no longer reliable — reset it.
    _chat_histories[_store_key(user_id, chat_id)] = []

    # Index document resource metadata into Resource Hash Table (O(1) insertion)
    filename = os.path.basename(pdf_path)
    resource_key = f"{user_id}:{chat_id}:{filename}"
    file_size = os.path.getsize(pdf_path) if os.path.exists(pdf_path) else 0

    resource_metadata = {
        "resource_id": f"{user_id}_{chat_id}_{filename}",
        "filename": filename,
        "user_id": user_id,
        "chat_id": chat_id,
        "file_path": pdf_path,
        "file_size": file_size,
        "total_pages": len(pages),
        "total_chunks": len(chunks_with_metadata),
        "status": "COMPLETED",
        "indexed_at": time.time()
    }
    global_resource_hash_table.insert(resource_key, resource_metadata)

    print(f"Knowledge base & Resource Hash Table updated for user {user_id}, chat {chat_id}")


def has_vector_store(user_id, chat_id):
    """Return True if this chat has an indexed vector store on disk/in-memory
    (i.e. at least one PDF has been successfully uploaded and embedded).
    Lets callers give a specific "no documents uploaded" message instead of
    a generic empty-retrieval message."""

    return _get_store(user_id, chat_id) is not None


def retrieve_context(query, user_id, chat_id, filename=None, k=8):

    store = _get_store(user_id, chat_id)

    if store is None:
        return "", []

    query_embedding = get_embedding(query)

    if filename:
        results = store.search(query_embedding, k=20)
        results = [
            doc for doc in results
            if doc["source"].replace("\\", "/").endswith(filename)
        ]
        results = results[:k]

    else:
        results = store.search(query_embedding, k=k)

    # Each chunk is labelled [S1], [S2], ... for this request so the model can
    # say which blocks it used (see rag/citations.py).
    context = format_context(results)

    return context, results

def resolve_followup_question(question, chat_history):
    question_lower = question.lower().strip()

    followup_phrases = [
        "explain with example",
        "give example",
        "with example",
        "explain it",
        "explain this",
        "tell me more",
        "more detail",
        "simplify it",
        "simpler",
        "how so",
        "why",
    ]

    is_followup = (
        len(question.split()) <= 6
        or any(phrase in question_lower for phrase in followup_phrases)
    )

    if is_followup and chat_history:
        previous_question = chat_history[-1].get("question", "")
        previous_answer = chat_history[-1].get("answer", "")

        if previous_question:
            return (
                f"Previous question: {previous_question}\n"
                f"Previous answer: {previous_answer}\n"
                f"Current follow-up: {question}"
            )

    return question


def ask_rag(question, user_id, chat_id, filename=None):

    store = _get_store(user_id, chat_id)

    if store is None:
        return {
            "answer": "Please upload a PDF first.",
            "sources": [],
            "citations": []
        }

    key = _store_key(user_id, chat_id)
    chat_history = _chat_histories.setdefault(key, [])

    total_start = time.time()
    retrieval_question = resolve_followup_question(
    question, chat_history
    )


    start = time.time()
    context, results = retrieve_context(
        query=question,
        user_id=user_id,
        chat_id=chat_id,
        filename=filename,
        k=2 if filename else 8
    )

    print(f"Retrieval Time : {time.time()-start:.2f} sec")
    # ---------------- Mode Detection ---------------- #

    question_lower = question.lower()

    if any(word in question_lower for word in [
        "what is",
        "define",
        "meaning of",
        "who is"
    ]):
        mode = "short"

    elif any(word in question_lower for word in [
        "explain",
        "describe",
        "detail",
        "elaborate"
    ]):
        mode = "detailed"

    else:
        mode = "normal"

    # ---------------- LLM ---------------- #

    start = time.time()

    answer, claimed_refs = answer_question_with_sources(
        question,
        context,
        chat_history,
        mode
    )

    print(f"LLM Time : {time.time()-start:.2f} sec")

    chat_history.append(
        {
            "question": question,
            "answer": answer
        }
    )

    if len(chat_history) > 5:
        chat_history.pop(0)

    print(f"TOTAL TIME : {time.time()-total_start:.2f} sec")

    sources = list(
        set(
            [doc["source"] for doc in results]
        )
    )

    # Citations: only references that the model named AND that label a chunk
    # which was really retrieved for this request. Filename, page and text come
    # from the retrieved chunk, never from the model. Retrieval alone is not
    # evidence, so an answer with no valid reference has no citations. The
    # fixed "not found" reply never cites anything.
    if answer is not None and answer.strip() == NOT_FOUND_ANSWER:
        citations = []
    else:
        resolved = resolve_citations(results, claimed_refs)
        citations = resolved["citations"]
        if resolved["invalid_refs"]:
            print(f"Ignored invalid source references: {resolved['invalid_refs']}")

    return {
        "answer": answer,
        "sources": sources,
        "citations": citations
    }


def delete_pdf_and_rebuild(filename, user_id, chat_id, upload_folder):

    file_path = os.path.join(upload_folder, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        print(f"Deleted file {file_path} from disk.")

    # Remove document metadata from Resource Hash Table
    resource_key = f"{user_id}:{chat_id}:{filename}"
    global_resource_hash_table.delete(resource_key)

    # Drop this chat's store (memory + disk) and its history, then rebuild
    # from whatever PDFs remain in this chat's upload folder.
    key = _store_key(user_id, chat_id)
    _stores.pop(key, None)
    _chat_histories.pop(key, None)

    store_folder = _store_folder(user_id, chat_id)
    for fname in ("faiss.index", "documents.pkl"):
        fpath = os.path.join(store_folder, fname)
        if os.path.exists(fpath):
            os.remove(fpath)

    if os.path.exists(upload_folder):
        for fname in os.listdir(upload_folder):
            if fname.lower().endswith(".pdf"):
                full_path = os.path.join(upload_folder, fname)
                load_pdf(full_path, user_id, chat_id)
