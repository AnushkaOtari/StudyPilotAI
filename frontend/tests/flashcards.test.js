import { describe, it, expect, beforeEach } from "vitest";
import {
  extractFlashcards,
  clampIndex,
  progressPercent,
  getFlashcardErrorMessage,
  findStoredActiveChatId,
} from "../src/utils/flashcards";

describe("extractFlashcards", () => {
  it("reads cards from the nested { flashcards: [...] } response", () => {
    expect(extractFlashcards({ flashcards: [{ question: "Q1?", answer: "A1" }] }))
      .toEqual([{ question: "Q1?", answer: "A1" }]);
  });
  it("does not treat a bare array as the response", () => {
    expect(extractFlashcards([{ question: "Q", answer: "A" }])).toEqual([]);
  });
  it("returns [] for missing / malformed responses", () => {
    for (const v of [undefined, null, {}, { flashcards: null }, { flashcards: "x" }, "oops", 5]) {
      expect(extractFlashcards(v)).toEqual([]);
    }
  });
  it("drops malformed cards and keeps only question and answer", () => {
    const out = extractFlashcards({ flashcards: [
      { question: "Keep?", answer: "Yes", extra: "ignored", id: 4 },
      { question: "No answer" },
      { answer: "No question" },
      { question: "  ", answer: "blank question" },
      { question: "Empty answer", answer: "" },
      { question: 5, answer: "number question" },
      null, "text",
    ] });
    expect(out).toEqual([{ question: "Keep?", answer: "Yes" }]);
  });
});

describe("clampIndex / progressPercent", () => {
  it("never produces an invalid index", () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(99, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(1.5, 5)).toBe(0);
    expect(clampIndex(0, 0)).toBe(0);
    expect(clampIndex(3, undefined)).toBe(0);
  });
  it("card 3 of 10 is 30%", () => {
    expect(progressPercent(2, 10)).toBe(30);
  });
  it("first and last card", () => {
    expect(progressPercent(0, 10)).toBe(10);
    expect(progressPercent(9, 10)).toBe(100);
    expect(progressPercent(0, 1)).toBe(100);
  });
  it("empty deck is 0%, out-of-range index is clamped", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(50, 4)).toBe(100);
  });
});

describe("getFlashcardErrorMessage", () => {
  const http = (status, data) => ({ response: { status, data } });

  it("shows the backend's readable detail string (404 / 400 / 502 / 503 / 500)", () => {
    for (const [status, detail] of [
      [404, "No study documents found for this chat yet. Please upload at least one PDF before generating flashcards."],
      [400, "Invalid chat id."],
      [502, "The study assistant returned an unexpected response format. Please try again."],
      [503, "We couldn't read your study materials right now. Please try again in a moment."],
      [500, "Something went wrong while generating your flashcards. Please try again."],
    ]) {
      expect(getFlashcardErrorMessage(http(status, { detail }))).toBe(detail);
    }
  });
  it("shows the service's own 422 string (not enough material)", () => {
    expect(getFlashcardErrorMessage(http(422, { detail: "Not enough information in the uploaded documents to generate flashcards." })))
      .toBe("Not enough information in the uploaded documents to generate flashcards.");
  });
  it("turns FastAPI's 422 validation array into a readable message", () => {
    const msg = getFlashcardErrorMessage(http(422, { detail: [
      { loc: ["body", "num_flashcards"], msg: "Input should be less than or equal to 30", type: "less_than_equal" },
    ] }));
    expect(msg).toBe("Please choose between 1 and 30 flashcards.");
  });
  it("handles other validation fields without leaking structure", () => {
    expect(getFlashcardErrorMessage(http(422, { detail: [{ loc: ["body", "chat_id"], msg: "Field required", type: "missing" }] })))
      .toBe("No active chat was found. Please open a chat first.");
    expect(getFlashcardErrorMessage(http(422, { detail: [{ loc: ["body", "pdf_name"], msg: "Input should be a valid string", type: "x" }] })))
      .toBe("pdf_name: Input should be a valid string");
    expect(getFlashcardErrorMessage(http(422, { detail: [] }))).toMatch(/wasn't valid/);
  });
  it("401 gives a session message with no token details", () => {
    const msg = getFlashcardErrorMessage(http(401, { detail: "Could not validate credentials: Bearer abc.def.ghi" }));
    expect(msg).toBe("Your session has expired. Please log in again.");
    expect(msg).not.toMatch(/Bearer|abc/);
  });
  it("network error (no response) gives a connection message", () => {
    expect(getFlashcardErrorMessage({ message: "Network Error", code: "ERR_NETWORK" })).toMatch(/couldn't reach the StudyPilot server/);
  });
  it("falls back safely for unexpected shapes", () => {
    expect(getFlashcardErrorMessage(http(500, "<html>boom</html>"))).toMatch(/Something went wrong/);
    expect(getFlashcardErrorMessage(http(418, null))).toMatch(/couldn't generate flashcards/);
    expect(getFlashcardErrorMessage(undefined)).toMatch(/couldn't reach/);
  });
  it("cancelled requests produce no message", () => {
    expect(getFlashcardErrorMessage({ code: "ERR_CANCELED" })).toBe("");
    expect(getFlashcardErrorMessage({ name: "CanceledError" })).toBe("");
  });
});

describe("findStoredActiveChatId", () => {
  beforeEach(() => localStorage.clear());
  const save = (convs, active) => {
    localStorage.setItem("studypilot_7_conversations", JSON.stringify(convs));
    if (active !== undefined) localStorage.setItem("studypilot_7_active_chat", String(active));
  };
  it("returns the chat_id of the active conversation", () => {
    save([{ id: 1, chat_id: "chat-a" }, { id: 2, chat_id: "chat-b" }], 2);
    expect(findStoredActiveChatId(7)).toBe("chat-b");
  });
  it("is null when nothing is stored, no user, or data is broken", () => {
    expect(findStoredActiveChatId(7)).toBeNull();
    expect(findStoredActiveChatId(undefined)).toBeNull();
    save([{ id: 1, chat_id: "chat-a" }], 99);
    expect(findStoredActiveChatId(7)).toBeNull();
    localStorage.setItem("studypilot_7_conversations", "{not json");
    expect(findStoredActiveChatId(7)).toBeNull();
    save([{ id: 1 }], 1);
    expect(findStoredActiveChatId(7)).toBeNull();
  });
});
