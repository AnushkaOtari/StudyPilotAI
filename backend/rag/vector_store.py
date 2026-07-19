import faiss
import numpy as np


class VectorStore:

    def __init__(self, dimension):
        self.index = faiss.IndexFlatL2(dimension)
        self.documents = []

    def add(self, embeddings, chunks, source=None):

        vectors = np.array(embeddings).astype("float32")

        self.index.add(vectors)

        for chunk in chunks:
            if isinstance(chunk, dict):
                self.documents.append({
                    "text": chunk.get("text", ""),
                    "source": chunk.get("source", source),
                    "page": chunk.get("page", 1)
                })
            else:
                self.documents.append({
                    "text": chunk,
                    "source": source or "Unknown",
                    "page": 1
                })

    def search(self, query_embedding, k=5):

        query_vector = np.array(
            [query_embedding]
        ).astype("float32")

        distances, indices = self.index.search(
            query_vector,
            k
        )

        results = []

        for idx in indices[0]:

            if idx < len(self.documents):
                results.append(
                    self.documents[idx]
                )

        return results