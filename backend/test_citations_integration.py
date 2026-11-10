"""Integration tests: real app.py /upload + /ask, real RAG pipeline, FAISS,
PyMuPDF, real rag/qa.py prompt + parsing, and real generated PDFs.

Faked: embedder, Gemini client (it sees the real prompt), auth/models/quiz
stand-ins. See citation_test_support.py.

    python -m pytest test_citations_integration.py -v
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from citation_test_support import (  # noqa: E402
    GEMINI, context_blocks, build_env, faithful_model, labels_containing,
)

NOT_FOUND = "I couldn't find this information in the uploaded notes."

COMPANY = [["A company is a legal entity separate from its owners."],
           ["Shareholders enjoy limited liability for company debts."],
           ["Directors manage the company on behalf of shareholders."]]
TAX = [["Income tax is levied on annual earnings of individuals."],
       ["Corporate tax applies to company profits each year."]]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    return build_env(tmp_path, monkeypatch)


def test_real_chunk_structure_and_one_based_pages(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    docs = env.rp._get_store(1, "c1").documents
    assert docs and all(set(d) == {"text", "source", "page"} for d in docs)
    assert sorted({d["page"] for d in docs}) == [1, 2, 3]


def test_prompt_has_labelled_blocks_that_match_real_chunks(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.ask("limited liability shareholders debts", "c1")
    blocks = context_blocks(GEMINI.prompts[-1])
    assert blocks
    docs = env.rp._get_store(1, "c1").documents
    for label, header, text in blocks:
        assert any(d["text"] == text and header == f"Source: {d['source']} (Page {d['page']})" for d in docs)


def test_only_the_supporting_page_is_cited(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = faithful_model("limited liability")
    body = env.ask("limited liability shareholders debts", "c1")
    assert set(body) == {"question", "answer", "sources", "citations"}
    assert body["answer"] == "A generated answer."
    assert [(c["filename"], c["page"]) for c in body["citations"]] == [("Companies.pdf", 2)]
    assert "limited liability" in body["citations"][0]["text"]
    assert body["sources"] == ["Companies.pdf"]
    assert len(context_blocks(GEMINI.prompts[-1])) >= 2     # more was retrieved than cited


def test_answer_supported_by_two_pdfs(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c1", "Tax.pdf", TAX)
    GEMINI.responder = faithful_model("limited liability", "Corporate tax")
    body = env.ask("limited liability and corporate tax on company profits", "c1")
    assert {(c["filename"], c["page"]) for c in body["citations"]} == {("Companies.pdf", 2), ("Tax.pdf", 2)}
    assert set(body["sources"]) == {"Companies.pdf", "Tax.pdf"}


def test_no_supporting_reference_gives_no_citations(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = lambda p: "General knowledge answer.\nSOURCE_REFS: NONE"
    body = env.ask("company", "c1")
    assert body["citations"] == [] and body["sources"] == ["Companies.pdf"]


def test_invalid_references_from_the_model_are_rejected(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = lambda p: "Answer.\nSOURCE_REFS: S42, Tax.pdf, S1"
    body = env.ask("company", "c1")
    assert len(body["citations"]) == 1
    real = {(d["source"], d["page"], d["text"]) for d in env.rp._get_store(1, "c1").documents}
    c = body["citations"][0]
    assert (c["filename"], c["page"], c["text"]) in real


def test_not_found_reply_has_no_citations(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = lambda p: f"{NOT_FOUND}\nSOURCE_REFS: S1"
    body = env.ask("quantum chromodynamics", "c1")
    assert body["answer"] == NOT_FOUND and body["citations"] == []


def test_filename_filter_limits_citations(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c1", "Tax.pdf", TAX)
    GEMINI.responder = lambda p: "x\nSOURCE_REFS: S1, S2"
    body = env.ask("company", "c1", filename="Tax.pdf")
    assert body["citations"] and {c["filename"] for c in body["citations"]} == {"Tax.pdf"}


def test_reupload_duplicates_collapse(env):
    env.upload("c1", "Tax.pdf", TAX)
    env.upload("c1", "Tax.pdf", TAX)
    assert len(env.rp._get_store(1, "c1").documents) == 4
    GEMINI.responder = lambda p: "x\nSOURCE_REFS: " + ", ".join(
        label for label, _, _ in context_blocks(p))
    assert len(env.ask("tax", "c1")["citations"]) == 2


def test_follow_up_and_history_unchanged(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = faithful_model("legal entity")
    first = env.ask("what is a company", "c1")
    GEMINI.responder = faithful_model("limited liability")
    second = env.ask("explain that simpler", "c1")
    assert [c["page"] for c in first["citations"]] == [1]
    assert [c["page"] for c in second["citations"]] == [2]
    assert "Student: what is a company\nStudyPilot AI: A generated answer." in GEMINI.prompts[1]
    hist = env.rp._chat_histories[env.rp._store_key(1, "c1")]
    assert all(set(h) == {"question", "answer"} and "SOURCE_REFS" not in h["answer"] for h in hist)
    env.upload("c1", "Tax.pdf", TAX)                     # upload still resets history
    assert env.rp._chat_histories[env.rp._store_key(1, "c1")] == []


def test_chats_and_users_isolated(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c2", "Tax.pdf", TAX)
    env.upload("c1", "Other.pdf", [["Another users notes about biology."]], user_id=2)
    GEMINI.responder = lambda p: "x\nSOURCE_REFS: S1"
    assert {c["filename"] for c in env.ask("company", "c1")["citations"]} == {"Companies.pdf"}
    assert {c["filename"] for c in env.ask("tax", "c2")["citations"]} == {"Tax.pdf"}
    assert {c["filename"] for c in env.ask("biology", "c1", user_id=2)["citations"]} == {"Other.pdf"}


def test_no_upload_response(env):
    assert env.ask("anything", "empty") == {
        "question": "anything", "answer": "Please upload a PDF first.", "sources": [], "citations": []}


def test_persisted_store_reload_keeps_metadata(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.rp._stores.clear()
    GEMINI.responder = faithful_model("limited liability")
    assert [(c["filename"], c["page"]) for c in env.ask("limited liability", "c1")["citations"]] == [("Companies.pdf", 2)]
