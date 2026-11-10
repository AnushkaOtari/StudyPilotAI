"""Tests for GET /files/{filename}?chat_id=... (PDF serving for citations).

Real app.py route, real files on disk, real PyMuPDF. Auth is a stand-in that
returns the logged-in user id (or 401 when nobody is logged in).

    python -m pytest test_pdf_serving.py -v
"""

import os
import sys

import pymupdf
import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from citation_test_support import GEMINI, build_env, faithful_model  # noqa: E402

COMPANY = [["Page one: a company is a legal entity."],
           ["Page two: shareholders enjoy limited liability."],
           ["Page three: directors manage the company."]]
OTHER = [["Secret notes of another chat."]]


@pytest.fixture()
def env(tmp_path, monkeypatch):
    return build_env(tmp_path, monkeypatch)


def get(env, filename, chat, user_id=1):
    env.login(user_id)
    return env.client.get(f"/files/{filename}", params={"chat_id": chat})


def test_serves_the_uploaded_pdf_inline(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    r = get(env, "Companies.pdf", "c1")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("inline;")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "no-store" in r.headers["cache-control"]
    assert r.content[:5] == b"%PDF-"


def test_requires_authentication(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    assert get(env, "Companies.pdf", "c1", user_id=None).status_code == 401


def test_other_user_cannot_read_a_pdf_even_with_the_right_chat_id_and_name(env):
    env.upload("c1", "Companies.pdf", COMPANY, user_id=1)
    r = get(env, "Companies.pdf", "c1", user_id=2)
    assert r.status_code == 404


def test_other_chat_cannot_read_this_chats_pdf(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.upload("c2", "Notes.pdf", OTHER)
    assert get(env, "Companies.pdf", "c2").status_code == 404
    assert get(env, "Notes.pdf", "c1").status_code == 404
    assert get(env, "Notes.pdf", "c2").status_code == 200


def test_same_filename_in_two_chats_returns_each_chats_own_file(env):
    env.upload("c1", "Notes.pdf", COMPANY)
    env.upload("c2", "Notes.pdf", OTHER)
    first = pymupdf.open(stream=get(env, "Notes.pdf", "c1").content, filetype="pdf")
    second = pymupdf.open(stream=get(env, "Notes.pdf", "c2").content, filetype="pdf")
    assert first.page_count == 3 and second.page_count == 1
    assert "Secret notes" in second[0].get_text()


# A bare ".." is not tested: HTTP clients collapse "/files/.." to "/", so it
# never reaches this route.
@pytest.mark.parametrize("name", [
    "..%2F..%2Fapp.py", "%2e%2e%2fapp.pdf", "notes.txt", "app.py", "a%2Fb.pdf",
    "..%5Capp.pdf", "C%3A%5Cwindows%5Cx.pdf",
])
def test_traversal_and_non_pdf_names_are_rejected(env, name):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.login(1)
    r = env.client.get(f"/files/{name}", params={"chat_id": "c1"})
    assert r.status_code in (400, 404)
    assert b"%PDF" not in r.content[:5]


@pytest.mark.parametrize("chat", ["../c1", "c1/../c1", "a b", "..", "c1%00", ""])
def test_bad_chat_ids_are_rejected(env, chat):
    env.upload("c1", "Companies.pdf", COMPANY)
    r = get(env, "Companies.pdf", chat)
    assert r.status_code in (400, 404, 422)


def test_missing_pdf_is_a_clean_404(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    r = get(env, "Gone.pdf", "c1")
    assert r.status_code == 404 and r.json()["detail"] == "PDF not found in this chat."


def test_deleted_pdf_is_no_longer_served(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    env.login(1)
    assert env.client.delete("/files/Companies.pdf", params={"chat_id": "c1"}).status_code == 200
    assert get(env, "Companies.pdf", "c1").status_code == 404


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlinks unavailable")
def test_symlink_pointing_outside_the_chat_folder_is_not_served(env):
    env.upload("c1", "Companies.pdf", COMPANY)
    outside = env.tmp / "outside.pdf"
    outside.write_bytes(b"%PDF-1.4 outside")
    link = env.tmp / "uploads" / "user_1" / "chat_c1" / "Link.pdf"
    os.symlink(outside, link)
    assert get(env, "Link.pdf", "c1").status_code == 404


def test_listing_and_serving_do_not_create_folders_for_unknown_chats(env):
    get(env, "x.pdf", "never-created")
    assert not (env.tmp / "uploads" / "user_1" / "chat_never-created").exists()


def test_citation_page_is_one_based_and_matches_the_served_pdf(env):
    """The cited page number can be used directly to open the served PDF."""
    env.upload("c1", "Companies.pdf", COMPANY)
    GEMINI.responder = faithful_model("limited liability")
    body = env.ask("limited liability shareholders", "c1")
    cite = body["citations"][0]
    served = pymupdf.open(stream=get(env, cite["filename"], "c1").content, filetype="pdf")
    assert cite["page"] == 2
    page_text = served[cite["page"] - 1].get_text()          # viewer pages are 1-based
    assert "limited liability" in page_text
    assert cite["text"].split()[0] in page_text
    assert 1 <= cite["page"] <= served.page_count
