"""Source references and validated citations.

Flow for one /ask request:

1. Every retrieved chunk gets a short reference label for THIS request
   (``S1``, ``S2`` ...). The labels are written into the context sent to
   Gemini (``[S1] Source: file.pdf (Page 3)``).
2. Gemini is asked to name the labels it actually used. Its reply ends with a
   ``SOURCE_REFS: S1, S3`` line (see ``parse_source_refs``).
3. Every returned label is validated against the chunks that were really
   retrieved. Unknown labels are dropped.
4. Validated labels are mapped back to the real filename, page and text of the
   retrieved chunk. Nothing in a citation comes from Gemini's text.

If Gemini names no valid label, there are no citations: retrieval alone is not
evidence that a page supports the answer.
"""

import os
import re

# Optional chunk keys that may carry a document identifier. They are only
# passed through if a retrieved chunk already contains one; no ID is created.
_DOCUMENT_ID_KEYS = ("document_id", "doc_id", "resource_id")

SOURCE_REFS_MARKER = "SOURCE_REFS"

_REF_RE = re.compile(r"\bS(\d+)\b", re.IGNORECASE)
_MARKER_LINE_RE = re.compile(
    r"^[ \t>*_`#-]*" + SOURCE_REFS_MARKER + r"[ \t*_`]*:[ \t*_`]*(.*?)[ \t*_`]*$",
    re.IGNORECASE | re.MULTILINE,
)
_INLINE_REFS_RE = re.compile(
    r"[ \t]*\[\s*(S\d+(?:\s*[,;]\s*S\d+)*)\s*\]", re.IGNORECASE
)


# ---------------------------------------------------------------- helpers

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


def _usable_text(chunk):
    if not isinstance(chunk, dict):
        return None
    text = chunk.get("text")
    if not isinstance(text, str) or not text.strip():
        return None
    return text


def _dedupe_key(chunk, text):
    raw_source = chunk.get("source")
    identity = _document_id(chunk) or (raw_source if isinstance(raw_source, str) else None)
    return (identity, chunk.get("page"), _normalise_text(text))


def _make_citation(chunk, text, number):
    citation = {
        "id": f"source_{number}",
        "filename": _clean_filename(chunk.get("source")),
        # `page` is passed through exactly as stored (the backend is 1-based).
        "page": chunk.get("page"),
        "text": text,
    }
    document_id = _document_id(chunk)
    if document_id is not None:
        citation["document_id"] = document_id
    return citation


# ------------------------------------------------------- source references

def assign_source_refs(results):
    """Return one reference label per retrieved chunk, in retrieval order.

    The result is a list parallel to ``results``. Chunks without usable text
    get ``None``. Exact duplicates (same document, same page, same text
    ignoring whitespace) share the label of their first occurrence, so the
    same evidence is never listed under two labels. Labels are only
    meaningful for the current request.
    """
    refs = []
    by_key = {}
    for chunk in results or []:
        text = _usable_text(chunk)
        if text is None:
            refs.append(None)
            continue
        key = _dedupe_key(chunk, text)
        if key not in by_key:
            by_key[key] = f"S{len(by_key) + 1}"
        refs.append(by_key[key])
    return refs


def format_context(results):
    """Build the PDF context for Gemini, one labelled block per chunk."""
    refs = assign_source_refs(results)
    blocks = []
    for chunk, ref in zip(results or [], refs):
        # Identical to the original header when metadata is present; a chunk
        # with missing metadata is still shown instead of raising KeyError.
        header = f"Source: {chunk.get('source') or 'Unknown'}"
        if chunk.get("page") is not None:
            header += f" (Page {chunk['page']})"
        if ref:
            header = f"[{ref}] {header}"
        blocks.append(f"{header}\n{chunk.get('text', '')}")
    return "\n\n".join(blocks)


def parse_source_refs(raw_answer):
    """Split Gemini's raw reply into (clean_answer, claimed_refs).

    * The ``SOURCE_REFS: ...`` line is removed from the answer.
    * If the model also wrote inline labels such as ``[S2]``, they are removed
      from the answer text; they are only used as claimed references when no
      ``SOURCE_REFS`` line is present.
    * Claimed references are unvalidated; ``resolve_citations`` checks them.
    * ``None`` in, ``None`` answer out (the previous contract for empty replies).
    """
    if raw_answer is None:
        return None, []

    text = raw_answer
    claimed = []
    marker_found = False

    matches = list(_MARKER_LINE_RE.finditer(text))
    if matches:
        marker_found = True
        for match in matches:
            claimed.extend(f"S{n}" for n in _REF_RE.findall(match.group(1)))
        text = _MARKER_LINE_RE.sub("", text)

    if not marker_found:
        for group in _INLINE_REFS_RE.findall(text):
            claimed.extend(f"S{n}" for n in _REF_RE.findall(group))
    text = _INLINE_REFS_RE.sub("", text)

    clean = text.rstrip()
    if matches:
        clean = clean.strip()

    unique = []
    for ref in claimed:
        if ref not in unique:
            unique.append(ref)
    return clean, unique


def resolve_citations(results, claimed_refs):
    """Map claimed references to real retrieved chunks.

    Returns ``{"citations": [...], "invalid_refs": [...]}``.

    * A reference counts only if it labels a chunk in ``results``.
    * Citations follow retrieval order, not the order Gemini listed them.
    * Several chunks from the same page stay separate citations; only exact
      duplicates were merged (they share one label).
    * IDs are ``source_1``, ``source_2`` ... within this answer.
    """
    claimed = {str(r).strip().upper() for r in (claimed_refs or []) if r is not None}
    refs = assign_source_refs(results)
    known = {ref for ref in refs if ref}

    invalid = sorted((r for r in claimed if r not in known),
                     key=lambda r: (len(r), r))

    citations = []
    emitted = set()
    for chunk, ref in zip(results or [], refs):
        if not ref or ref not in claimed or ref in emitted:
            continue
        emitted.add(ref)
        citations.append(_make_citation(chunk, chunk["text"], len(citations) + 1))

    return {"citations": citations, "invalid_refs": invalid}


# ------------------------------------------------- unvalidated (kept as-is)

def build_citations(results):
    """Cite EVERY usable retrieved chunk (deduplicated, retrieval order).

    Kept for backward compatibility. `ask_rag` no longer uses it: retrieved
    context is not evidence of support, so it uses ``resolve_citations``.
    """
    citations = []
    seen = set()
    for chunk in results or []:
        text = _usable_text(chunk)
        if text is None:
            continue
        key = _dedupe_key(chunk, text)
        if key in seen:
            continue
        seen.add(key)
        citations.append(_make_citation(chunk, text, len(citations) + 1))
    return citations
