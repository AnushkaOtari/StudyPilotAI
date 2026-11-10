import { FileText } from "lucide-react";
import { getCitationChips } from "../utils/citations";
import { canOpenCitation, parseCitationPage } from "../utils/pdfNavigation";

import "./ChatBox.css";

// Citation labels under an assistant answer. A chip opens the cited PDF page
// when it names a document and `onOpen` is provided; otherwise it is a plain
// label (for example when the backend sent no filename).
function CitationChips({ citations, onOpen }) {
  const chips = getCitationChips(citations);

  if (chips.length === 0) return null;

  return (
    <div className="citation-section">
      <div className="citation-heading">Sources</div>
      <ul className="citation-list">
        {chips.map((chip) => {
          const content = (
            <>
              <FileText className="citation-chip-icon" aria-hidden="true" />
              <span>{chip.label}</span>
            </>
          );

          if (onOpen && canOpenCitation(chip.citation)) {
            const page = parseCitationPage(chip.citation.page);
            return (
              <li key={chip.key} className="citation-item">
                <button
                  type="button"
                  className="citation-chip citation-chip-button"
                  onClick={() => onOpen(chip.citation)}
                  title={page ? `Open ${chip.citation.filename} at page ${page}` : `Open ${chip.citation.filename}`}
                >
                  {content}
                </button>
              </li>
            );
          }

          return (
            <li key={chip.key} className="citation-item">
              <span className="citation-chip">{content}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default CitationChips;
