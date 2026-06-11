from rag.pdf_reader import extract_text
from rag.chunker import chunk_text
from rag.embedder import get_embedding
from rag.vector_store import VectorStore
from rag.qa import answer_question

# Load PDF
text = extract_text("test.pdf")

# Create chunks
chunks = chunk_text(text)

# Create embeddings
embeddings = [
    get_embedding(chunk)
    for chunk in chunks
]

# Store in FAISS
store = VectorStore(
    len(embeddings[0])
)

store.add(
    embeddings,
    chunks
)

# Ask question
question = input("Ask Question: ")

# Search relevant chunks
query_embedding = get_embedding(
    question
)

results = store.search(
    query_embedding
)

context = "\n".join(results)

# Generate answer
answer = answer_question(
    question,
    context
)

print("\nAnswer:\n")
print(answer)