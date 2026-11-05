// Helpers for the `citations` array returned by the backend /ask endpoint.
// Each citation: { id, filename, page, text, document_id? }
// `page` is the backend's 1-based page number and is displayed as-is.

const hasValue = (v) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * Normalise the raw `citations` field from an /ask response so it is always
 * an array of plain objects (never throws, never invents data).
 */
export function normalizeCitations(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === "object" && !Array.isArray(c));
}

/**
 * Readable label such as "Understanding Companies.pdf — p. 9".
 * Returns null when there is neither a filename nor a page to show.
 */
export function formatCitationLabel(citation) {
  if (!citation || typeof citation !== "object") return null;

  const filename = hasValue(citation.filename) ? String(citation.filename).trim() : null;
  const page = hasValue(citation.page) ? String(citation.page).trim() : null;

  if (filename && page) return `${filename} — p. ${page}`;
  if (filename) return filename;
  if (page) return `p. ${page}`;
  return null;
}

/**
 * Chips to display for one answer: one chip per distinct label, in the
 * order the backend returned them. The backend may return several chunks
 * from the same page; they share a chip here, but the full citation
 * objects stay on the message untouched.
 */
export function getCitationChips(rawCitations) {
  const chips = [];
  const seen = new Set();

  for (const citation of normalizeCitations(rawCitations)) {
    const label = formatCitationLabel(citation);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    chips.push({ key: label, label, citation });
  }

  return chips;
}
