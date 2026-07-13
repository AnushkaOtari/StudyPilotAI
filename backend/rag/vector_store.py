import faiss
import numpy as np

class VectorStore:

    def __init__(self, dimension):
        self.index = faiss.IndexFlatL2(dimension)
        self.chunks = []

    def add(self, embeddings, chunks):

        vectors = np.array(embeddings).astype("float32")

        self.index.add(vectors)

        self.chunks.extend(chunks)

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
            if idx < len(self.chunks):
                results.append(
                    self.chunks[idx]
                )

        return results