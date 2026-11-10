from sentence_transformers import SentenceTransformer
import time
model = None


def get_model():
    global model

    if model is None:
        model = SentenceTransformer(
            "all-MiniLM-L6-v2"
        )

    return model


def get_embedding(text):
    model = get_model()

    start = time.time()
    embedding = model.encode(text)
    print(f"Embedding Time: {time.time() - start:.2f} sec")

    return embedding.tolist()
