from rag.pdf_reader import extract_text
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

print("Loading StudyPilot knowledge base...")

text = extract_text("test.pdf")

chunks = chunk_text(text)

embeddings = [
    get_embedding(chunk)
    for chunk in chunks
]

store = VectorStore(
    len(embeddings[0])
)

store.add(
    embeddings,
    chunks
)

print("Knowledge base loaded!")

def ask_rag(question):

    query_embedding = get_embedding(
        question
    )

    results = store.search(
        query_embedding
    )

    context = "\n".join(results)

    answer = answer_question(
        question,
        context
    )

    return answer