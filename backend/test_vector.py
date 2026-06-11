from rag.pdf_reader import extract_text
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore

text = extract_text("test.pdf")

chunks = chunk_text(text)

embeddings = []

for chunk in chunks:
    embeddings.append(
        get_embedding(chunk)
    )

store = VectorStore(
    len(embeddings[0])
)

store.add(
    embeddings,
    chunks
)

question = "What is machine learning?"

query_embedding = get_embedding(
    question
)

results = store.search(
    query_embedding
)

print(results)