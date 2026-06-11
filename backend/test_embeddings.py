from rag.embedder import get_embedding

embedding = get_embedding(
    "Machine Learning is a branch of AI"
)

print(len(embedding))