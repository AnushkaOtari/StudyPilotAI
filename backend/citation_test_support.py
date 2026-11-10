"""Shared helpers for the citation / PDF-serving tests.

Replaced for tests (the real ones need a model download or an API key):
  - rag.embedder        -> deterministic hashed bag-of-words embedder
  - google.genai Client -> FakeGemini (records the real prompt rag/qa.py builds
                           and returns whatever `GEMINI.responder` produces)
  - dotenv.load_dotenv  -> no-op (no .env file is read)

Everything else (rag/qa.py, rag/citations.py, rag/rag_pipeline.py,
rag/vector_store.py, FAISS, PyMuPDF, the chunker ...) is the real code.
"""

import copy
import hashlib
import re
import sys
import types

# ----------------------------------------------------------------- Gemini


class FakeGemini:
    def __init__(self):
        self.reset()

    def reset(self):
        self.prompts = []
        self.models_used = []
        self.responder = lambda prompt: "A generated answer.\nSOURCE_REFS: S1"

    def generate_content(self, model, contents):
        self.models_used.append(model)
        self.prompts.append(contents)
        return types.SimpleNamespace(text=self.responder(contents))


GEMINI = FakeGemini()


def context_blocks(prompt):
    """Return [(label, header, text)] from the CURRENT PDF CONTEXT of a prompt."""
    context = prompt.split("CURRENT PDF CONTEXT:\n", 1)[1]
    context = context.split("\n\nCURRENT STUDENT QUESTION:", 1)[0]
    blocks = []
    for raw in re.split(r"\n\n(?=\[S\d+\] Source:)", context.strip()):
        m = re.match(r"\[(S\d+)\] (Source: [^\n]*)\n(.*)", raw, re.S)
        if m:
            blocks.append((m.group(1), m.group(2), m.group(3)))
    return blocks


def labels_containing(prompt, *phrases):
    """Labels of the context blocks whose text contains any phrase."""
    return [label for label, _, text in context_blocks(prompt)
            if any(p.lower() in text.lower() for p in phrases)]


def faithful_model(*phrases, answer="A generated answer."):
    """A responder that behaves like a well-behaved model: it cites exactly the
    labelled blocks that contain one of `phrases`."""
    def respond(prompt):
        labels = labels_containing(prompt, *phrases)
        return f"{answer}\nSOURCE_REFS: {', '.join(labels) if labels else 'NONE'}"
    return respond


# --------------------------------------------------------------- embedder

DIM = 64


def fake_embedding(text):
    vec = [0.0] * DIM
    for word in "".join(c.lower() if c.isalnum() else " " for c in text).split():
        vec[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


# ------------------------------------------------------------------ stubs

def install_stubs():
    """Idempotent. Call before importing rag.qa / rag.rag_pipeline."""
    def module(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        sys.modules[name] = m
        return m

    module("rag.embedder", get_embedding=fake_embedding)
    module("dotenv", load_dotenv=lambda *a, **k: False)

    class Client:
        def __init__(self, *args, **kwargs):
            self.models = GEMINI

    genai = module("google.genai", Client=Client)
    google = sys.modules.get("google")
    if google is None:
        google = module("google")
    google.genai = genai


# ------------------------------------------------------------- PDF helper

def make_pdf(path, pages):
    """pages: list of pages, each a list of text lines."""
    import pymupdf
    doc = pymupdf.open()
    for lines in pages:
        page = doc.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line)
            y += 16
    doc.save(str(path))
    doc.close()


def deep(obj):
    return copy.deepcopy(obj)


# ------------------------------------------------- app / integration env

def build_env(tmp_path, monkeypatch):
    """Real app.py + real RAG pipeline + real FAISS/PyMuPDF in `tmp_path`.

    Replaced because they are not available here / need secrets: auth.*,
    routes.quiz, models (QuestionRequest is inferred from how app.py uses it).
    `env.login(user_id)` chooses who the stand-in get_current_user returns.
    """
    import importlib
    import os
    from typing import Optional

    from fastapi import APIRouter
    from fastapi.testclient import TestClient
    from pydantic import BaseModel

    install_stubs()
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    monkeypatch.chdir(tmp_path)           # uploads/ and vectorstores/ are cwd-relative
    monkeypatch.syspath_prepend(backend_dir)

    for name in ("app", "rag.rag_pipeline", "rag.document_queue", "rag.resource_hash_table",
                 "auth", "auth.models", "auth.router", "routes", "routes.quiz", "routes.flashcard", "models"):
        monkeypatch.delitem(sys.modules, name, raising=False)

    class User:
        def __init__(self, id):
            self.id = id

    state = {"user": User(1)}

    class QuestionRequest(BaseModel):
        question: str
        chat_id: str
        filename: Optional[str] = None

    def get_current_user():
        if state["user"] is None:                      # mimic the real 401
            from fastapi import HTTPException
            raise HTTPException(status_code=401, detail="Could not validate credentials")
        return state["user"]

    for name, attrs in {
        "auth": {}, "auth.models": {"User": User},
        "auth.router": {"get_current_user": get_current_user, "router": APIRouter()},
        "routes": {}, "routes.quiz": {"router": APIRouter()},
        "models": {"QuestionRequest": QuestionRequest},
    }.items():
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        if name == "routes":
            # Lets real route files (e.g. routes/flashcard.py) still be imported
            # while routes.quiz stays a stand-in.
            m.__path__ = [os.path.join(backend_dir, "routes")]
        monkeypatch.setitem(sys.modules, name, m)

    GEMINI.reset()
    app_module = importlib.import_module("app")
    rp = importlib.import_module("rag.rag_pipeline")
    rp._stores.clear()
    rp._chat_histories.clear()
    app_module.app.dependency_overrides[get_current_user] = get_current_user
    client = TestClient(app_module.app)

    class Env:
        pass

    e = Env()
    e.client, e.rp, e.app_module, e.tmp = client, rp, app_module, tmp_path

    def login(user_id):
        state["user"] = None if user_id is None else User(user_id)

    def upload(chat, filename, pages, user_id=1):
        login(user_id)
        pdf = tmp_path / "_src" / filename
        pdf.parent.mkdir(exist_ok=True)
        make_pdf(pdf, pages)
        with open(pdf, "rb") as f:
            r = client.post("/upload", data={"chat_id": chat},
                            files={"files": (filename, f, "application/pdf")})
        assert r.status_code == 200, r.text
        assert all(j["status"] == "COMPLETED" for j in r.json()["jobs"]), r.json()

    def ask(q, chat, filename=None, user_id=1):
        login(user_id)
        body = {"question": q, "chat_id": chat}
        if filename:
            body["filename"] = filename
        r = client.post("/ask", json=body)
        assert r.status_code == 200, r.text
        return r.json()

    e.login, e.upload, e.ask = login, upload, ask
    return e
