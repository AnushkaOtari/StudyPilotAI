"""Structured citation metadata built from retrieved chunks.

Citations are derived ONLY from the chunks that retrieval actually returned
(the `results` list in `ask_rag`). Nothing here reads or trusts the text that
Gemini generated, and nothing is invented: a missing field stays None.
"""

import os

# Optional chunk keys that may carry a document identifier. They are only
# passed through if a retrieved chunk already contains one; no ID is created.
_DOCUMENT_ID_KEYS = ("document_id", "doc_id", "resource_id")


def _normalise_text(text):
    return " ".join(text.split())


def _clean_filename(source):
    if not isinstance(source, str) or not source.strip():
        return None
    return os.path.basename(source.replace("\\", "/")) or None


def _document_id(chunk):
    for key in _DOCUMENT_ID_KEYS:
        value = chunk.get(key)
        if value is not None and value != "":
            return str(value)
    return None


def build_citations(results):
    """Build the citation list for one answer from retrieved chunks.

    - Order follows retrieval order.
    - Chunks without usable evidence text are skipped (nothing to cite).
    - Exact duplicates (same document, same page, same text ignoring
      whitespace) are collapsed. Different chunks on the same page are
      distinct evidence and are all kept.
    - IDs are `source_1`, `source_2`, ... by position in this list, so they
      are deterministic and only meaningful within the current answer.
    - `page` is passed through exactly as stored (no 0/1-based conversion).
    """
    citations = []
    seen = set()

    for chunk in results or []:
        if not isinstance(chunk, dict):
            continue

        text = chunk.get("text")
        if not isinstance(text, str) or not text.strip():
            continue

        raw_source = chunk.get("source")
        filename = _clean_filename(raw_source)
        document_id = _document_id(chunk)
        page = chunk.get("page")

        identity = document_id or (raw_source if isinstance(raw_source, str) else None)
        dedupe_key = (identity, page, _normalise_text(text))
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        citation = {
            "id": f"source_{len(citations) + 1}",
            "filename": filename,
            "page": page,
            "text": text,
        }
        if document_id is not None:
            citation["document_id"] = document_id
        citations.append(citation)

    return citations
