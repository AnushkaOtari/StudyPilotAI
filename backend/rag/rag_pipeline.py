from rag.pdf_reader import extract_text
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

store = None


def load_pdf(pdf_path):

    global store

    print("Loading StudyPilot knowledge base...")

    text = extract_text(pdf_path)

    print("Text Length:", len(text))
    print(text[:500])

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

    print("Knowledge base loaded!")


# load_pdf("test.pdf")


def ask_rag(question):

    query_embedding = get_embedding(
        question
    )

    results = store.search(
        query_embedding
    )

    print("\n===== RETRIEVED CHUNKS =====")
    print(results)
    print("============================\n")

    context = "\n".join(results)

    answer = answer_question(
        question,
        context
    )

    return answer