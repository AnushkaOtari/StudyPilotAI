
import os
import re
import time
import shutil
from collections import OrderedDict
from threading import RLock

from rag.chunker import chunk_text
from rag.pdf_reader import extract_text, extract_text_by_page
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question_with_sources
from rag.citations import format_context, resolve_citations
from rag.resource_hash_table import global_resource_hash_table


# -----------------------------
# Configuration
# -----------------------------

NOT_FOUND_ANSWER = "I couldn't find this information in the uploaded notes."

VECTORSTORE_FOLDER = "vectorstores"
SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")

MAX_CACHED_STORES = 10

_stores = OrderedDict()
_stores_lock = RLock()

_chat_histories = {}

# Chats marked for deletion cannot be indexed again.
_deleting_chats = set()


# -----------------------------
# Chat helpers
# -----------------------------

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

    return os.path.join(
        VECTORSTORE_FOLDER,
        f"user_{user_id}",
        f"chat_{chat_id}"
    )


def mark_chat_deleting(user_id, chat_id):
    """
    Mark a chat as permanently deleted.

    Call this before cancelling queued jobs and cleaning up files.
    """

    key = _store_key(user_id, chat_id)

    with _stores_lock:
        _deleting_chats.add(key)

    print(f"Chat marked for deletion: {key}")


def is_chat_deleting(user_id, chat_id):
    """Check whether a chat has been marked for deletion."""

    key = _store_key(user_id, chat_id)

    with _stores_lock:
        return key in _deleting_chats


# -----------------------------
# Vector store management
# -----------------------------

def _get_store(user_id, chat_id):
    """Load a chat's vectorstore and maintain an LRU cache."""

    key = _store_key(user_id, chat_id)

    with _stores_lock:

        if key in _deleting_chats:
            return None

        # Cache hit
        if key in _stores:
            _stores.move_to_end(key)
            return _stores[key]

        # Load from disk
        loaded = VectorStore.load(
            _store_folder(user_id, chat_id)
        )

        if loaded is None:
            return None

        # Check again before caching
        if key in _deleting_chats:
            return None

        _stores[key] = loaded

        # LRU eviction
        while len(_stores) > MAX_CACHED_STORES:
            evicted_key, _ = _stores.popitem(last=False)

            print(
                f"Evicted vectorstore from RAM cache: {evicted_key}"
            )

        return loaded


# -----------------------------
# PDF loading and indexing
# -----------------------------

def load_pdf(pdf_path, user_id, chat_id):

    key = _store_key(user_id, chat_id)

    # Stop immediately if chat is deleted.
    with _stores_lock:
        if key in _deleting_chats:
            print(f"Skipping PDF indexing for deleted chat: {key}")
            return

    print(
        f"Loading PDF into user {user_id}, "
        f"chat {chat_id}: {pdf_path}"
    )

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

    if not chunks_with_metadata:
        print(f"No readable text found in {pdf_path}")
        return

    embeddings = [
        get_embedding(item["text"])
        for item in chunks_with_metadata
    ]

    if not embeddings:
        print(f"No embeddings generated for {pdf_path}")
        return

    print("Embeddings:", len(embeddings))

    store_folder = _store_folder(user_id, chat_id)

    # Commit indexing under the lock.
    # This prevents deletion from racing with vectorstore writes.
    with _stores_lock:

        if key in _deleting_chats:
            print(
                f"Aborting indexing because chat was deleted: {key}"
            )
            return

        store = _get_store(user_id, chat_id)

        if store is None:
            store = VectorStore(len(embeddings[0]))

        store.add(
            embeddings,
            chunks_with_metadata,
            os.path.basename(pdf_path)
        )

        # Persist vectorstore
        store.save(store_folder)

        _stores[key] = store
        _stores.move_to_end(key)

        # LRU eviction
        while len(_stores) > MAX_CACHED_STORES:
            evicted_key, _ = _stores.popitem(last=False)

            print(
                f"Evicted vectorstore from RAM cache: {evicted_key}"
            )

        # Reset conversation history after a new upload.
        _chat_histories[key] = []

        # Resource metadata
        filename = os.path.basename(pdf_path)

        resource_key = f"{user_id}:{chat_id}:{filename}"

        file_size = (
            os.path.getsize(pdf_path)
            if os.path.exists(pdf_path)
            else 0
        )

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

        # Metadata insertion is also protected by the lock.
        if key not in _deleting_chats:
            global_resource_hash_table.insert(
                resource_key,
                resource_metadata
            )

    print(
        f"Knowledge base & Resource Hash Table updated "
        f"for user {user_id}, chat {chat_id}"
    )


# -----------------------------
# Vector store status
# -----------------------------

def has_vector_store(user_id, chat_id):

    if is_chat_deleting(user_id, chat_id):
        return False

    store_folder = _store_folder(user_id, chat_id)

    index_path = os.path.join(
        store_folder,
        "faiss.index"
    )

    docs_path = os.path.join(
        store_folder,
        "documents.pkl"
    )

    return (
        os.path.exists(index_path)
        and os.path.exists(docs_path)
    )


# -----------------------------
# Context retrieval
# -----------------------------

def retrieve_context(
    query,
    user_id,
    chat_id,
    filename=None,
    k=8
):

    if is_chat_deleting(user_id, chat_id):
        return "", []

    query_embedding = get_embedding(query)

    with _stores_lock:

        if is_chat_deleting(user_id, chat_id):
            return "", []

        store = _get_store(user_id, chat_id)

        if store is None:
            return "", []

        if filename:

            results = store.search(
                query_embedding,
                k=20
            )

            results = [
                doc for doc in results
                if doc["source"].replace("\\", "/").endswith(filename)
            ]

            results = results[:k]

        else:

            results = store.search(
                query_embedding,
                k=k
            )

        # Label each retrieved chunk [S1], [S2], etc.
        context = format_context(results)

    return context, results


# -----------------------------
# Follow-up question handling
# -----------------------------

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
        or any(
            phrase in question_lower
            for phrase in followup_phrases
        )
    )

    if is_followup and chat_history:

        previous_question = (
            chat_history[-1].get("question", "")
        )

        previous_answer = (
            chat_history[-1].get("answer", "")
        )

        if previous_question:

            return (
                f"Previous question: {previous_question}\n"
                f"Previous answer: {previous_answer}\n"
                f"Current follow-up: {question}"
            )

    return question


# -----------------------------
# RAG question answering
# -----------------------------

def ask_rag(
    question,
    user_id,
    chat_id,
    filename=None
):

    key = _store_key(user_id, chat_id)

    if is_chat_deleting(user_id, chat_id):
        return {
            "answer": "This chat has been deleted.",
            "sources": [],
            "citations": []
        }

    store = _get_store(user_id, chat_id)

    if store is None:
        return {
            "answer": "Please upload a PDF first.",
            "sources": [],
            "citations": []
        }

    chat_history = _chat_histories.setdefault(
        key,
        []
    )

    total_start = time.time()

    retrieval_question = resolve_followup_question(
        question,
        chat_history
    )

    start = time.time()

    context, results = retrieve_context(
        query=retrieval_question,
        user_id=user_id,
        chat_id=chat_id,
        filename=filename,
        k=2 if filename else 8
    )

    print(
        f"Retrieval Time : {time.time()-start:.2f} sec"
    )

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

    print(
        f"LLM Time : {time.time()-start:.2f} sec"
    )

    chat_history.append({
        "question": question,
        "answer": answer
    })

    if len(chat_history) > 5:
        chat_history.pop(0)

    print(
        f"TOTAL TIME : {time.time()-total_start:.2f} sec"
    )

    sources = list(
        set(
            [doc["source"] for doc in results]
        )
    )

    # ---------------- Citations ---------------- #

    if (
        answer is not None
        and answer.strip() == NOT_FOUND_ANSWER
    ):

        citations = []

    else:

        resolved = resolve_citations(
            results,
            claimed_refs
        )

        citations = resolved["citations"]

        if resolved["invalid_refs"]:

            print(
                "Ignored invalid source references: "
                f"{resolved['invalid_refs']}"
            )

    return {
        "answer": answer,
        "sources": sources,
        "citations": citations
    }


# -----------------------------
# Delete one PDF and rebuild
# -----------------------------

def delete_pdf_and_rebuild(
    filename,
    user_id,
    chat_id,
    upload_folder
):

    file_path = os.path.join(
        upload_folder,
        filename
    )

    if os.path.exists(file_path):

        os.remove(file_path)

        print(
            f"Deleted file {file_path} from disk."
        )

    # Remove resource metadata for this PDF.
    resource_key = f"{user_id}:{chat_id}:{filename}"

    global_resource_hash_table.delete(
        resource_key
    )

    key = _store_key(user_id, chat_id)

    store_folder = _store_folder(
        user_id,
        chat_id
    )

    # Drop cached store and old index.
    with _stores_lock:

        if key in _deleting_chats:
            raise ValueError("This chat has been deleted.")

        _stores.pop(key, None)
        _chat_histories.pop(key, None)

        for fname in (
            "faiss.index",
            "documents.pkl"
        ):

            fpath = os.path.join(
                store_folder,
                fname
            )

            if os.path.exists(fpath):
                os.remove(fpath)

    # Rebuild using remaining PDFs.
    if os.path.exists(upload_folder):

        for fname in os.listdir(upload_folder):

            if fname.lower().endswith(".pdf"):

                full_path = os.path.join(
                    upload_folder,
                    fname
                )

                load_pdf(
                    full_path,
                    user_id,
                    chat_id
                )


# -----------------------------
# Delete entire chat
# -----------------------------

def delete_chat_data(user_id, chat_id):
    """
    Permanently remove a chat's vectorstore,
    in-memory history and resource metadata.

    The deletion marker remains in memory so that
    the deleted chat cannot be indexed again.
    """

    key = _store_key(user_id, chat_id)

    store_folder = _store_folder(
        user_id,
        chat_id
    )

    # Mark deleted before removing any data.
    with _stores_lock:

        _deleting_chats.add(key)

        # Remove in-memory data.
        _stores.pop(key, None)

        _chat_histories.pop(key, None)

        # Remove persisted vectorstore directory.
        if os.path.exists(store_folder):

            shutil.rmtree(store_folder)

        # Remove empty parent user directory.
        user_folder = os.path.dirname(
            store_folder
        )

        if (
            os.path.isdir(user_folder)
            and not os.listdir(user_folder)
        ):

            os.rmdir(user_folder)

    # Remove every resource metadata entry belonging
    # to this user's chat.
    metadata = global_resource_hash_table.to_dict()

    prefix = f"{user_id}:{chat_id}:"

    for resource_key in list(metadata.keys()):

        if resource_key.startswith(prefix):

            global_resource_hash_table.delete(
                resource_key
            )

    print(
        f"Deleted all RAG data for user {user_id}, "
        f"chat {chat_id}"
    )
