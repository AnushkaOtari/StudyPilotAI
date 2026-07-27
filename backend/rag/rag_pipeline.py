import os
import time

from rag.pdf_reader import extract_text, extract_text_by_page
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

# -----------------------------
# Per-chat state
# -----------------------------
# Every chat gets its own FAISS-backed VectorStore and its own short
# conversational history. Both are keyed by chat_id so that Chat 1's
# PDFs/history never leak into Chat 2's retrieval.

VECTORSTORE_FOLDER = "vectorstores"

_stores = {}          # chat_id -> VectorStore (in-memory cache)
_chat_histories = {}  # chat_id -> list of {question, answer}


def _store_folder(chat_id):
    return os.path.join(VECTORSTORE_FOLDER, f"chat_{chat_id}")


def _get_store(chat_id):
    """Return the VectorStore for this chat, loading it from disk into the
    in-memory cache on first use. Returns None if the chat has no store yet
    (i.e. nothing has been uploaded to it)."""

    if chat_id in _stores:
        return _stores[chat_id]

    loaded = VectorStore.load(_store_folder(chat_id))
    if loaded is not None:
        _stores[chat_id] = loaded

    return loaded


def load_pdf(pdf_path, chat_id):

    print(f"Loading PDF into chat {chat_id}: {pdf_path}")

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

    store = _get_store(chat_id)
    if store is None:
        store = VectorStore(len(embeddings[0]))

    store.add(
        embeddings,
        chunks_with_metadata,
        pdf_path
    )

    # Persist to disk immediately so the index survives a server restart
    # without needing to re-embed every PDF.
    store.save(_store_folder(chat_id))
    _stores[chat_id] = store

    # A new upload changes the chat's knowledge base, so its conversational
    # context is no longer reliable — reset it.
    _chat_histories[chat_id] = []

    print(f"Knowledge base updated for chat {chat_id}")


def retrieve_context(query, chat_id, filename=None, k=8):

    store = _get_store(chat_id)

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

    context = "\n\n".join(
        f"Source: {doc['source']} (Page {doc['page']})\n{doc['text']}"
        for doc in results
    )

    return context, results


def ask_rag(question, chat_id, filename=None):

    store = _get_store(chat_id)

    if store is None:
        return {
            "answer": "Please upload a PDF first.",
            "sources": []
        }

    chat_history = _chat_histories.setdefault(chat_id, [])

    total_start = time.time()

    start = time.time()
    context, results = retrieve_context(
        query=question,
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

    answer = answer_question(
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

    return {
        "answer": answer,
        "sources": sources
    }


def delete_pdf_and_rebuild(filename, chat_id, upload_folder):

    file_path = os.path.join(upload_folder, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        print(f"Deleted file {file_path} from disk.")

    # Drop this chat's store (memory + disk) and its history, then rebuild
    # from whatever PDFs remain in this chat's upload folder.
    _stores.pop(chat_id, None)
    _chat_histories.pop(chat_id, None)

    store_folder = _store_folder(chat_id)
    for fname in ("faiss.index", "documents.pkl"):
        fpath = os.path.join(store_folder, fname)
        if os.path.exists(fpath):
            os.remove(fpath)

    if os.path.exists(upload_folder):
        for fname in os.listdir(upload_folder):
            if fname.lower().endswith(".pdf"):
                full_path = os.path.join(upload_folder, fname)
                load_pdf(full_path, chat_id)
