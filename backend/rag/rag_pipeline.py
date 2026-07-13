import time

from rag.pdf_reader import extract_text
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

store = None
chat_history = []


def load_pdf(pdf_path):

    global store
    global chat_history

    print("Loading StudyPilot knowledge base...")

    text = extract_text(pdf_path)

    print("Text Length:", len(text))

    chunks = chunk_text(text)

    print("Chunks:", len(chunks))

    embeddings = [
        get_embedding(chunk)
        for chunk in chunks
    ]

    print("Embeddings:", len(embeddings))

    store = VectorStore(
        len(embeddings[0])
    )

    store.add(
        embeddings,
        chunks
    )

    chat_history = []

    print("Knowledge base loaded!")


def ask_rag(question):

    global store
    global chat_history

    if store is None:
        return "Please upload a PDF first."

    total_start = time.time()

    # ---------------- Embedding ---------------- #

    start = time.time()

    query_embedding = get_embedding(question)

    print(f"Embedding Time : {time.time()-start:.2f} sec")

    # ---------------- Retrieval ---------------- #

    start = time.time()

    results = store.search(
        query_embedding,
        k=2
    )

    print(f"Retrieval Time : {time.time()-start:.2f} sec")

    context = "\n".join(results)

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

    return answer