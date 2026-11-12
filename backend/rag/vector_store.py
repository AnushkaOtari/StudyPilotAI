import os
import pickle

import faiss
import numpy as np


class VectorStore:

    def __init__(self, dimension):
        self.index = faiss.IndexFlatL2(dimension)
        self.documents = []

    def save(self, folder):
        """Persist this store's FAISS index + document metadata to disk."""
        os.makedirs(folder, exist_ok=True)
        faiss.write_index(self.index, os.path.join(folder, "faiss.index"))
        with open(os.path.join(folder, "documents.pkl"), "wb") as f:
            pickle.dump(self.documents, f)

    @classmethod
    def load(cls, folder):
        """Load a previously saved store from disk. Returns None if not found."""
        index_path = os.path.join(folder, "faiss.index")
        docs_path = os.path.join(folder, "documents.pkl")

        if not (os.path.exists(index_path) and os.path.exists(docs_path)):
            return None

        store = cls.__new__(cls)
        store.index = faiss.read_index(index_path)
        with open(docs_path, "rb") as f:
            store.documents = pickle.load(f)

        return store

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

            if 0 <= idx < len(self.documents):
                results.append(
                    self.documents[idx]
                )

        return results