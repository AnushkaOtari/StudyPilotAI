"""Integration tests: real app.py /ask + /upload, real rag_pipeline,
document_queue, pdf_reader (PyMuPDF), chunker, FAISS VectorStore and
resource_hash_table, with real generated PDFs.

Replaced (not available / not runnable in this environment):
  - rag.embedder      -> deterministic hashed bag-of-words embedder
                         (the real one downloads a sentence-transformers model)
  - rag.qa            -> records calls, returns a canned answer (no Gemini, no key)
  - auth.* / routes.quiz / models -> minimal stand-ins (files not provided);
                         QuestionRequest is inferred from app.py's usage.

Run SEPARATELY from test_citations_unit.py (that file stubs rag.* modules):
    python -m pytest tests/test_citations_integration.py -v
"""

import copy
import hashlib
import importlib
import os
import sys
import types

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOT_FOUND = "I couldn't find this information in the uploaded notes."

QA_CALLS = []
QA_REPLY = {"answer": "A generated answer."}
DIM = 64


def fake_embedding(text):
    vec = [0.0] * DIM
    for word in "".join(c.lower() if c.isalnum() else " " for c in text).split():
        h = int(hashlib.md5(word.encode()).hexdigest(), 16)
        vec[h % DIM] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def make_pdf(path, pages):
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(path), pagesize=A4)
    for text_lines in pages:
        y = 800
        for line in text_lines:
            c.drawString(50, y, line)
            y -= 18
        c.showPage()
    c.save()


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)           # uploads/ and vectorstores/ are cwd-relative
    sys.path.insert(0, BACKEND)

    for name in list(sys.modules):
        if name == "app" or name == "rag" or name.startswith("rag.") or name in (
                "auth", "auth.models", "auth.router", "routes", "routes.quiz", "models"):
            monkeypatch.delitem(sys.modules, name, raising=False)

    from fastapi import APIRouter
    from pydantic import BaseModel
    from typing import Optional

    def stub(name, **attrs):
        m = types.ModuleType(name)
        m.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, m)

    class User:
        def __init__(self, id): self.id = id

    current = {"user": User(1)}

    class QuestionRequest(BaseModel):   # inferred from app.py: question, chat_id, filename
        question: str
        chat_id: str
        filename: Optional[str] = None

    def get_current_user():
        return current["user"]

    QA_CALLS.clear()
    QA_REPLY["answer"] = "A generated answer."

    def answer_question(question, context, chat_history, mode):
        QA_CALLS.append({"question": question, "context": context,
                         "history": copy.deepcopy(chat_history), "mode": mode})
        return QA_REPLY["answer"]

    stub("auth"); stub("auth.models", User=User)
    stub("auth.router", get_current_user=get_current_user, router=APIRouter())
    stub("routes"); stub("routes.quiz", router=APIRouter())
    stub("models", QuestionRequest=QuestionRequest)
    stub("rag.embedder", get_embedding=fake_embedding)
    stub("rag.qa", answer_question=answer_question)

    app_module = importlib.import_module("app")
    rp = importlib.import_module("rag.rag_pipeline")
    rp._stores.clear(); rp._chat_histories.clear()

    from fastapi.testclient import TestClient
    app_module.app.dependency_overrides[get_current_user] = get_current_user
    client = TestClient(app_module.app)

    class Env: pass
    e = Env()
    e.client, e.rp, e.tmp, e.current, e.User = client, rp, tmp_path, current, User

    def upload(chat, filename, pages, user_id=1):
        e.current["user"] = User(user_id)
        pdf = tmp_path / filename
        make_pdf(pdf, pages)
        with open(pdf, "rb") as f:
            r = client.post("/upload", data={"chat_id": chat},
                            files={"files": (filename, f, "application/pdf")})
        assert r.status_code == 200, r.text
        assert all(j["status"] == "COMPLETED" for j in r.json()["jobs"]), r.json()

    def ask(q, chat, filename=None, user_id=1):
        e.current["user"] = User(user_id)
        body = {"question": q, "chat_id": chat}
        if filename:
            body["filename"] = filename
        r = client.post("/ask", json=body)
        assert r.status_code == 200, r.text
        return r.json()

    e.upload, e.ask = upload, ask
    return e


COMPANY = [["A company is a legal entity separate from its owners."],
           ["Shareholders enjoy limited liability for company debts."],
           ["Directors manage the company on behalf of shareholders."]]
TAX = [["Income tax is levied on annual earnings of individuals."],
       ["Corporate tax applies to company profits each year."]]


def test_real_chunk_structure_and_page_convention(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    store = env.rp._get_store(1, "c1")
    assert store.documents, "no chunks indexed"
    for d in store.documents:
        assert set(d) == {"text", "source", "page"}       # no document id exists
        assert d["source"] == "Companies.pdf"
    assert sorted({d["page"] for d in store.documents}) == [1, 2, 3]  # 1-based


def test_ask_response_shape_and_real_metadata(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    body = env.ask("limited liability shareholders debts", "c1")
    assert set(body) == {"question", "answer", "sources", "citations"}
    assert body["question"] == "limited liability shareholders debts"
    assert body["answer"] == "A generated answer."
    assert body["sources"] == ["Companies.pdf"]
    cites = body["citations"]
    assert cites and [c["id"] for c in cites] == [f"source_{i+1}" for i in range(len(cites))]
    by_page = {c["page"]: c for c in cites}
    assert "limited liability" in by_page[2]["text"]       # page 2 evidence on page 2
    assert "legal entity" in by_page[1]["text"]
    assert all(c["filename"] == "Companies.pdf" for c in cites)
    assert all(set(c) == {"id", "filename", "page", "text"} for c in cites)


def test_citations_come_from_same_results_as_gemini_context(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    body = env.ask("who manages the company directors", "c1")
    context = QA_CALLS[-1]["context"]
    for c in body["citations"]:
        assert c["text"] in context
        assert f"Source: {c['filename']} (Page {c['page']})" in context


def test_multiple_pdfs_and_pages(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c1", "Tax.pdf", TAX)
    body = env.ask("company tax profits and shareholders", "c1")
    pairs = {(c["filename"], c["page"]) for c in body["citations"]}
    assert ("Tax.pdf", 2) in pairs
    assert any(f == "Companies.pdf" for f, _ in pairs)
    assert set(body["sources"]) == {c["filename"] for c in body["citations"]}
    for c in body["citations"]:                       # evidence really is on that page of that PDF
        src = env.rp._get_store(1, "c1").documents
        assert any(d["source"] == c["filename"] and d["page"] == c["page"] and d["text"] == c["text"]
                   for d in src)


def test_filename_filter_limits_citations(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c1", "Tax.pdf", TAX)
    body = env.ask("company", "c1", filename="Tax.pdf")
    assert body["citations"] and {c["filename"] for c in body["citations"]} == {"Tax.pdf"}
    assert body["sources"] == ["Tax.pdf"]


def test_faiss_minus_one_padding_creates_no_extra_citations(env):
    """Real VectorStore pads with documents[-1] when chunks < k (pre-existing quirk).
    Citations must still be unique and correspond to real chunks."""
    env.upload("c1", "Tax.pdf", TAX)                  # only 2 chunks, k=8
    results = env.rp.retrieve_context("tax", 1, "c1", None, 8)[1]
    assert len(results) == 8 and len(env.rp._get_store(1, "c1").documents) == 2
    body = env.ask("tax", "c1")
    assert len(body["citations"]) == 2
    assert len({c["text"] for c in body["citations"]}) == 2


def test_reupload_same_filename_does_not_duplicate_citations(env):
    env.upload("c1", "Tax.pdf", TAX)
    env.upload("c1", "Tax.pdf", TAX)                  # store now holds each chunk twice
    assert len(env.rp._get_store(1, "c1").documents) == 4
    body = env.ask("tax", "c1")
    assert len(body["citations"]) == 2


def test_chats_and_users_isolated(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c2", "Tax.pdf", TAX)
    env.upload("c1", "Other.pdf", [["Another users notes about biology."]], user_id=2)
    assert {c["filename"] for c in env.ask("company", "c1")["citations"]} == {"Companies.pdf"}
    assert {c["filename"] for c in env.ask("tax", "c2")["citations"]} == {"Tax.pdf"}
    assert {c["filename"] for c in env.ask("biology", "c1", user_id=2)["citations"]} == {"Other.pdf"}


def test_no_upload_gives_empty_citations(env):
    body = env.ask("anything", "empty")
    assert body == {"question": "anything", "answer": "Please upload a PDF first.",
                    "sources": [], "citations": []}


def test_not_found_reply_gives_no_citations(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    QA_REPLY["answer"] = NOT_FOUND
    body = env.ask("quantum chromodynamics", "c1")
    assert body["citations"] == [] and body["answer"] == NOT_FOUND
    assert body["sources"] == ["Companies.pdf"]


def test_follow_up_and_history_behaviour_unchanged(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.ask("what is a company", "c1")
    QA_REPLY["answer"] = "second"
    second = env.ask("explain that simpler", "c1")
    assert QA_CALLS[0]["history"] == []
    assert QA_CALLS[1]["history"] == [{"question": "what is a company", "answer": "A generated answer."}]
    assert second["citations"] and all(c["id"].startswith("source_") for c in second["citations"])
    assert QA_CALLS[1]["mode"] == "detailed"
    hist = env.rp._chat_histories[env.rp._store_key(1, "c1")]
    assert all(set(h) == {"question", "answer"} for h in hist)
    # a new upload still resets history, as before
    env.upload("c1", "Tax.pdf", TAX)
    assert env.rp._chat_histories[env.rp._store_key(1, "c1")] == []


def test_persisted_store_reload_keeps_metadata(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.rp._stores.clear()                            # force reload from faiss.index/documents.pkl
    body = env.ask("limited liability", "c1")
    assert {(c["filename"], c["page"]) for c in body["citations"]} >= {("Companies.pdf", 2)}
