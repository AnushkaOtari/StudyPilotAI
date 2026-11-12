"""Tests for the Knowledge Graph feature.

Real code under test: services/knowledge_graph_{store,service,worker}.py,
routes/knowledge_graph.py, schemas/knowledge_graph_schema.py, the hooks in
app.py and rag/document_queue.py, plus the real RAG pipeline / FAISS / PyMuPDF.
Faked (see citation_test_support.py): the embedder, the logged-in user and
Gemini. Gemini is NEVER called for real: tests either replace
`call_gemini` or use the fake client.

    python -m pytest test_knowledge_graph.py -v
"""

import json
import os
import sys
import threading

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from citation_test_support import GEMINI, build_env, faithful_model, make_pdf  # noqa: E402

KG_MODULES = (
    "services.knowledge_graph_store",
    "services.knowledge_graph_service",
    "services.knowledge_graph_worker",
    "routes.knowledge_graph",
    "schemas.knowledge_graph_schema",
)

CELLS = [[
    "Mitochondria are organelles found in most eukaryotic cells.",
    "Mitochondria produce most of the cell's ATP through respiration.",
]]
CELLS_V2 = [[
    "The nucleus stores the cell's DNA and controls gene expression.",
    "Ribosomes build proteins by reading messenger RNA instructions.",
]]
BIOLOGY = [
    ["Photosynthesis is the process plants use to make food from light."],
    ["Chlorophyll absorbs light inside the chloroplast of a plant cell."],
]
SECRET = [["Secret contract clause: the supplier delivers forty containers."]]


def node(i, label, pages=(1,), typ="concept", desc=""):
    return {"id": i, "label": label, "description": desc or f"{label} description.",
            "type": typ, "pages": list(pages)}


CELL_REPLY = {
    "nodes": [node("c1", "Cell", (1,), "main_topic", "Basic unit of life."),
              node("c2", "Mitochondria", (1,), "concept", "Produces ATP.")],
    "edges": [{"source": "c2", "target": "c1", "relationship": "PART_OF", "label": "is part of"}],
}
BIO_REPLY = {
    "nodes": [node("a", "Photosynthesis", (1,), "main_topic"),
              node("b", "Chlorophyll", (2,)),
              node("c", "Cell", (2,), "concept", "A cell is the smallest living unit of an organism.")],
    "edges": [{"source": "b", "target": "a", "relationship": "PART_OF", "label": "drives"}],
}
SECRET_REPLY = {"nodes": [node("s", "Supplier Contract", (1,))], "edges": []}
REPLIES = {"Cells.pdf": CELL_REPLY, "Bio.pdf": BIO_REPLY, "Secret.pdf": SECRET_REPLY}


def _filename_in(prompt):
    return prompt.split("SOURCE DOCUMENT: ", 1)[1].split("\n", 1)[0].strip()


# ======================================================================
# Fixtures
# ======================================================================

@pytest.fixture()
def env(tmp_path, monkeypatch):
    # Fresh graph modules (their state is module-level) for every test.
    for name in KG_MODULES:
        monkeypatch.delitem(sys.modules, name, raising=False)

        # `from services import x` would otherwise return the stale module
        # cached as an attribute of its package.
        package, _, short = name.rpartition(".")
        if package in sys.modules:
            monkeypatch.delattr(sys.modules[package], short, raising=False)

    monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    e = build_env(tmp_path, monkeypatch)

    e.store = sys.modules["services.knowledge_graph_store"]
    e.kg = sys.modules["services.knowledge_graph_service"]
    e.wm = sys.modules["services.knowledge_graph_worker"]
    e.worker = e.wm.get_worker()
    e.calls = []

    def default_responder(prompt):
        e.calls.append(prompt)
        return json.dumps(REPLIES.get(_filename_in(prompt), CELL_REPLY))

    e.set_gemini = lambda fn: monkeypatch.setattr(e.kg, "call_gemini", fn)
    e.set_gemini(default_responder)

    def upload(chat, filename, pages, user_id=1, wait=True):
        e.login(user_id)
        # Same content -> same bytes, like re-uploading the same file
        # (PyMuPDF stamps a fresh date/id into every PDF it writes).
        tag = abs(hash(repr(pages)))
        pdf = tmp_path / "_src" / f"u{user_id}" / f"{tag}" / filename
        if not pdf.exists():
            pdf.parent.mkdir(parents=True, exist_ok=True)
            make_pdf(pdf, pages)
        with open(pdf, "rb") as f:
            r = e.client.post("/upload", data={"chat_id": chat},
                              files={"files": (filename, f, "application/pdf")})
        assert r.status_code == 200, r.text
        if wait:
            assert e.worker.wait_idle(10)
        return r

    def get(path, chat, user_id=1, **params):
        e.login(user_id)
        return e.client.get(f"/knowledge-graph{path}", params={"chat_id": chat, **params})

    e.kg_upload, e.get = upload, get
    return e


# ======================================================================
# 1. Concept extraction response parsing
# ======================================================================

class TestParsing:

    @pytest.fixture()
    def kg(self, env):
        return env.kg

    def test_plain_json(self, kg):
        assert kg.parse_model_json('{"nodes": [], "edges": []}') == {"nodes": [], "edges": []}

    def test_fenced_json(self, kg):
        raw = '```json\n{"nodes": [{"label": "A"}], "edges": []}\n```'
        assert kg.parse_model_json(raw)["nodes"][0]["label"] == "A"

    def test_json_wrapped_in_prose(self, kg):
        raw = 'Sure! Here you go: {"nodes": [], "edges": []} Hope it helps.'
        assert kg.parse_model_json(raw) == {"nodes": [], "edges": []}

    def test_missing_edges_defaults_to_empty(self, kg):
        assert kg.parse_model_json('{"nodes": []}')["edges"] == []

    @pytest.mark.parametrize("raw", [
        "", "   ", None, "not json at all", '{"nodes": [', "[1, 2, 3]",
        '{"edges": []}', '{"nodes": "x"}', '{"nodes": [], "edges": "x"}',
    ])
    def test_malformed_or_incomplete_replies_are_rejected(self, kg, raw):
        with pytest.raises(kg.GraphParseError):
            kg.parse_model_json(raw)


# ======================================================================
# 2. Relationship / node validation
# ======================================================================

class TestValidation:

    def build(self, kg, data, pages=(1, 2)):
        b = kg.DocGraphBuilder()
        b.add_window(data, set(pages))
        return b.build()

    def test_all_seven_relationships_accepted(self, env):
        kg = env.kg
        nodes = [node(f"n{i}", f"Concept {chr(65 + i)}") for i in range(8)]
        edges = [{"source": f"n{i}", "target": f"n{i + 1}", "relationship": rel}
                 for i, rel in enumerate(kg.RELATIONSHIPS)]
        _, out = self.build(kg, {"nodes": nodes, "edges": edges})
        assert sorted(e["relationship"] for e in out) == sorted(kg.RELATIONSHIPS)

    def test_invalid_edges_are_dropped(self, env):
        kg = env.kg
        data = {
            "nodes": [node("a", "Alpha"), node("b", "Beta")],
            "edges": [
                {"source": "a", "target": "b", "relationship": "FRIENDS_WITH"},   # unknown type
                {"source": "a", "target": "zzz", "relationship": "PART_OF"},      # unknown target
                {"source": "a", "target": "a", "relationship": "PART_OF"},        # self loop
                {"source": "a", "target": "b", "relationship": "PART_OF", "label": "ok"},
                {"source": "a", "target": "b", "relationship": "part of"},        # duplicate (normalised)
                "garbage", None, {"source": "a"},
            ],
        }
        _, edges = self.build(kg, data)
        assert [(e["relationship"], e["label"]) for e in edges] == [("PART_OF", "ok")]

    def test_relationship_is_normalised_and_gets_default_label(self, env):
        kg = env.kg
        data = {"nodes": [node("a", "Alpha"), node("b", "Beta")],
                "edges": [{"source": "a", "target": "b", "relationship": " leads-to "}]}
        _, edges = self.build(kg, data)
        assert edges[0]["relationship"] == "LEADS_TO"
        assert edges[0]["label"] == "leads to"

    def test_edge_may_reference_a_node_by_label(self, env):
        kg = env.kg
        data = {"nodes": [node("a", "Alpha"), node("b", "Beta")],
                "edges": [{"source": "Alpha", "target": "beta", "relationship": "RELATED_TO"}]}
        _, edges = self.build(kg, data)
        assert len(edges) == 1

    def test_node_validation(self, env):
        kg = env.kg
        data = {"nodes": [
            node("a", "Good", pages=(1, 2, 99)),                        # page 99 not in window
            {"id": "b", "label": "", "pages": [1]},                     # empty label
            {"id": "c", "label": "x" * 500},                            # label too long
            {"id": "d", "label": "Odd type", "type": "banana", "pages": ["2", True, 1.5]},
            "not a dict", None, {"id": "e"},                            # no label
        ], "edges": []}
        nodes, _ = self.build(kg, data)
        by_label = {n["label"]: n for n in nodes}
        assert set(by_label) == {"Good", "Odd type"}
        assert by_label["Good"]["pages"] == [1, 2]
        assert by_label["Odd type"]["type"] == "concept"
        assert by_label["Odd type"]["pages"] == [2]

    def test_duplicate_concepts_in_one_document_are_combined(self, env):
        kg = env.kg
        b = kg.DocGraphBuilder()
        b.add_window({"nodes": [node("a", "Cell", (1,), "concept", "short")], "edges": []}, {1, 2})
        b.add_window({"nodes": [node("z", "cells", (2,), "main_topic", "a much longer description")],
                      "edges": []}, {1, 2})
        nodes, _ = b.build()
        assert len(nodes) == 1
        assert nodes[0]["pages"] == [1, 2]
        assert nodes[0]["type"] == "main_topic"
        assert nodes[0]["description"] == "a much longer description"

    def test_normalize_label(self, env):
        n = env.kg.normalize_label
        assert n("Cell") == n("cells") == n("  CELL. ")
        assert n("Cell") != n("Cell membrane")
        assert n("Process") == "process"       # not stripped to "proces"
        assert n("Analysis") == "analysis"
        assert n("Theories") == n("Theory")
        assert n("!!!") == ""


# ======================================================================
# 3. Whole-document extraction
# ======================================================================

class TestExtraction:

    def pdf(self, tmp_path, pages):
        path = tmp_path / "doc.pdf"
        make_pdf(path, pages)
        return str(path)

    def test_build_windows_marks_pages_and_skips_blank_pages(self, env):
        windows, truncated = env.kg.build_windows(
            [(1, "First page has enough text."), (2, "  "), (3, "Third page has enough text.")])
        assert not truncated and len(windows) == 1
        assert windows[0]["pages"] == {1, 3}
        assert "[PAGE 1]" in windows[0]["text"] and "[PAGE 2]" not in windows[0]["text"]

    def test_large_pdf_is_capped(self, env):
        kg = env.kg
        pages = [(i, "x" * 5000) for i in range(1, 400)]
        windows, truncated = kg.build_windows(pages)
        assert len(windows) <= kg.MAX_WINDOWS
        assert all(len(w["text"]) < kg.MAX_WINDOW_CHARS_HARD + 200 for w in windows)

    def test_no_text_fails_without_calling_gemini(self, env, tmp_path):
        calls = []
        with pytest.raises(env.kg.GraphGenerationError, match="No readable text"):
            env.kg.extract_document_graph(self.pdf(tmp_path, [[""]]), "doc.pdf",
                                          lambda p: calls.append(p), lambda: False)
        assert calls == []

    def test_success(self, env, tmp_path):
        result = env.kg.extract_document_graph(
            self.pdf(tmp_path, CELLS), "doc.pdf", lambda p: json.dumps(CELL_REPLY), lambda: False)
        assert {n["label"] for n in result["nodes"]} == {"Cell", "Mitochondria"}
        assert result["stats"]["windows_succeeded"] == 1

    def test_prompt_contains_filename_and_page_markers(self, env, tmp_path):
        seen = []
        env.kg.extract_document_graph(
            self.pdf(tmp_path, CELLS), "doc.pdf",
            lambda p: seen.append(p) or json.dumps(CELL_REPLY), lambda: False)
        assert "SOURCE DOCUMENT: doc.pdf" in seen[0] and "[PAGE 1]" in seen[0]

    def multi_window(self, env, monkeypatch):
        original = env.kg.build_windows
        monkeypatch.setattr(env.kg, "build_windows", lambda pages: original(pages, max_chars=80))

    def test_a_bad_window_is_skipped_but_the_rest_is_kept(self, env, tmp_path, monkeypatch):
        self.multi_window(env, monkeypatch)
        replies = iter(["this is not json", json.dumps(CELL_REPLY)])
        result = env.kg.extract_document_graph(
            self.pdf(tmp_path, [["Page one has plenty of words in it."],
                                ["Page two has plenty of words in it."]]),
            "doc.pdf", lambda p: next(replies), lambda: False)
        assert result["stats"]["windows"] == 2
        assert result["stats"]["windows_failed"] == 1
        assert result["warnings"] and result["nodes"]

    def test_all_windows_bad_fails(self, env, tmp_path):
        with pytest.raises(env.kg.GraphGenerationError, match="valid JSON"):
            env.kg.extract_document_graph(self.pdf(tmp_path, CELLS), "doc.pdf",
                                          lambda p: "nope", lambda: False)

    def test_no_concepts_fails(self, env, tmp_path):
        with pytest.raises(env.kg.GraphGenerationError, match="No academic concepts"):
            env.kg.extract_document_graph(self.pdf(tmp_path, CELLS), "doc.pdf",
                                          lambda p: '{"nodes": [], "edges": []}', lambda: False)

    def test_api_error_is_retried_once_then_succeeds(self, env, tmp_path):
        calls = []

        def flaky(prompt):
            calls.append(1)
            if len(calls) == 1:
                raise RuntimeError("503 unavailable")
            return json.dumps(CELL_REPLY)

        result = env.kg.extract_document_graph(self.pdf(tmp_path, CELLS), "d.pdf", flaky, lambda: False)
        assert len(calls) == 2 and result["nodes"]

    def test_persistent_api_error_fails_with_a_safe_message(self, env, tmp_path):
        def down(prompt):
            raise RuntimeError("secret internal detail")

        with pytest.raises(env.kg.GraphGenerationError) as exc:
            env.kg.extract_document_graph(self.pdf(tmp_path, CELLS), "d.pdf", down, lambda: False)
        assert "secret" not in str(exc.value)

    def test_abort_stops_before_calling_gemini(self, env, tmp_path):
        calls = []
        with pytest.raises(env.kg.GraphAborted):
            env.kg.extract_document_graph(self.pdf(tmp_path, CELLS), "d.pdf",
                                          lambda p: calls.append(p), lambda: True)
        assert calls == []

    def test_call_gemini_uses_the_existing_client_and_model(self, env, monkeypatch):
        monkeypatch.undo()  # drop the call_gemini mock; keep nothing else
        # undo() also removed the env vars set by the fixture; set the key again
        monkeypatch.setenv("GEMINI_API_KEY", "test-key")
        GEMINI.responder = lambda prompt: '{"nodes": [], "edges": []}'
        assert env.kg.call_gemini("hello") == '{"nodes": [], "edges": []}'
        assert GEMINI.models_used == [env.kg.MODEL_NAME]

    def test_call_gemini_without_key_raises_config_error(self, env, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.undo()
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        before = len(GEMINI.prompts)
        with pytest.raises(env.kg.GraphConfigError, match="GEMINI_API_KEY"):
            env.kg.call_gemini("hello")
        assert len(GEMINI.prompts) == before


# ======================================================================
# 4. Merging
# ======================================================================

class TestMerging:

    def record(self, filename, nodes, edges=()):
        return {"filename": filename, "nodes": nodes, "edges": list(edges)}

    def doc(self, env, filename, reply):
        b = env.kg.DocGraphBuilder()
        b.add_window(reply, {1, 2, 3})
        nodes, edges = b.build()
        return self.record(filename, nodes, edges)

    def test_same_concept_in_two_pdfs_is_one_node_with_both_sources(self, env):
        a = self.doc(env, "Cells.pdf", CELL_REPLY)
        b = self.doc(env, "Bio.pdf", BIO_REPLY)
        nodes, _ = env.kg.merge_documents([a, b])
        cell = [n for n in nodes if n["label"] == "Cell"]
        assert len(cell) == 1
        sources = {s["document"]: s for s in cell[0]["sources"]}
        assert sources["Cells.pdf"]["pages"] == [1]
        assert sources["Bio.pdf"]["pages"] == [2]
        assert sources["Bio.pdf"]["description"].startswith("A cell is the smallest")
        assert cell[0]["type"] == "main_topic"
        assert cell[0]["description"].startswith("A cell is the smallest")  # longest wins

    def test_similar_but_different_names_are_not_merged(self, env):
        a = self.doc(env, "A.pdf", {"nodes": [node("1", "Cell")], "edges": []})
        b = self.doc(env, "B.pdf", {"nodes": [node("1", "Cell membrane"), node("2", "Cell wall")],
                                    "edges": []})
        nodes, _ = env.kg.merge_documents([a, b])
        assert sorted(n["label"] for n in nodes) == ["Cell", "Cell membrane", "Cell wall"]

    def test_edges_are_kept_and_remember_every_document(self, env):
        same = {"nodes": [node("1", "Alpha"), node("2", "Beta")],
                "edges": [{"source": "1", "target": "2", "relationship": "CAUSES"}]}
        other = {"nodes": [node("1", "Alpha"), node("2", "Beta")],
                 "edges": [{"source": "1", "target": "2", "relationship": "CAUSES"},
                           {"source": "2", "target": "1", "relationship": "RELATED_TO"}]}
        nodes, edges = env.kg.merge_documents([self.doc(env, "A.pdf", same), self.doc(env, "B.pdf", other)])
        assert len(nodes) == 2 and len(edges) == 2
        causes = [e for e in edges if e["relationship"] == "CAUSES"][0]
        assert causes["documents"] == ["A.pdf", "B.pdf"]
        ids = {n["id"] for n in nodes}
        assert all(e["source"] in ids and e["target"] in ids for e in edges)

    def test_merge_is_deterministic_regardless_of_input_order(self, env):
        a = self.doc(env, "Cells.pdf", CELL_REPLY)
        b = self.doc(env, "Bio.pdf", BIO_REPLY)
        assert env.kg.merge_documents([a, b]) == env.kg.merge_documents([b, a])

    def test_merge_of_nothing(self, env):
        assert env.kg.merge_documents([]) == ([], [])


# ======================================================================
# 5. Storage
# ======================================================================

class TestStore:

    def rec(self, name="A.pdf", status="COMPLETED"):
        return {"filename": name, "status": status, "nodes": [], "edges": []}

    def test_round_trip_and_list(self, env):
        s = env.store
        token = s.current_token(1, "c1", "A.pdf")
        assert s.save_doc(1, "c1", "A.pdf", self.rec(), token)
        assert s.read_doc(1, "c1", "A.pdf")["status"] == "COMPLETED"
        assert [r["filename"] for r in s.list_docs(1, "c1")] == ["A.pdf"]
        assert s.read_doc(1, "c1", "B.pdf") is None
        assert os.path.isdir(os.path.join("knowledge_graphs", "user_1", "chat_c1", "docs"))

    def test_users_and_chats_are_isolated(self, env):
        s = env.store
        s.save_doc(1, "c1", "A.pdf", self.rec(), s.current_token(1, "c1", "A.pdf"))
        assert s.read_doc(2, "c1", "A.pdf") is None
        assert s.read_doc(1, "c2", "A.pdf") is None
        assert s.list_docs(2, "c1") == [] and s.list_docs(1, "c2") == []

    def test_unsafe_ids_are_rejected(self, env):
        for bad in ("../x", "a/b", "", "a b"):
            with pytest.raises(ValueError):
                env.store.chat_folder(1, bad)

    def test_corrupt_record_is_skipped_not_fatal(self, env):
        s = env.store
        s.save_doc(1, "c1", "A.pdf", self.rec(), s.current_token(1, "c1", "A.pdf"))
        folder = os.path.join("knowledge_graphs", "user_1", "chat_c1", "docs")
        with open(os.path.join(folder, "broken.json"), "w") as f:
            f.write("{not json")
        assert [r["filename"] for r in s.list_docs(1, "c1")] == ["A.pdf"]

    def test_stale_token_after_document_delete_cannot_write(self, env):
        s = env.store
        token = s.current_token(1, "c1", "A.pdf")
        s.save_doc(1, "c1", "A.pdf", self.rec(), token)
        s.delete_doc(1, "c1", "A.pdf")
        assert s.read_doc(1, "c1", "A.pdf") is None
        assert not s.save_doc(1, "c1", "A.pdf", self.rec(), token)
        assert s.read_doc(1, "c1", "A.pdf") is None
        # A fresh job (re-upload) can write again.
        assert s.save_doc(1, "c1", "A.pdf", self.rec(), s.current_token(1, "c1", "A.pdf"))

    def test_clearing_a_chat_invalidates_running_jobs(self, env):
        s = env.store
        token = s.current_token(1, "c1", "A.pdf")
        s.save_doc(1, "c1", "A.pdf", self.rec(), token)
        s.clear_chat(1, "c1")
        assert not os.path.exists(os.path.join("knowledge_graphs", "user_1"))
        assert not s.save_doc(1, "c1", "A.pdf", self.rec(), token)
        assert not os.path.exists("knowledge_graphs/user_1")

    def test_permanent_deletion_blocks_all_future_writes(self, env):
        s = env.store
        s.clear_chat(1, "c1", permanent=True)
        assert s.is_chat_deleted(1, "c1")
        assert not s.save_doc(1, "c1", "A.pdf", self.rec(), s.current_token(1, "c1", "A.pdf"))
        assert not os.path.exists("knowledge_graphs/user_1")

    def test_clearing_one_chat_leaves_others(self, env):
        s = env.store
        for user, chat in ((1, "c1"), (1, "c2"), (2, "c1")):
            s.save_doc(user, chat, "A.pdf", self.rec(), s.current_token(user, chat, "A.pdf"))
        s.clear_chat(1, "c1", permanent=True)
        assert s.read_doc(1, "c2", "A.pdf") and s.read_doc(2, "c1", "A.pdf")
        assert s.read_doc(1, "c1", "A.pdf") is None


# ======================================================================
# 6. End to end: generation, status, endpoints
# ======================================================================

class TestGeneration:

    def test_upload_triggers_generation_and_graph_is_served(self, env):
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        assert all(j["status"] == "COMPLETED" for j in r.json()["jobs"])

        status = env.get("/status", "c1").json()
        assert status["status"] == "COMPLETED"
        assert status["documents"][0]["filename"] == "Cells.pdf"
        assert status["documents"][0]["node_count"] == 2

        body = env.get("", "c1").json()
        assert body["status"] == "COMPLETED"
        assert {n["label"] for n in body["nodes"]} == {"Cell", "Mitochondria"}
        assert body["nodes"][0]["sources"][0]["document"] == "Cells.pdf"
        assert body["edges"][0]["relationship"] == "PART_OF"
        assert body["stats"] == {"node_count": 2, "edge_count": 1, "document_count": 1}
        assert len(env.calls) == 1

    def test_graph_is_stored_outside_the_vector_store(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        assert os.path.isdir("knowledge_graphs/user_1/chat_c1/docs")
        assert sorted(os.listdir("vectorstores/user_1/chat_c1")) == ["documents.pkl", "faiss.index"]

    def test_multiple_pdfs_in_one_chat_are_merged(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Bio.pdf", BIOLOGY)
        body = env.get("", "c1").json()
        labels = sorted(n["label"] for n in body["nodes"])
        assert labels == ["Cell", "Chlorophyll", "Mitochondria", "Photosynthesis"]
        cell = [n for n in body["nodes"] if n["label"] == "Cell"][0]
        assert {s["document"] for s in cell["sources"]} == {"Cells.pdf", "Bio.pdf"}
        assert body["stats"]["document_count"] == 2
        assert {d["filename"] for d in body["documents"]} == {"Cells.pdf", "Bio.pdf"}

    def test_single_document_graph(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Bio.pdf", BIOLOGY)
        body = env.get("/documents/Bio.pdf", "c1").json()
        assert body["filename"] == "Bio.pdf" and body["status"] == "COMPLETED"
        assert {n["label"] for n in body["nodes"]} == {"Photosynthesis", "Chlorophyll", "Cell"}
        assert all(s["document"] == "Bio.pdf" for n in body["nodes"] for s in n["sources"])

    def test_document_endpoint_errors(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        assert env.get("/documents/Nope.pdf", "c1").status_code == 404
        assert env.get("/documents/notes.txt", "c1").status_code == 400
        assert env.get("/documents/Cells.pdf", "bad chat!").status_code == 400
        assert env.get("/documents/Cells.pdf", "missing").status_code == 404

    def test_pdf_without_a_record_reports_not_started(self, env, monkeypatch):
        monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "0")
        env.kg_upload("c1", "Cells.pdf", CELLS)
        status = env.get("/status", "c1").json()
        assert status["status"] == "NOT_STARTED"
        assert status["documents"][0]["status"] == "NOT_STARTED"
        assert env.get("/documents/Cells.pdf", "c1").status_code == 404
        assert env.calls == []

    def test_requires_authentication(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        for path in ("", "/status", "/documents/Cells.pdf"):
            assert env.get(path, "c1", user_id=None).status_code == 401
        env.login(None)
        assert env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate",
                               params={"chat_id": "c1"}).status_code == 401
        assert env.client.delete("/knowledge-graph", params={"chat_id": "c1"}).status_code == 401

    def test_rag_still_answers_alongside_the_graph(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        GEMINI.responder = faithful_model("mitochondria")
        answer = env.ask("What do mitochondria do?", "c1")
        assert answer["answer"] == "A generated answer."
        assert answer["citations"] and answer["sources"] == ["Cells.pdf"]


class TestIsolation:

    def test_other_user_cannot_see_or_touch_a_graph(self, env):
        env.kg_upload("c1", "Secret.pdf", SECRET)
        assert env.get("", "c1").json()["nodes"][0]["label"] == "Supplier Contract"

        for path in ("", "/status", "/documents/Secret.pdf"):
            assert env.get(path, "c1", user_id=2).status_code == 404
        env.login(2)
        assert env.client.delete("/knowledge-graph", params={"chat_id": "c1"}).status_code == 404
        assert env.client.delete("/knowledge-graph/documents/Secret.pdf",
                                 params={"chat_id": "c1"}).status_code == 404
        assert env.client.post("/knowledge-graph/documents/Secret.pdf/regenerate",
                               params={"chat_id": "c1"}).status_code == 404

        assert env.get("", "c1").json()["nodes"]          # still there for the owner

    def test_same_chat_id_for_two_users_gives_two_graphs(self, env):
        env.kg_upload("c1", "Secret.pdf", SECRET, user_id=1)
        env.kg_upload("c1", "Cells.pdf", CELLS, user_id=2)
        one = {n["label"] for n in env.get("", "c1", user_id=1).json()["nodes"]}
        two = {n["label"] for n in env.get("", "c1", user_id=2).json()["nodes"]}
        assert one == {"Supplier Contract"} and two == {"Cell", "Mitochondria"}

    def test_user_cannot_use_another_users_pdf_name(self, env):
        env.kg_upload("c1", "Secret.pdf", SECRET, user_id=1)
        env.kg_upload("c1", "Cells.pdf", CELLS, user_id=2)
        assert env.get("/documents/Secret.pdf", "c1", user_id=2).status_code == 404

    def test_different_chats_are_separate(self, env):
        env.kg_upload("c1", "Secret.pdf", SECRET)
        env.kg_upload("c2", "Cells.pdf", CELLS)
        assert {n["label"] for n in env.get("", "c1").json()["nodes"]} == {"Supplier Contract"}
        assert {n["label"] for n in env.get("", "c2").json()["nodes"]} == {"Cell", "Mitochondria"}


# ======================================================================
# 7. Failures never break upload / indexing / RAG
# ======================================================================

class TestFailures:

    def assert_rag_unaffected(self, env, r):
        assert all(j["status"] == "COMPLETED" for j in r.json()["jobs"])
        assert env.rp.has_vector_store(1, "c1")
        GEMINI.responder = faithful_model("mitochondria")
        assert env.ask("What do mitochondria do?", "c1")["citations"]

    def test_gemini_error_marks_failed(self, env):
        def down(prompt):
            raise RuntimeError("quota exceeded: internal-detail")

        env.set_gemini(down)
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "FAILED" and "internal-detail" not in doc["error"]
        assert env.get("", "c1").json()["nodes"] == []
        self.assert_rag_unaffected(env, r)

    def test_malformed_json_marks_failed(self, env):
        env.set_gemini(lambda p: "I could not do that.")
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        body = env.get("/status", "c1").json()
        assert body["status"] == "FAILED" and "valid JSON" in body["documents"][0]["error"]
        self.assert_rag_unaffected(env, r)

    def test_missing_api_key_fails_gracefully_without_calling_gemini(self, env, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "FAILED" and "GEMINI_API_KEY" in doc["error"]
        assert env.calls == []
        self.assert_rag_unaffected(env, r)

    def test_regenerate_without_api_key_is_503(self, env, monkeypatch):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        env.login(1)
        r = env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate", params={"chat_id": "c1"})
        assert r.status_code == 503

    def test_unexpected_crash_in_extraction_marks_failed(self, env, monkeypatch):
        def boom(*a, **k):
            raise ZeroDivisionError("bug")

        monkeypatch.setattr(env.kg, "extract_document_graph", boom)
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "FAILED" and "bug" not in doc["error"]
        self.assert_rag_unaffected(env, r)

    def test_an_error_while_starting_graph_generation_does_not_fail_the_upload(self, env, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("worker exploded")

        monkeypatch.setattr(env.worker, "submit", boom)
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        self.assert_rag_unaffected(env, r)

    def test_even_a_broken_hook_cannot_fail_the_document_job(self, env, monkeypatch):
        def boom(*a, **k):
            raise RuntimeError("hook exploded")

        monkeypatch.setattr(env.wm, "trigger_for_completed_job", boom)
        r = env.kg_upload("c1", "Cells.pdf", CELLS)
        self.assert_rag_unaffected(env, r)

    def test_failed_regeneration_keeps_the_last_good_graph(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.set_gemini(lambda p: "garbage")
        env.login(1)
        r = env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate", params={"chat_id": "c1"})
        assert r.status_code == 202
        assert env.worker.wait_idle(10)
        body = env.get("", "c1").json()
        assert body["documents"][0]["status"] == "FAILED"
        assert {n["label"] for n in body["nodes"]} == {"Cell", "Mitochondria"}


# ======================================================================
# 8. Duplicate generation and regeneration
# ======================================================================

class Gate:
    def __init__(self, reply):
        self.reply = reply
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = 0

    def __call__(self, prompt):
        self.calls += 1
        self.started.set()
        assert self.release.wait(10)
        return json.dumps(self.reply)


class TestDuplicatesAndRegeneration:

    def test_unchanged_completed_pdf_is_not_sent_to_gemini_again(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        path = "uploads/user_1/chat_c1/Cells.pdf"
        outcome = env.worker.submit(1, "c1", "Cells.pdf", path)
        assert outcome == {"accepted": False, "reason": "up_to_date", "status": "COMPLETED"}
        assert len(env.calls) == 1

    def test_regenerate_forces_a_new_run(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.login(1)
        r = env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate", params={"chat_id": "c1"})
        assert r.status_code == 202 and r.json()["status"] == "PENDING"
        assert env.worker.wait_idle(10)
        assert len(env.calls) == 2

    def test_regenerate_unknown_pdf_is_404(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.login(1)
        assert env.client.post("/knowledge-graph/documents/Nope.pdf/regenerate",
                               params={"chat_id": "c1"}).status_code == 404

    def test_second_request_while_running_is_rejected_and_costs_nothing(self, env):
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.kg_upload("c1", "Cells.pdf", CELLS, wait=False)
        assert gate.started.wait(10)

        assert env.get("/status", "c1").json()["documents"][0]["status"] == "PROCESSING"
        env.login(1)
        r = env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate", params={"chat_id": "c1"})
        assert r.status_code == 409
        assert env.worker.submit(1, "c1", "Cells.pdf", "uploads/user_1/chat_c1/Cells.pdf")["reason"] \
            == "already_running"

        gate.release.set()
        assert env.worker.wait_idle(10)
        assert gate.calls == 1
        assert env.get("/status", "c1").json()["status"] == "COMPLETED"

    def test_old_graph_stays_visible_while_regenerating(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.login(1)
        env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate", params={"chat_id": "c1"})
        assert gate.started.wait(10)
        body = env.get("", "c1").json()
        assert body["status"] == "PROCESSING"
        assert len(body["nodes"]) == 2
        gate.release.set()
        assert env.worker.wait_idle(10)

    def test_reuploading_a_changed_pdf_replaces_the_graph(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        REPLIES["Cells.pdf"] = {"nodes": [node("n", "Nucleus")], "edges": []}
        try:
            env.kg_upload("c1", "Cells.pdf", CELLS_V2)
        finally:
            REPLIES["Cells.pdf"] = CELL_REPLY
        assert {n["label"] for n in env.get("", "c1").json()["nodes"]} == {"Nucleus"}
        assert len(env.calls) == 2

    def test_reuploading_identical_pdf_costs_nothing(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Cells.pdf", CELLS)
        assert len(env.calls) == 1

    def test_auto_generation_can_be_switched_off(self, env, monkeypatch):
        monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "off")
        env.kg_upload("c1", "Cells.pdf", CELLS)
        assert env.calls == [] and not os.path.exists("knowledge_graphs")


# ======================================================================
# 9. Deletion cleanup and races
# ======================================================================

class TestDeletion:

    def test_deleting_a_pdf_deletes_its_graph_only(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Bio.pdf", BIOLOGY)
        env.login(1)
        r = env.client.delete("/files/Cells.pdf", params={"chat_id": "c1"})
        assert r.status_code == 200
        assert env.worker.wait_idle(10)

        assert env.store.read_doc(1, "c1", "Cells.pdf") is None
        body = env.get("", "c1").json()
        assert {d["filename"] for d in body["documents"]} == {"Bio.pdf"}
        assert "Mitochondria" not in {n["label"] for n in body["nodes"]}
        # Deleting a PDF must not re-run graph generation for the others
        # (delete_pdf_and_rebuild re-indexes them directly, not via the queue).
        assert len(env.calls) == 2

    def test_deleting_a_pdf_while_its_graph_is_generating_cannot_bring_it_back(self, env):
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.kg_upload("c1", "Cells.pdf", CELLS, wait=False)
        assert gate.started.wait(10)

        env.login(1)
        assert env.client.delete("/files/Cells.pdf", params={"chat_id": "c1"}).status_code == 200
        gate.release.set()
        assert env.worker.wait_idle(10)

        assert env.store.list_docs(1, "c1") == []
        assert env.get("", "c1").json()["documents"] == []

    def test_delete_then_reupload_while_old_job_runs(self, env):
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.kg_upload("c1", "Cells.pdf", CELLS, wait=False)
        assert gate.started.wait(10)
        env.login(1)
        env.client.delete("/files/Cells.pdf", params={"chat_id": "c1"})

        # A new upload under the same name gets its own job; the old job's
        # result must be thrown away.
        env.set_gemini(lambda p: json.dumps({"nodes": [node("n", "Nucleus")], "edges": []}))
        env.kg_upload("c1", "Cells.pdf", CELLS_V2, wait=False)
        gate.release.set()
        assert env.worker.wait_idle(10)

        assert {n["label"] for n in env.get("", "c1").json()["nodes"]} == {"Nucleus"}

    def test_deleting_a_chat_removes_all_graph_data(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Bio.pdf", BIOLOGY)
        env.kg_upload("c2", "Secret.pdf", SECRET)
        env.login(1)
        assert env.client.delete("/chats/c1").status_code == 200

        assert not os.path.exists("knowledge_graphs/user_1/chat_c1")
        assert os.path.exists("knowledge_graphs/user_1/chat_c2")
        assert env.get("", "c1").status_code == 410
        assert env.get("", "c2").json()["nodes"]

    def test_deleting_a_chat_while_generating_cannot_recreate_anything(self, env):
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.kg_upload("c1", "Cells.pdf", CELLS, wait=False)
        assert gate.started.wait(10)

        env.login(1)
        assert env.client.delete("/chats/c1").status_code == 200
        gate.release.set()
        assert env.worker.wait_idle(10)

        assert not os.path.exists("knowledge_graphs/user_1")
        assert not os.path.exists("uploads/user_1")
        assert not os.path.exists("vectorstores/user_1")

    def test_delete_graph_endpoints(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        env.kg_upload("c1", "Bio.pdf", BIOLOGY)
        env.login(1)

        r = env.client.delete("/knowledge-graph/documents/Cells.pdf", params={"chat_id": "c1"})
        assert r.status_code == 200 and r.json()["deleted"] is True
        r = env.client.delete("/knowledge-graph/documents/Cells.pdf", params={"chat_id": "c1"})
        assert r.json()["deleted"] is False                      # idempotent
        docs = {d["filename"]: d["status"] for d in env.get("/status", "c1").json()["documents"]}
        assert docs == {"Cells.pdf": "NOT_STARTED", "Bio.pdf": "COMPLETED"}

        r = env.client.delete("/knowledge-graph", params={"chat_id": "c1"})
        assert r.status_code == 200 and r.json()["deleted"] is True
        assert env.get("", "c1").json()["nodes"] == []
        assert env.get("/status", "c1").json()["status"] == "NOT_STARTED"
        # The chat itself (PDFs, RAG) is untouched, and graphs can be rebuilt.
        assert env.rp.has_vector_store(1, "c1")
        env.login(1)
        assert env.client.post("/knowledge-graph/documents/Bio.pdf/regenerate",
                               params={"chat_id": "c1"}).status_code == 202
        assert env.worker.wait_idle(10)
        assert env.get("", "c1").json()["nodes"]

    def test_clearing_graphs_while_generating_cannot_bring_them_back(self, env):
        gate = Gate(CELL_REPLY)
        env.set_gemini(gate)
        env.kg_upload("c1", "Cells.pdf", CELLS, wait=False)
        assert gate.started.wait(10)
        env.login(1)
        env.client.delete("/knowledge-graph", params={"chat_id": "c1"})
        gate.release.set()
        assert env.worker.wait_idle(10)
        assert env.store.list_docs(1, "c1") == []


# ======================================================================
# 10. Persistence and crash recovery
# ======================================================================

class TestRecovery:

    def prepare(self, env, monkeypatch):
        """A PDF is uploaded with auto-generation off, so nothing exists yet."""
        monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "0")
        env.kg_upload("c1", "Cells.pdf", CELLS)
        monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "1")
        return os.path.join("uploads", "user_1", "chat_c1", "Cells.pdf")

    def leave_behind(self, env, path, status, attempts=1):
        env.store.save_doc(1, "c1", "Cells.pdf", {
            "filename": "Cells.pdf", "user_id": "1", "chat_id": "c1", "file_path": path,
            "status": status, "attempts": attempts, "nodes": [], "edges": [], "error": None,
        }, env.store.current_token(1, "c1", "Cells.pdf"))

    def test_status_survives_restart(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        # "Restart": brand-new worker and store state, same files on disk.
        for name in KG_MODULES:
            sys.modules.pop(name, None)
        import importlib
        store = importlib.import_module("services.knowledge_graph_store")
        assert store.read_doc(1, "c1", "Cells.pdf")["status"] == "COMPLETED"
        assert len(store.read_doc(1, "c1", "Cells.pdf")["nodes"]) == 2

    def test_interrupted_record_is_reported_failed_not_stuck(self, env, monkeypatch):
        path = self.prepare(env, monkeypatch)
        self.leave_behind(env, path, "PROCESSING")
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "FAILED" and "interrupted" in doc["error"]

    def test_recovery_requeues_and_completes(self, env, monkeypatch):
        path = self.prepare(env, monkeypatch)
        self.leave_behind(env, path, "PROCESSING", attempts=1)
        summary = env.wm.recover_interrupted_jobs()
        assert summary["requeued"] == 1
        assert env.worker.wait_idle(10)
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "COMPLETED" and doc["node_count"] == 2
        assert env.store.read_doc(1, "c1", "Cells.pdf")["attempts"] == 2

    def test_recovery_gives_up_after_too_many_attempts(self, env, monkeypatch):
        path = self.prepare(env, monkeypatch)
        self.leave_behind(env, path, "PROCESSING", attempts=env.wm.MAX_ATTEMPTS)
        summary = env.wm.recover_interrupted_jobs()
        assert summary["failed"] == 1 and env.calls == []
        doc = env.get("/status", "c1").json()["documents"][0]
        assert doc["status"] == "FAILED"
        # ...and the user can still regenerate.
        env.login(1)
        assert env.client.post("/knowledge-graph/documents/Cells.pdf/regenerate",
                               params={"chat_id": "c1"}).status_code == 202
        assert env.worker.wait_idle(10)
        assert env.get("/status", "c1").json()["status"] == "COMPLETED"

    def test_recovery_drops_records_whose_pdf_is_gone(self, env, monkeypatch):
        path = self.prepare(env, monkeypatch)
        self.leave_behind(env, path, "PENDING")
        os.remove(path)
        assert env.wm.recover_interrupted_jobs()["dropped"] == 1
        assert env.store.list_docs(1, "c1") == []
        assert env.calls == []

    def test_recovery_ignores_a_record_pointing_at_someone_elses_file(self, env, monkeypatch):
        self.prepare(env, monkeypatch)
        env.kg_upload("c9", "Secret.pdf", SECRET, user_id=2, wait=False)
        env.worker.wait_idle(10)
        env.calls.clear()
        evil = os.path.join("uploads", "user_2", "chat_c9", "Secret.pdf")
        self.leave_behind(env, evil, "PENDING")
        summary = env.wm.recover_interrupted_jobs()
        assert summary["dropped"] >= 1 and summary["requeued"] == 0
        assert env.calls == []

    def test_recovery_leaves_finished_records_alone(self, env):
        env.kg_upload("c1", "Cells.pdf", CELLS)
        before = env.store.read_doc(1, "c1", "Cells.pdf")
        assert env.wm.recover_interrupted_jobs() == {"requeued": 0, "failed": 0, "dropped": 0}
        assert env.store.read_doc(1, "c1", "Cells.pdf") == before
        assert len(env.calls) == 1

    def test_recovery_never_raises(self, env, monkeypatch):
        def boom():
            raise OSError("disk gone")

        monkeypatch.setattr(env.store, "iter_all_docs", boom)
        assert env.wm.recover_interrupted_jobs() == {"requeued": 0, "failed": 0, "dropped": 0}
