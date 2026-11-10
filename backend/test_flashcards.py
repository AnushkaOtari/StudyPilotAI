"""Tests for POST /flashcards/generate.

Real code under test: routes/flashcard.py, services/flashcard_service.py,
schemas/flashcard_schema.py, app.py, and the real RAG pipeline / FAISS / PyMuPDF.
Faked (same helpers as the citation tests, see citation_test_support.py):
the Gemini client, the embedder and the logged-in user.

    python -m pytest test_flashcards.py -v
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from citation_test_support import GEMINI, build_env  # noqa: E402

CELLS = [[
    "Mitochondria are organelles found in most eukaryotic cells.",
    "Mitochondria produce most of the cell's ATP through cellular respiration.",
    "Cellular respiration is the process cells use to release energy from nutrients.",
    "The nucleus stores the cell's DNA and controls gene expression.",
    "Ribosomes build proteins by reading messenger RNA instructions.",
]]
OTHER_USER = [[
    "Secret contract clause: the supplier must deliver forty containers every month.",
    "Penalties for late delivery are charged at two percent per week of delay.",
    "Arbitration of disputes takes place in Geneva under Swiss law and rules.",
]]
TINY = [["Hi."]]

CARDS = [{"question": f"Question number {i}?", "answer": f"Answer number {i}."} for i in range(1, 8)]


def reply(cards):
    return lambda prompt: json.dumps({"flashcards": cards})


@pytest.fixture()
def env(tmp_path, monkeypatch):
    # Other test files import these with their own stand-ins; start fresh so
    # the route is wired to THIS test's fake login and RAG pipeline.
    for name in ("routes.flashcard", "services.flashcard_service", "services.quiz_services"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    e = build_env(tmp_path, monkeypatch)
    GEMINI.responder = reply(CARDS)
    return e


def generate(env, chat="c1", user_id=1, **body):
    env.login(user_id)
    return env.client.post("/flashcards/generate", json={"chat_id": chat, **body})


# ---------------------------------------------------------------- happy path

def test_returns_only_question_and_answer(env):
    env.upload("c1", "Cells.pdf", CELLS)
    r = generate(env, num_flashcards=5)
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"flashcards"}
    assert len(body["flashcards"]) == 5
    for card in body["flashcards"]:
        assert set(card.keys()) == {"question", "answer"}


def test_requested_count_is_respected_when_gemini_returns_too_many(env):
    env.upload("c1", "Cells.pdf", CELLS)
    assert len(generate(env, num_flashcards=3).json()["flashcards"]) == 3


def test_returns_fewer_cards_when_gemini_has_fewer_not_fake_ones(env):
    env.upload("c1", "Cells.pdf", CELLS)
    GEMINI.responder = reply(CARDS[:2])
    r = generate(env, num_flashcards=6)
    assert r.status_code == 200
    assert len(r.json()["flashcards"]) == 2


def test_default_count_is_ten(env):
    env.upload("c1", "Cells.pdf", CELLS)
    generate(env)
    assert "up to 10 flashcards" in GEMINI.prompts[0]


def test_extra_fields_from_gemini_are_removed(env):
    env.upload("c1", "Cells.pdf", CELLS)
    GEMINI.responder = reply([
        {"question": "What do mitochondria make?", "answer": "ATP.",
         "source": "Cells.pdf", "page": 1, "explanation": "extra"},
    ])
    card = generate(env, num_flashcards=1).json()["flashcards"][0]
    assert card == {"question": "What do mitochondria make?", "answer": "ATP."}


def test_duplicate_and_malformed_cards_are_dropped(env):
    env.upload("c1", "Cells.pdf", CELLS)
    GEMINI.responder = reply([
        {"question": "What is ATP?", "answer": "Energy currency."},
        {"question": "what is  ATP", "answer": "Same question again."},   # duplicate
        {"question": "No answer here?"},                                  # missing answer
        {"question": "  ", "answer": "blank question"},                   # empty question
        "not a card",
        {"question": "What does the nucleus store?", "answer": "DNA."},
    ])
    cards = generate(env, num_flashcards=10).json()["flashcards"]
    assert [c["question"] for c in cards] == ["What is ATP?", "What does the nucleus store?"]


def test_json_in_code_fences_is_accepted(env):
    env.upload("c1", "Cells.pdf", CELLS)
    GEMINI.responder = lambda p: "```json\n" + json.dumps({"flashcards": CARDS[:2]}) + "\n```"
    assert len(generate(env, num_flashcards=2).json()["flashcards"]) == 2


def test_prompt_uses_the_document_text_and_no_source_or_page(env):
    env.upload("c1", "Cells.pdf", CELLS)
    generate(env, num_flashcards=2)
    prompt = GEMINI.prompts[0]
    assert "Mitochondria produce most of the cell's ATP" in prompt
    assert "ONLY the study material" in prompt
    assert "Cells.pdf" not in prompt and "Page" not in prompt


# ------------------------------------------------------------ request validation

@pytest.mark.parametrize("n", [0, -1, 31, 1000])
def test_num_flashcards_out_of_range_is_rejected(env, n):
    env.upload("c1", "Cells.pdf", CELLS)
    assert generate(env, num_flashcards=n).status_code == 422
    assert GEMINI.prompts == []


def test_chat_id_is_required(env):
    env.login(1)
    assert env.client.post("/flashcards/generate", json={"num_flashcards": 3}).status_code == 422


def test_requires_authentication(env):
    env.upload("c1", "Cells.pdf", CELLS)
    assert generate(env, user_id=None, num_flashcards=3).status_code == 401
    assert GEMINI.prompts == []


def test_user_id_in_the_body_is_ignored(env):
    env.upload("c1", "Contract.pdf", OTHER_USER, user_id=1)
    env.login(2)                                   # logged in as user 2 ...
    r = env.client.post("/flashcards/generate",    # ... but the body claims user 1
                        json={"chat_id": "c1", "num_flashcards": 3, "user_id": 1})
    assert r.status_code == 404                    # still treated as user 2
    assert GEMINI.prompts == []


@pytest.mark.parametrize("name", ["../Cells.pdf", "sub/Cells.pdf", "Cells.txt"])
def test_bad_pdf_name_is_rejected(env, name):
    env.upload("c1", "Cells.pdf", CELLS)
    assert generate(env, pdf_name=name).status_code == 400
    assert GEMINI.prompts == []


def test_unsafe_chat_id_is_rejected(env):
    assert generate(env, chat="../other").status_code == 400
    assert GEMINI.prompts == []


# ------------------------------------------------- missing / insufficient context

def test_chat_with_no_documents_gives_404_and_never_calls_gemini(env):
    r = generate(env, chat="empty-chat")
    assert r.status_code == 404
    assert "upload at least one PDF" in r.json()["detail"]
    assert GEMINI.prompts == []


def test_unknown_pdf_name_gives_404(env):
    env.upload("c1", "Cells.pdf", CELLS)
    r = generate(env, pdf_name="Missing.pdf")
    assert r.status_code == 404
    assert GEMINI.prompts == []


def test_too_little_text_gives_422_and_never_calls_gemini(env):
    env.upload("c1", "Tiny.pdf", TINY)
    r = generate(env, num_flashcards=5)
    assert r.status_code == 422
    assert "Not enough information" in r.json()["detail"]
    assert GEMINI.prompts == []


# --------------------------------------------------------- which document is used

def test_pdf_name_limits_cards_to_that_pdf(env):
    env.upload("c1", "Cells.pdf", CELLS)
    env.upload("c1", "Contract.pdf", OTHER_USER)
    assert generate(env, pdf_name="Cells.pdf", num_flashcards=2).status_code == 200
    prompt = GEMINI.prompts[-1]
    assert "Mitochondria" in prompt and "Geneva" not in prompt


def test_pdf_name_must_match_exactly_not_just_end_with(env):
    env.upload("c1", "Cells.pdf", CELLS)
    # "Cells.pdf" ends with "ells.pdf" but is a different file name
    assert generate(env, pdf_name="ells.pdf").status_code == 404


def test_other_user_cannot_use_my_chat_even_with_the_same_chat_id(env):
    env.upload("shared-id", "Contract.pdf", OTHER_USER, user_id=1)
    r = generate(env, chat="shared-id", user_id=2, num_flashcards=3)
    assert r.status_code == 404
    assert GEMINI.prompts == []          # user 1's text never reached Gemini


def test_same_chat_id_for_two_users_keeps_documents_separate(env):
    env.upload("same", "Contract.pdf", OTHER_USER, user_id=1)
    env.upload("same", "Cells.pdf", CELLS, user_id=2)
    assert generate(env, chat="same", user_id=2, num_flashcards=2).status_code == 200
    prompt = GEMINI.prompts[-1]
    assert "Mitochondria" in prompt and "Geneva" not in prompt


def test_other_chat_of_same_user_is_not_used(env):
    env.upload("c1", "Cells.pdf", CELLS)
    env.upload("c2", "Contract.pdf", OTHER_USER)
    generate(env, chat="c2", num_flashcards=2)
    prompt = GEMINI.prompts[-1]
    assert "Geneva" in prompt and "Mitochondria" not in prompt


# ---------------------------------------------------------------- Gemini problems

@pytest.mark.parametrize("bad", [
    "this is not json",
    "[]",
    json.dumps([{"question": "q", "answer": "a"}]),        # list instead of {"flashcards": ...}
    json.dumps({"flashcards": "nope"}),
    json.dumps({"flashcards": []}),
    json.dumps({"flashcards": [{"question": "only a question"}]}),
])
def test_invalid_gemini_output_gives_502_not_fake_cards(env, bad):
    env.upload("c1", "Cells.pdf", CELLS)
    GEMINI.responder = lambda p: bad
    r = generate(env, num_flashcards=3)
    assert r.status_code == 502
    assert "flashcards" not in r.json()
    assert len(GEMINI.prompts) == 2       # tried once, retried once


def test_one_bad_reply_is_retried_and_then_succeeds(env):
    env.upload("c1", "Cells.pdf", CELLS)
    replies = iter(["oops not json", json.dumps({"flashcards": CARDS[:2]})])
    GEMINI.responder = lambda p: next(replies)
    r = generate(env, num_flashcards=2)
    assert r.status_code == 200 and len(r.json()["flashcards"]) == 2


def test_gemini_exception_gives_502_without_leaking_details(env):
    env.upload("c1", "Cells.pdf", CELLS)

    def boom(prompt):
        raise RuntimeError("secret-api-key-123 quota exceeded")

    GEMINI.responder = boom
    r = generate(env, num_flashcards=2)
    assert r.status_code == 502
    assert "secret-api-key" not in r.text


# ------------------------------------------------------ quiz is not affected

def test_quiz_generation_still_works(env):
    from services import quiz_services

    env.upload("c1", "Cells.pdf", CELLS)
    quiz = [{
        "question": "What do mitochondria produce?", "type": "mcq", "difficulty": "easy",
        "topic": "Cells", "options": ["ATP", "DNA", "RNA", "Protein"],
        "correct_answer": "ATP", "explanation": "They make ATP.",
        "source_chunk": "Mitochondria produce most of the cell's ATP",
    }]
    GEMINI.responder = lambda p: json.dumps(quiz)
    result = quiz_services.generate_quiz(None, 1, "c1", num_questions=1)
    assert isinstance(result, list) and result[0]["correct_answer"] == "ATP"
    # and the quiz still reports "no documents" the way it always did
    assert "error" in quiz_services.generate_quiz(None, 1, "no-such-chat")
