import os
import time

from rag.pdf_reader import extract_text, extract_text_by_page
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

store = None
chat_history = []


def load_pdf(pdf_path):
    

    global store
    global chat_history
    print("Store Before:", store)

    print("Loading StudyPilot knowledge base...")

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

    
    if store is None:

        store = VectorStore(
            len(embeddings[0])
        )

    
    store.add(
        embeddings,
        chunks_with_metadata,
        pdf_path
    )

    chat_history = []

    print("Knowledge base loaded!")

    print("Store After:", store)

def ask_rag(question, filename=None):

    global store
    global chat_history

    if store is None:
        return {
            "answer": "Please upload a PDF first.",
            "sources": []
        }

    total_start = time.time()

    # ---------------- Embedding ---------------- #

    start = time.time()

    query_embedding = get_embedding(question)

    print(f"Embedding Time : {time.time()-start:.2f} sec")

    # ---------------- Retrieval ---------------- #

    start = time.time()

    if filename:
        # Retrieve more matches to filter by filename
        results = store.search(
            query_embedding,
            k=20
        )
        # Filter results where doc["source"] matches filename
        results = [doc for doc in results if doc["source"].replace("\\", "/").endswith(filename)]
        results = results[:2]
    else:
        results = store.search(
            query_embedding,
            k=8
        )

    print(f"Retrieval Time : {time.time()-start:.2f} sec")

    context = "\n\n".join(
        f"Source: {doc['source']} (Page {doc['page']})\n{doc['text']}"
        for doc in results
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

def delete_pdf_and_rebuild(filename, upload_folder):
    global store
    global chat_history

    file_path = os.path.join(upload_folder, filename)
    if os.path.exists(file_path):
        os.remove(file_path)
        print(f"Deleted file {file_path} from disk.")

    # Reset store
    store = None
    chat_history = []

    # Re-index all remaining files
    if os.path.exists(upload_folder):
        for fname in os.listdir(upload_folder):
            if fname.lower().endswith(".pdf"):
                full_path = os.path.join(upload_folder, fname)
                load_pdf(full_path)
