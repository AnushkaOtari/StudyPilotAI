// Pure helpers for the Flashcards feature (no React, no network).
//
// Backend contract (POST /flashcards/generate):
//   request : { chat_id: string, pdf_name: string | null, num_flashcards: 1..30 }
//   response: { flashcards: [{ question: string, answer: string }] }
//   errors  : { detail: "<readable message>" }  (400, 404, 422, 500, 502, 503)
//             { detail: [{ loc, msg, type }] }  (FastAPI request validation, 422)

export const MIN_FLASHCARDS = 1;
export const MAX_FLASHCARDS = 30;

/**
 * Pull the card list out of the backend response and keep only well-formed
 * cards ({question, answer} non-empty strings). Nothing is invented.
 */
export function extractFlashcards(data) {
  const raw = data && Array.isArray(data.flashcards) ? data.flashcards : [];
  return raw
    .filter(
      (card) =>
        card &&
        typeof card.question === "string" &&
        typeof card.answer === "string" &&
        card.question.trim() !== "" &&
        card.answer.trim() !== ""
    )
    .map((card) => ({ question: card.question, answer: card.answer }));
}

/** Keep a card index inside [0, total - 1]. Returns 0 for an empty deck. */
export function clampIndex(index, total) {
  if (!Number.isInteger(total) || total <= 0) return 0;
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, total - 1);
}

/** Percentage of the deck reached, e.g. card 3 of 10 -> 30. */
export function progressPercent(index, total) {
  if (!Number.isInteger(total) || total <= 0) return 0;
  const position = clampIndex(index, total) + 1;
  return Math.round((position / total) * 100);
}

function describeValidationItem(item) {
  if (!item || typeof item !== "object") return null;
  const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
  if (field === "num_flashcards") {
    return `Please choose between ${MIN_FLASHCARDS} and ${MAX_FLASHCARDS} flashcards.`;
  }
  if (field === "chat_id") return "No active chat was found. Please open a chat first.";
  if (typeof item.msg === "string" && item.msg) {
    return field ? `${field}: ${item.msg}` : item.msg;
  }
  return null;
}

/**
 * Turn an axios error into a short message that is safe to show a student.
 * Never includes tokens, stack traces or raw response bodies.
 */
export function getFlashcardErrorMessage(error) {
  if (error && (error.code === "ERR_CANCELED" || error.name === "CanceledError")) return "";

  const response = error && error.response;

  // No response at all: backend down / offline / blocked.
  if (!response) {
    return "We couldn't reach the StudyPilot server. Check your connection and that the backend is running, then try again.";
  }

  if (response.status === 401) {
    return "Your session has expired. Please log in again.";
  }

  const detail = response.data && response.data.detail;

  if (typeof detail === "string" && detail.trim()) return detail.trim();

  if (Array.isArray(detail)) {
    const messages = detail.map(describeValidationItem).filter(Boolean);
    if (messages.length > 0) return [...new Set(messages)].join(" ");
  }

  if (response.status === 422) return "The request wasn't valid. Please check your choices and try again.";
  if (response.status >= 500) return "Something went wrong on our side while generating your flashcards. Please try again.";
  return "We couldn't generate flashcards right now. Please try again.";
}

/**
 * The chat to use when the page is opened without router state (typing the
 * URL, bookmark). Reads the same localStorage keys StudyPilot writes; returns
 * null when nothing usable is stored.
 */
export function findStoredActiveChatId(userId) {
  if (!userId) return null;
  try {
    const active = localStorage.getItem(`studypilot_${userId}_active_chat`);
    const saved = JSON.parse(localStorage.getItem(`studypilot_${userId}_conversations`) || "[]");
    if (!active || !Array.isArray(saved)) return null;
    const match = saved.find((c) => c && String(c.id) === String(active));
    return match && typeof match.chat_id === "string" && match.chat_id ? match.chat_id : null;
  } catch {
    return null;
  }
}
