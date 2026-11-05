import { FileText } from "lucide-react";
import { getCitationChips } from "../utils/citations";

import "./ChatBox.css";

// Read-only citation labels. They are not clickable yet: the app has no PDF
// viewer and no endpoint that serves the uploaded PDFs.
function CitationChips({ citations }) {
  const chips = getCitationChips(citations);

  if (chips.length === 0) return null;

  return (
    <div className="citation-section">
      <div className="citation-heading">Sources</div>
      <ul className="citation-list">
        {chips.map((chip) => (
          <li key={chip.key} className="citation-chip">
            <FileText className="citation-chip-icon" aria-hidden="true" />
            <span>{chip.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default CitationChips;
