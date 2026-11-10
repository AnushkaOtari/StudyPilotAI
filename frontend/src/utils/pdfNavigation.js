// Helpers for opening a cited PDF page. Page numbers are the backend's
// 1-based numbers and are passed to the viewer unchanged.

const isPositiveInteger = (n) => Number.isInteger(n) && n >= 1;

/** True when a citation names a document that can be requested. */
export function canOpenCitation(citation) {
  return (
    !!citation &&
    typeof citation.filename === "string" &&
    citation.filename.trim() !== ""
  );
}

/** Convert a citation page ("9", 9, null ...) to an integer, or null. */
export function parseCitationPage(page) {
  if (page === null || page === undefined || String(page).trim() === "") return null;
  const n = Number(page);
  return isPositiveInteger(n) ? n : null;
}

/**
 * Decide which page to show for a citation once the PDF's page count is known.
 * Returns { page, notice }: `notice` explains any fallback, or is null.
 */
export function resolveTargetPage(requestedPage, numPages) {
  const total = Number.isInteger(numPages) && numPages >= 1 ? numPages : 1;
  const page = parseCitationPage(requestedPage);

  if (page === null) {
    return {
      page: 1,
      notice:
        requestedPage === null || requestedPage === undefined || String(requestedPage).trim() === ""
          ? "No page number was recorded for this citation. Showing page 1."
          : `"${requestedPage}" is not a valid page number. Showing page 1.`,
    };
  }
  if (page > total) {
    return {
      page: total,
      notice: `Page ${page} is not in this document (${total} ${total === 1 ? "page" : "pages"}). Showing page ${total}.`,
    };
  }
  return { page, notice: null };
}
