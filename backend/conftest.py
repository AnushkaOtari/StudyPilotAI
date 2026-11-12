"""Shared pytest settings.

Knowledge Graph generation starts automatically after a PDF is indexed. The
older RAG/citation tests upload PDFs but are not about graphs, so keep the
background graph worker out of them (no extra Gemini calls, no files written
by a background thread). Graph tests turn it back on explicitly.
"""

import pytest


@pytest.fixture(autouse=True)
def _knowledge_graph_auto_generate_off(monkeypatch):
    monkeypatch.setenv("KNOWLEDGE_GRAPH_AUTO_GENERATE", "0")
