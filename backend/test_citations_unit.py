"""Backend citation tests.

The modules missing from the shared backend (vector_store, embedder,
pdf_reader, chunker, resource_hash_table) and Gemini (rag.qa) are replaced by
stubs, so no API key, network or real index is needed. Run from the backend
root:  python -m pytest tests/test_citations.py -v
"""

import copy
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

NOT_FOUND = "I couldn't find this information in the uploaded notes."


class FakeStore:
    def __init__(self, docs):
        self.docs = docs

    def search(self, query_embedding, k=8):
        return [copy.deepcopy(d) for d in self.docs[:k]]


STORES = {}      # store folder -> FakeStore
QA_CALLS = []    # recorded answer_question calls
QA_REPLY = {"answer": "A generated answer."}


def _install_stubs():
    def stub(name, **attrs):
        mod = types.ModuleType(name)
        mod.__dict__.update(attrs)
        sys.modules[name] = mod
        return mod

    class VectorStore:
        @staticmethod
        def load(folder):
            return STORES.get(folder)

    def answer_question(question, context, chat_history, mode):
        QA_CALLS.append({
            "question": question,
            "context": context,
            "history": copy.deepcopy(chat_history),
            "mode": mode,
        })
        return QA_REPLY["answer"]

    class _Table:
        def insert(self, *a, **k): pass
        def delete(self, *a, **k): pass

    stub("rag.pdf_reader", extract_text=None, extract_text_by_page=None)
    stub("rag.chunker", chunk_text=None)
    stub("rag.embedder", get_embedding=lambda text: [0.0])
    stub("rag.vector_store", VectorStore=VectorStore)
    stub("rag.qa", answer_question=answer_question)
    stub("rag.resource_hash_table", global_resource_hash_table=_Table())


_install_stubs()
from rag import rag_pipeline as rp  # noqa: E402
from rag.citations import build_citations  # noqa: E402


def chunk(text, source="Understanding Companies.pdf", page=9, **extra):
    return {"text": text, "source": source, "page": page, **extra}


@pytest.fixture(autouse=True)
def reset():
    STORES.clear()
    QA_CALLS.clear()
    QA_REPLY["answer"] = "A generated answer."
    rp._stores.clear()
    rp._chat_histories.clear()
    yield


def set_store(user, chat, docs):
    STORES[rp._store_folder(user, chat)] = FakeStore(docs)


def ask(q="What is a company?", user=1, chat="c1", filename=None):
    return rp.ask_rag(q, user_id=user, chat_id=chat, filename=filename)


# 1 ---------------------------------------------------------------
def test_single_chunk():
    set_store(1, "c1", [chunk("A company is a legal entity.")])
    r = ask()
    assert r["citations"] == [{
        "id": "source_1",
        "filename": "Understanding Companies.pdf",
        "page": 9,
        "text": "A company is a legal entity.",
    }]


# 2 ---------------------------------------------------------------
def test_multiple_chunks_keep_retrieval_order():
    set_store(1, "c1", [chunk("first", page=3), chunk("second", page=1), chunk("third", page=7)])
    r = ask()
    assert [c["text"] for c in r["citations"]] == ["first", "second", "third"]
    assert [c["page"] for c in r["citations"]] == [3, 1, 7]


# 3 / 4 -----------------------------------------------------------
def test_chunks_from_different_pdfs():
    set_store(1, "c1", [
        chunk("alpha", source="A.pdf", page=2),
        chunk("beta", source="B.pdf", page=5),
    ])
    r = ask()
    got = [(c["filename"], c["page"], c["text"]) for c in r["citations"]]
    assert got == [("A.pdf", 2, "alpha"), ("B.pdf", 5, "beta")]


# 5 ---------------------------------------------------------------
def test_exact_duplicates_collapsed_but_distinct_evidence_kept():
    cites = build_citations([
        chunk("same  text", page=4),
        chunk("same text", page=4),            # whitespace-only difference -> duplicate
        chunk("different text", page=4),       # same page, different evidence -> keep
        chunk("same text", page=5),            # same text, other page -> keep
        chunk("same text", source="Other.pdf", page=4),  # other doc -> keep
    ])
    assert len(cites) == 4
    assert [c["id"] for c in cites] == ["source_1", "source_2", "source_3", "source_4"]


def test_document_id_distinguishes_same_filename():
    cites = build_citations([
        chunk("x", document_id="d1"),
        chunk("x", document_id="d2"),
    ])
    assert len(cites) == 2
    assert [c["document_id"] for c in cites] == ["d1", "d2"]


def test_no_document_id_key_when_chunk_has_none():
    assert "document_id" not in build_citations([chunk("x")])[0]


# 6 ---------------------------------------------------------------
def test_empty_retrieval_gives_no_citations():
    set_store(1, "c1", [])
    r = ask()
    assert r["citations"] == []
    assert r["sources"] == []


def test_no_store_gives_no_citations():
    r = ask(chat="nostore")
    assert r == {"answer": "Please upload a PDF first.", "sources": [], "citations": []}


def test_not_found_answer_gives_no_citations_but_keeps_sources():
    set_store(1, "c1", [chunk("irrelevant")])
    QA_REPLY["answer"] = NOT_FOUND
    r = ask()
    assert r["citations"] == []
    assert r["sources"] == ["Understanding Companies.pdf"]


# 7 ---------------------------------------------------------------
def test_missing_metadata_handled_safely():
    cites = build_citations([
        {"text": "no page", "source": "A.pdf"},
        {"text": "no source", "page": 2},
        {"source": "A.pdf", "page": 1},            # no text -> skipped
        {"text": "   ", "source": "A.pdf", "page": 1},  # blank text -> skipped
        None,
        "not a dict",
    ])
    assert cites == [
        {"id": "source_1", "filename": "A.pdf", "page": None, "text": "no page"},
        {"id": "source_2", "filename": None, "page": 2, "text": "no source"},
    ]


def test_page_value_passed_through_unchanged():
    assert build_citations([chunk("t", page=0)])[0]["page"] == 0
    assert build_citations([chunk("t", page=12)])[0]["page"] == 12


def test_windows_path_source_shown_as_basename():
    assert build_citations([chunk("t", source="C:\\x\\Notes.pdf")])[0]["filename"] == "Notes.pdf"


# 8 ---------------------------------------------------------------
def test_follow_up_citations_belong_to_current_answer():
    set_store(1, "c1", [chunk("one", page=1)])
    first = ask("What is a company?")
    STORES[rp._store_folder(1, "c1")] = FakeStore([chunk("two", page=8)])
    rp._stores.clear()
    second = ask("Can you explain that more simply?")
    assert [c["text"] for c in first["citations"]] == ["one"]
    assert [c["text"] for c in second["citations"]] == ["two"]
    assert second["citations"][0]["page"] == 8
    assert second["citations"][0]["id"] == "source_1"  # IDs are per answer


# 9 ---------------------------------------------------------------
def test_chats_and_users_are_isolated():
    set_store(1, "c1", [chunk("chat one", source="One.pdf", page=1)])
    set_store(1, "c2", [chunk("chat two", source="Two.pdf", page=2)])
    set_store(2, "c1", [chunk("other user", source="Three.pdf", page=3)])
    assert ask(chat="c1")["citations"][0]["filename"] == "One.pdf"
    assert ask(chat="c2")["citations"][0]["filename"] == "Two.pdf"
    assert ask(user=2, chat="c1")["citations"][0]["filename"] == "Three.pdf"


def test_filename_filter_still_applies():
    set_store(1, "c1", [
        chunk("a", source="A.pdf"), chunk("b", source="B.pdf"), chunk("b2", source="B.pdf", page=2),
    ])
    r = ask(filename="B.pdf")
    assert {c["filename"] for c in r["citations"]} == {"B.pdf"}
    assert r["sources"] == ["B.pdf"]


# 10 --------------------------------------------------------------
def test_existing_fields_present():
    set_store(1, "c1", [chunk("t", source="A.pdf"), chunk("u", source="B.pdf")])
    r = ask()
    assert r["answer"] == "A generated answer."
    assert sorted(r["sources"]) == ["A.pdf", "B.pdf"]
    assert "citations" in r


# 11 --------------------------------------------------------------
def test_ids_unique_within_answer():
    cites = build_citations([chunk(f"t{i}", page=i) for i in range(12)])
    ids = [c["id"] for c in cites]
    assert len(ids) == len(set(ids)) == 12


# 12 --------------------------------------------------------------
def test_evidence_text_is_retrieved_chunk_text_not_answer():
    set_store(1, "c1", [chunk("Evidence straight from the PDF.")])
    QA_REPLY["answer"] = "Totally different words (see Fake.pdf, p. 99)."
    r = ask()
    assert r["citations"][0]["text"] == "Evidence straight from the PDF."
    assert r["citations"][0]["filename"] == "Understanding Companies.pdf"
    assert r["citations"][0]["page"] == 9


def test_build_citations_does_not_mutate_input():
    results = [chunk("t")]
    snapshot = copy.deepcopy(results)
    build_citations(results)
    assert results == snapshot


# 13 --------------------------------------------------------------
def test_chat_history_format_and_passing_unchanged():
    set_store(1, "c1", [chunk("t")])
    ask("first question")
    QA_REPLY["answer"] = "second answer"
    ask("second question")
    assert QA_CALLS[0]["history"] == []
    assert QA_CALLS[1]["history"] == [{"question": "first question", "answer": "A generated answer."}]
    stored = rp._chat_histories[rp._store_key(1, "c1")]
    assert stored == [
        {"question": "first question", "answer": "A generated answer."},
        {"question": "second question", "answer": "second answer"},
    ]
    assert all(set(item) == {"question", "answer"} for item in stored)


def test_history_capped_at_five():
    set_store(1, "c1", [chunk("t")])
    for i in range(7):
        ask(f"q{i}")
    assert len(rp._chat_histories[rp._store_key(1, "c1")]) == 5


def test_context_sent_to_model_unchanged():
    set_store(1, "c1", [chunk("body", source="A.pdf", page=3)])
    ask()
    assert QA_CALLS[0]["context"] == "Source: A.pdf (Page 3)\nbody"
