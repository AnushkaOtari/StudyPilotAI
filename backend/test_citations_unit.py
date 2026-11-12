"""Unit tests for validated citations.

Real code under test: rag/citations.py, rag/qa.py (prompt + parsing),
rag/rag_pipeline.py (ask_rag / retrieve_context). Faked: the vector store
contents, the embedder and the Gemini client (see citation_test_support.py).

    python -m pytest test_citations_unit.py -v
"""

import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from citation_test_support import (
    GEMINI,
    context_blocks,
    faithful_model,
    install_stubs,
    labels_containing,
)

# Install mocks BEFORE importing the RAG modules.
install_stubs()

from backend.rag import rag_pipeline as rp
from rag import qa
from rag.citations import (
    assign_source_refs,
    build_citations,
    format_context,
    parse_source_refs,
    resolve_citations,
)

NOT_FOUND = "I couldn't find this information in the uploaded notes."
STORES = {}


class FakeStore:
    def __init__(self, docs):
        self.docs = docs

    def search(self, query_embedding, k=8):
        return [copy.deepcopy(d) for d in self.docs[:k]]


def chunk(text, source="Understanding Companies.pdf", page=9, **extra):
    return {"text": text, "source": source, "page": page, **extra}


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    STORES.clear()
    GEMINI.reset()
    rp._stores.clear()
    rp._chat_histories.clear()
    monkeypatch.setattr(rp, "_get_store", lambda u, c: STORES.get((str(u), str(c))))
    yield


def set_store(user, chat, docs):
    STORES[(str(user), str(chat))] = FakeStore(docs)


def ask(q="What is a company?", user=1, chat="c1", filename=None):
    return rp.ask_rag(q, user_id=user, chat_id=chat, filename=filename)


# =================================================== parse_source_refs
class TestParseSourceRefs:
    def test_marker_line_is_removed_and_refs_returned(self):
        assert parse_source_refs("A company is X.\n\nSOURCE_REFS: S1, S3") == ("A company is X.", ["S1", "S3"])

    def test_case_and_markdown_variants(self):
        assert parse_source_refs("Text.\n**SOURCE_REFS:** s2")[1] == ["S2"]
        assert parse_source_refs("Text.\nsource_refs : S2 , S4")[1] == ["S2", "S4"]

    def test_none_means_no_refs(self):
        assert parse_source_refs("Nope.\nSOURCE_REFS: NONE") == ("Nope.", [])

    def test_missing_marker_means_no_refs(self):
        assert parse_source_refs("Just an answer.") == ("Just an answer.", [])

    def test_inline_labels_removed_and_used_only_without_marker(self):
        assert parse_source_refs("X is Y [S2] and Z [S1, S3].") == ("X is Y and Z.", ["S2", "S1", "S3"])
        text, refs = parse_source_refs("X [S2].\nSOURCE_REFS: S1")
        assert text == "X." and refs == ["S1"]          # marker wins over inline

    def test_duplicate_refs_collapsed_in_order(self):
        assert parse_source_refs("a\nSOURCE_REFS: S2, S1, S2")[1] == ["S2", "S1"]

    def test_normal_brackets_are_left_alone(self):
        assert parse_source_refs("Use list[0] and [note].\nSOURCE_REFS: NONE")[0] == "Use list[0] and [note]."

    def test_none_reply_keeps_old_contract(self):
        assert parse_source_refs(None) == (None, [])

    def test_garbage_in_marker_yields_no_valid_shape(self):
        assert parse_source_refs("a\nSOURCE_REFS: page 9, file.pdf")[1] == []


# ===================================================== assign / context
class TestSourceRefs:
    def test_labels_follow_retrieval_order(self):
        assert assign_source_refs([chunk("a"), chunk("b", page=1), chunk("c", page=2)]) == ["S1", "S2", "S3"]

    def test_exact_duplicates_share_a_label(self):
        refs = assign_source_refs([chunk("a"), chunk("b", page=1), chunk("a"), chunk("a ")])
        assert refs == ["S1", "S2", "S1", "S1"]

    def test_same_text_other_page_or_doc_is_distinct(self):
        refs = assign_source_refs([chunk("a"), chunk("a", page=2), chunk("a", source="Other.pdf")])
        assert refs == ["S1", "S2", "S3"]

    def test_unusable_chunks_get_no_label(self):
        assert assign_source_refs([chunk(""), {"source": "A.pdf"}, None, chunk("ok")]) == [None, None, None, "S1"]

    def test_context_blocks_are_labelled_and_keep_old_header(self):
        ctx = format_context([chunk("body", source="A.pdf", page=3)])
        assert ctx == "[S1] Source: A.pdf (Page 3)\nbody"

    def test_empty_results_give_empty_context(self):
        assert format_context([]) == ""


# =================================================== resolve_citations
class TestResolveCitations:
    RESULTS = [
        chunk("company law text", source="Companies.pdf", page=9),
        chunk("limited liability text", source="Companies.pdf", page=10),
        chunk("tax text", source="Tax.pdf", page=2),
    ]

    def test_only_claimed_chunks_are_cited(self):
        cites = resolve_citations(self.RESULTS, ["S2"])["citations"]
        assert cites == [{"id": "source_1", "filename": "Companies.pdf", "page": 10, "text": "limited liability text"}]

    def test_multiple_pdfs_in_retrieval_order_not_claim_order(self):
        cites = resolve_citations(self.RESULTS, ["S3", "S1"])["citations"]
        assert [(c["filename"], c["page"]) for c in cites] == [("Companies.pdf", 9), ("Tax.pdf", 2)]
        assert [c["id"] for c in cites] == ["source_1", "source_2"]

    def test_invalid_references_rejected(self):
        out = resolve_citations(self.RESULTS, ["S99", "S0", "FAKE", "Companies.pdf", "", None, 7, "S2"])
        assert [c["page"] for c in out["citations"]] == [10]
        assert "S99" in out["invalid_refs"] and "S0" in out["invalid_refs"]

    def test_only_invalid_references_give_no_citations(self):
        assert resolve_citations(self.RESULTS, ["S9"])["citations"] == []

    def test_no_claims_give_no_citations(self):
        assert resolve_citations(self.RESULTS, [])["citations"] == []
        assert resolve_citations(self.RESULTS, None)["citations"] == []

    def test_empty_retrieval(self):
        assert resolve_citations([], ["S1"]) == {"citations": [], "invalid_refs": ["S1"]}

    def test_several_chunks_same_page_are_all_kept_when_all_claimed(self):
        results = [chunk("part one", page=4), chunk("part two", page=4)]
        assert [c["text"] for c in resolve_citations(results, ["S1", "S2"])["citations"]] == ["part one", "part two"]
        assert [c["text"] for c in resolve_citations(results, ["S2"])["citations"]] == ["part two"]

    def test_duplicate_chunks_claimed_once_give_one_citation(self):
        results = [chunk("a"), chunk("b", page=1), chunk("a")]       # FAISS padding style duplicate
        assert len(resolve_citations(results, ["S1"])["citations"]) == 1

    def test_missing_metadata_is_safe(self):
        results = [{"text": "no page", "source": "A.pdf"}, {"text": "no source", "page": 2}]
        assert resolve_citations(results, ["S1", "S2"])["citations"] == [
            {"id": "source_1", "filename": "A.pdf", "page": None, "text": "no page"},
            {"id": "source_2", "filename": None, "page": 2, "text": "no source"},
        ]

    def test_document_id_passthrough_only_if_present(self):
        out = resolve_citations([chunk("a", document_id="d1"), chunk("b", page=1)], ["S1", "S2"])["citations"]
        assert out[0]["document_id"] == "d1" and "document_id" not in out[1]

    def test_evidence_is_the_retrieved_text_and_input_not_mutated(self):
        results = [chunk("exact evidence")]
        snapshot = copy.deepcopy(results)
        assert resolve_citations(results, ["S1"])["citations"][0]["text"] == "exact evidence"
        assert results == snapshot

    def test_page_passed_through_unchanged(self):
        assert resolve_citations([chunk("t", page=1)], ["S1"])["citations"][0]["page"] == 1

    def test_legacy_build_citations_still_cites_everything(self):
        assert len(build_citations(self.RESULTS)) == 3


# ====================================================== real qa.py
class TestQaModule:
    def test_prompt_without_refs_has_no_reference_section(self):
        prompt = qa._build_prompt("Q?", "ctx", [], "normal")
        assert "SOURCE REFERENCES" not in prompt and "SOURCE_REFS" not in prompt
        assert prompt.rstrip().endswith("Answer:")

    def test_prompt_with_refs_adds_instructions_before_answer(self):
        prompt = qa._build_prompt("Q?", "[S1] ctx", [], "normal", include_source_refs=True)
        assert "SOURCE_REFS: NONE" in prompt
        assert prompt.index("SOURCE REFERENCES") < prompt.rindex("Answer:")

    def test_answer_question_keeps_returning_text_and_model(self):
        GEMINI.responder = lambda p: "plain text"
        assert qa.answer_question("Q?", "ctx", [], "normal") == "plain text"
        assert GEMINI.models_used == ["gemini-3.1-flash-lite"]

    def test_answer_question_with_sources_parses_the_reply(self):
        GEMINI.responder = lambda p: "Answer text.\nSOURCE_REFS: S2"
        assert qa.answer_question_with_sources("Q?", "ctx", [], "normal") == ("Answer text.", ["S2"])


# ======================================================== ask_rag
class TestAskRag:
    def test_only_supporting_chunk_is_cited_among_many_retrieved(self):
        set_store(1, "c1", [
            chunk("Unrelated trivia about weather.", page=1),
            chunk("A company is a legal entity separate from its owners.", page=9),
            chunk("More unrelated trivia about sport.", page=3),
        ])
        GEMINI.responder = faithful_model("legal entity")
        r = ask()
        assert [(c["filename"], c["page"]) for c in r["citations"]] == [("Understanding Companies.pdf", 9)]
        assert r["citations"][0]["text"].startswith("A company is a legal entity")
        assert r["sources"] == ["Understanding Companies.pdf"]      # sources unchanged

    def test_no_supporting_reference_means_no_citations(self):
        set_store(1, "c1", [chunk("something"), chunk("else", page=2)])
        GEMINI.responder = lambda p: "An answer.\nSOURCE_REFS: NONE"
        r = ask()
        assert r["citations"] == [] and r["sources"] == ["Understanding Companies.pdf"]

    def test_missing_marker_fails_closed(self):
        set_store(1, "c1", [chunk("something")])
        GEMINI.responder = lambda p: "An answer with no reference line."
        assert ask()["citations"] == []

    def test_invented_references_are_ignored(self):
        set_store(1, "c1", [chunk("only chunk")])
        GEMINI.responder = lambda p: "Answer.\nSOURCE_REFS: S7, Fake.pdf p. 99, S1"
        r = ask()
        assert [c["text"] for c in r["citations"]] == ["only chunk"]
        GEMINI.responder = lambda p: "Answer.\nSOURCE_REFS: S7"
        assert ask()["citations"] == []

    def test_filename_and_page_in_the_answer_text_are_never_trusted(self):
        set_store(1, "c1", [chunk("real text", source="Real.pdf", page=4)])
        GEMINI.responder = lambda p: "See Invented.pdf page 99.\nSOURCE_REFS: S1"
        c = ask()["citations"][0]
        assert (c["filename"], c["page"], c["text"]) == ("Real.pdf", 4, "real text")

    def test_not_found_reply_never_cites_even_if_refs_listed(self):
        set_store(1, "c1", [chunk("x")])
        GEMINI.responder = lambda p: f"{NOT_FOUND}\nSOURCE_REFS: S1"
        r = ask()
        assert r["answer"] == NOT_FOUND and r["citations"] == []

    def test_multiple_pdfs_and_answer_supported_by_several_pages(self):
        set_store(1, "c1", [
            chunk("shareholders limited liability", source="A.pdf", page=2),
            chunk("noise", source="A.pdf", page=5),
            chunk("company tax on profits", source="B.pdf", page=7),
        ])
        GEMINI.responder = faithful_model("limited liability", "tax on profits")
        r = ask()
        assert [(c["filename"], c["page"]) for c in r["citations"]] == [("A.pdf", 2), ("B.pdf", 7)]
        assert sorted(r["sources"]) == ["A.pdf", "B.pdf"]

    def test_same_page_chunks_cited_individually(self):
        set_store(1, "c1", [chunk("alpha idea", page=4), chunk("beta idea", page=4), chunk("gamma", page=6)])
        GEMINI.responder = faithful_model("beta")
        assert [c["text"] for c in ask()["citations"]] == ["beta idea"]

    def test_padding_duplicates_do_not_create_extra_citations(self):
        set_store(1, "c1", [chunk("only real chunk"), chunk("only real chunk")])
        GEMINI.responder = lambda p: "A.\nSOURCE_REFS: S1"
        assert len(ask()["citations"]) == 1

    def test_empty_retrieval(self):
        set_store(1, "c1", [])
        GEMINI.responder = lambda p: "Hmm.\nSOURCE_REFS: S1"
        r = ask()
        assert r["citations"] == [] and r["sources"] == []

    def test_no_store_response_unchanged(self):
        assert ask(chat="none") == {"answer": "Please upload a PDF first.", "sources": [], "citations": []}

    def test_missing_page_metadata_still_cites_safely(self):
        set_store(1, "c1", [{"text": "no page chunk", "source": "A.pdf"}])
        GEMINI.responder = lambda p: "A.\nSOURCE_REFS: S1"
        assert ask()["citations"] == [{"id": "source_1", "filename": "A.pdf", "page": None, "text": "no page chunk"}]

    def test_prompt_contains_labelled_context_for_this_request(self):
        set_store(1, "c1", [chunk("first body", source="A.pdf", page=3), chunk("second body", source="B.pdf", page=8)])
        ask()
        blocks = context_blocks(GEMINI.prompts[-1])
        assert blocks == [("S1", "Source: A.pdf (Page 3)", "first body"),
                          ("S2", "Source: B.pdf (Page 8)", "second body")]
        assert labels_containing(GEMINI.prompts[-1], "second") == ["S2"]

    def test_follow_up_citations_belong_to_the_current_answer(self):
        set_store(1, "c1", [chunk("topic one", page=1), chunk("topic two", page=2)])
        GEMINI.responder = faithful_model("topic one")
        first = ask("What is topic one?")
        GEMINI.responder = faithful_model("topic two")
        second = ask("Explain that more simply")
        assert [c["page"] for c in first["citations"]] == [1]
        assert [c["page"] for c in second["citations"]] == [2]
        assert second["citations"][0]["id"] == "source_1"

    def test_chats_and_users_are_isolated(self):
        set_store(1, "c1", [chunk("chat one", source="One.pdf")])
        set_store(1, "c2", [chunk("chat two", source="Two.pdf")])
        set_store(2, "c1", [chunk("other user", source="Three.pdf")])
        assert ask(chat="c1")["citations"][0]["filename"] == "One.pdf"
        assert ask(chat="c2")["citations"][0]["filename"] == "Two.pdf"
        assert ask(user=2, chat="c1")["citations"][0]["filename"] == "Three.pdf"

    def test_filename_filter_still_limits_retrieval_and_citations(self):
        set_store(1, "c1", [chunk("a", source="A.pdf"), chunk("b", source="B.pdf"), chunk("b2", source="B.pdf", page=2)])
        GEMINI.responder = lambda p: "x\nSOURCE_REFS: S1, S2, S3"
        r = ask(filename="B.pdf")
        assert {c["filename"] for c in r["citations"]} == {"B.pdf"} and r["sources"] == ["B.pdf"]

    def test_existing_response_fields_present(self):
        set_store(1, "c1", [chunk("t")])
        r = ask()
        assert set(r) == {"answer", "sources", "citations"}
        assert r["answer"] == "A generated answer."


# ============================================ chat history unchanged
class TestChatHistory:
    def test_history_stores_clean_answers_without_reference_lines(self):
        set_store(1, "c1", [chunk("t")])
        GEMINI.responder = lambda p: "first answer [S1]\nSOURCE_REFS: S1"
        ask("q1")
        GEMINI.responder = lambda p: "second answer\nSOURCE_REFS: S1"
        ask("q2")
        hist = rp._chat_histories[rp._store_key(1, "c1")]
        assert hist == [{"question": "q1", "answer": "first answer"},
                        {"question": "q2", "answer": "second answer"}]

    def test_history_reaches_gemini_in_the_same_format_and_without_markers(self):
        set_store(1, "c1", [chunk("t")])
        ask("q1")
        ask("q2")
        second_prompt = GEMINI.prompts[1]
        assert "Student: q1\nStudyPilot AI: A generated answer." in second_prompt
        history_part = second_prompt.split("CURRENT PDF CONTEXT:")[0]
        assert "SOURCE_REFS" not in history_part

    def test_history_capped_at_five(self):
        set_store(1, "c1", [chunk("t")])
        for i in range(7):
            ask(f"q{i}")
        assert len(rp._chat_histories[rp._store_key(1, "c1")]) == 5
