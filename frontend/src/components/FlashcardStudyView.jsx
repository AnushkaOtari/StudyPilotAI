import { useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, Plus } from "lucide-react";
import { clampIndex, progressPercent } from "../utils/flashcards";

import "../pages/FlashcardsPage.css";

// Study interface for one generated deck. Create it with a new `key` for every
// deck so the card index and answer visibility start fresh.
function FlashcardStudyView({ cards, onNewDeck }) {
  const total = cards.length;
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const position = clampIndex(index, total);
  const card = cards[position];
  if (!card) return null;

  const isFirst = position === 0;
  const isLast = position === total - 1;
  const percent = progressPercent(position, total);

  // Every move also hides the answer again.
  const goTo = (next) => {
    setIndex(clampIndex(next, total));
    setRevealed(false);
  };

  const handleKeyDown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowRight" && !isLast) {
      event.preventDefault();
      goTo(position + 1);
    } else if (event.key === "ArrowLeft" && !isFirst) {
      event.preventDefault();
      goTo(position - 1);
    }
  };

  return (
    // Arrow keys only work while focus is inside the study area.
    <div className="fc-study" onKeyDown={handleKeyDown}>
      <div className="fc-progress">
        <div className="fc-progress-row">
          <span className="fc-progress-count">
            Card {position + 1} of {total}
          </span>
          <span className="fc-progress-percent">{percent}%</span>
        </div>
        <div
          className="fc-progress-track"
          role="progressbar"
          aria-label="Study progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`Card ${position + 1} of ${total}, ${percent}%`}
        >
          <div className="fc-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <button
        type="button"
        className={`fc-card ${revealed ? "is-answer" : "is-question"}`}
        onClick={() => setRevealed((value) => !value)}
        aria-label={revealed ? "Answer shown. Press to show the question again." : "Question shown. Press to reveal the answer."}
      >
        {/* Only one side is in the DOM at a time, so the answer stays hidden until revealed. */}
        <span className="fc-card-face" key={`${position}-${revealed ? "a" : "q"}`}>
          <span className="fc-card-label">{revealed ? "Answer" : "Question"}</span>
          <span className="fc-card-text">{revealed ? card.answer : card.question}</span>
        </span>
        <span className="fc-card-hint">{revealed ? "Tap to show question" : "Tap to reveal answer"}</span>
      </button>

      <p className="fc-sr-only" role="status" aria-live="polite">
        {revealed ? "Showing answer" : "Showing question"} for card {position + 1} of {total}.
      </p>

      {isLast && <p className="fc-last-note">You've reached the last card.</p>}

      <div className="fc-nav">
        <button type="button" className="fc-btn fc-btn-secondary" onClick={() => goTo(position - 1)} disabled={isFirst}>
          <ChevronLeft size={18} aria-hidden="true" />
          Previous
        </button>
        {isLast ? (
          <button type="button" className="fc-btn fc-btn-secondary" onClick={() => goTo(0)}>
            <RotateCcw size={16} aria-hidden="true" />
            Restart
          </button>
        ) : (
          <button type="button" className="fc-btn fc-btn-primary" onClick={() => goTo(position + 1)}>
            Next
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      <button type="button" className="fc-link-btn" onClick={onNewDeck}>
        <Plus size={15} aria-hidden="true" />
        Generate a new deck
      </button>
    </div>
  );
}

export default FlashcardStudyView;
