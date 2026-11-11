import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../src/services/api", () => ({ default: apiMock }));
vi.mock("../src/hooks/useAuth", () => ({
  default: () => ({ currentUser: { id: 7, username: "tester" } }),
}));

import FlashcardsPage from "../src/pages/FlashcardsPage";

const CARDS = [
  { question: "What is a company?", answer: "A legal entity separate from its owners." },
  { question: "What is limited liability?", answer: "Owners are not personally liable for debts." },
  { question: "Who manages a company?", answer: "The directors." },
];

function renderPage(state = { chatId: "chat-1" }) {
  return rtlRender(
    <MemoryRouter initialEntries={[{ pathname: "/flashcards", state }]}>
      <FlashcardsPage />
    </MemoryRouter>
  );
}

const generateBtn = () => screen.getByRole("button", { name: "Generate Flashcards" });
const card = () => document.querySelector(".fc-card");

async function generate(cards = CARDS) {
  apiMock.post.mockResolvedValueOnce({ data: { flashcards: cards } });
  renderPage();
  await screen.findByLabelText("Study document");
  fireEvent.click(generateBtn());
  await screen.findByText(/Card 1 of/);
}

beforeEach(() => {
  localStorage.clear();
  apiMock.get.mockReset().mockResolvedValue({ data: ["Notes.pdf", "Tax.pdf"] });
  apiMock.post.mockReset();
});

describe("page shell", () => {
  it("shows the heading, subtitle and form fed by the real /files list", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Flashcards" })).toBeInTheDocument();
    expect(screen.getByText(/Generate AI-powered flashcards/)).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith("/files", { params: { chat_id: "chat-1" } });
    const options = within(screen.getByLabelText("Study document")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["All documents (active chat)", "Notes.pdf", "Tax.pdf"]);
  });

  it("every card-count option is inside the backend's 1-30 range", async () => {
    renderPage();
    const select = await screen.findByLabelText("Number of flashcards");
    const values = within(select).getAllByRole("option").map((o) => Number(o.value));
    expect(values.every((n) => n >= 1 && n <= 30)).toBe(true);
    expect(values).toContain(10);
  });

  it("opened directly with no chat: guidance + link, no form, no requests", async () => {
    renderPage({});
    expect(await screen.findByText(/No active chat session detected/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Chat/ })).toHaveAttribute("href", "/chat");
    expect(screen.queryByRole("button", { name: "Generate Flashcards" })).toBeNull();
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it("opened directly: falls back to the chat StudyPilot last had open", async () => {
    localStorage.setItem("studypilot_7_conversations", JSON.stringify([{ id: 5, chat_id: "stored-chat" }]));
    localStorage.setItem("studypilot_7_active_chat", "5");
    renderPage({});
    await screen.findByLabelText("Study document");
    expect(apiMock.get).toHaveBeenCalledWith("/files", { params: { chat_id: "stored-chat" } });
  });

  it("no PDFs in the chat: explains and disables generating", async () => {
    apiMock.get.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText(/No PDFs uploaded in this chat yet/)).toBeInTheDocument();
    expect(generateBtn()).toBeDisabled();
  });
});

describe("generation request", () => {
  it("posts the exact backend schema (all documents)", async () => {
    await generate();
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = apiMock.post.mock.calls[0];
    expect(url).toBe("/flashcards/generate");
    expect(body).toEqual({ chat_id: "chat-1", pdf_name: null, num_flashcards: 10 });
    expect(typeof body.num_flashcards).toBe("number");
    expect(config.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the chosen PDF and card count", async () => {
    apiMock.post.mockResolvedValueOnce({ data: { flashcards: CARDS } });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Study document"), { target: { value: "Tax.pdf" } });
    fireEvent.change(screen.getByLabelText("Number of flashcards"), { target: { value: "20" } });
    fireEvent.click(generateBtn());
    await screen.findByText(/Card 1 of/);
    expect(apiMock.post.mock.calls[0][1]).toEqual({ chat_id: "chat-1", pdf_name: "Tax.pdf", num_flashcards: 20 });
  });

  it("shows a loading state and ignores repeated submissions", async () => {
    let resolve;
    apiMock.post.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    renderPage();
    await screen.findByLabelText("Study document");
    const form = generateBtn().closest("form");
    // Three submits inside ONE React batch: the form is still mounted for all of
    // them, so only the in-flight guard can stop duplicate requests.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(await screen.findByText("Generating your flashcards…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate Flashcards" })).toBeNull();
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    resolve({ data: { flashcards: CARDS } });
    await screen.findByText("Card 1 of 3");
  });
});

describe("study view", () => {
  it("shows the first question, card count and progress from the real response", async () => {
    await generate();
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("What is a company?")).toBeInTheDocument();
    expect(screen.queryByText("A legal entity separate from its owners.")).toBeNull(); // answer hidden
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    expect(screen.getByText("33%")).toBeInTheDocument();
  });

  it("reveals the answer on click and returns to the question on a second click", async () => {
    await generate();
    fireEvent.click(card());
    expect(screen.getByText("A legal entity separate from its owners.")).toBeInTheDocument();
    expect(screen.queryByText("What is a company?")).toBeNull();
    expect(screen.getByText("Answer")).toBeInTheDocument();
    fireEvent.click(card());
    expect(screen.getByText("What is a company?")).toBeInTheDocument();
    expect(screen.queryByText("A legal entity separate from its owners.")).toBeNull();
  });

  it("the card is a real button, so Enter / Space work natively", async () => {
    await generate();
    expect(card().tagName).toBe("BUTTON");
    expect(card()).toHaveAttribute("type", "button");
    expect(card()).toHaveAttribute("aria-label", expect.stringMatching(/reveal the answer/i));
  });

  it("Next / Previous move one card, update progress and re-hide the answer", async () => {
    await generate();
    fireEvent.click(card()); // reveal card 1
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Card 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("What is limited liability?")).toBeInTheDocument(); // answer hidden again
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    fireEvent.click(screen.getByRole("button", { name: /Previous/ }));
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("What is a company?")).toBeInTheDocument();
  });

  it("Previous is disabled on the first card", async () => {
    await generate();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
  });

  it("last card: no Next, shows 100% and a Restart that returns to card 1", async () => {
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByText("Card 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
    expect(screen.getByText(/last card/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Restart/ }));
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("What is a company?")).toBeInTheDocument();
  });

  it("a single-card deck is handled (first and last at once)", async () => {
    await generate([CARDS[0]]);
    expect(screen.getByText("Card 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Previous/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Next/ })).toBeNull();
  });

  it("arrow keys inside the study area navigate within bounds", async () => {
    await generate();
    const study = document.querySelector(".fc-study");
    fireEvent.keyDown(study, { key: "ArrowLeft" });                 // already first: no-op
    expect(screen.getByText("Card 1 of 3")).toBeInTheDocument();
    fireEvent.keyDown(study, { key: "ArrowRight" });
    fireEvent.keyDown(study, { key: "ArrowRight" });
    fireEvent.keyDown(study, { key: "ArrowRight" });                // already last: no-op
    expect(screen.getByText("Card 3 of 3")).toBeInTheDocument();
    fireEvent.keyDown(study, { key: "ArrowLeft", ctrlKey: true });  // modifier: ignored
    expect(screen.getByText("Card 3 of 3")).toBeInTheDocument();
    fireEvent.keyDown(study, { key: "ArrowLeft" });
    expect(screen.getByText("Card 2 of 3")).toBeInTheDocument();
  });

  it("long text is rendered in full (no truncation)", async () => {
    const long = "word ".repeat(400).trim();
    await generate([{ question: long, answer: "short" }]);
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("a new deck starts at card 1 with the answer hidden", async () => {
    await generate();
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(card()); // reveal card 2
    fireEvent.click(screen.getByRole("button", { name: /Generate a new deck/ }));
    apiMock.post.mockResolvedValueOnce({ data: { flashcards: [{ question: "Fresh Q?", answer: "Fresh A" }, CARDS[1]] } });
    fireEvent.click(await screen.findByRole("button", { name: "Generate Flashcards" }));
    await screen.findByText("Card 1 of 2");
    expect(screen.getByText("Fresh Q?")).toBeInTheDocument();
    expect(screen.queryByText("Fresh A")).toBeNull();
  });
});

describe("empty and error states", () => {
  async function submit() {
    renderPage();
    await screen.findByLabelText("Study document");
    fireEvent.click(generateBtn());
  }

  it("empty flashcards list: empty state, no study view", async () => {
    apiMock.post.mockResolvedValueOnce({ data: { flashcards: [] } });
    await submit();
    expect(await screen.findByText(/No flashcards could be created/)).toBeInTheDocument();
    expect(document.querySelector(".fc-study")).toBeNull();
    expect(generateBtn()).toBeEnabled();
  });

  it("response with only malformed cards is treated as empty", async () => {
    apiMock.post.mockResolvedValueOnce({ data: { flashcards: [{ question: "no answer" }] } });
    await submit();
    expect(await screen.findByText(/No flashcards could be created/)).toBeInTheDocument();
    expect(document.querySelector(".fc-study")).toBeNull();
  });

  const httpError = (status, data) => Object.assign(new Error("Request failed"), { response: { status, data } });

  it.each([
    [404, { detail: "No study documents found for this chat yet. Please upload at least one PDF before generating flashcards." }, /No study documents found/],
    [422, { detail: "Not enough information in the uploaded documents to generate flashcards." }, /Not enough information/],
    [422, { detail: [{ loc: ["body", "num_flashcards"], msg: "too big", type: "x" }] }, /between 1 and 30/],
    [502, { detail: "The study assistant returned an unexpected response format. Please try again." }, /unexpected response format/],
    [500, { detail: "Something went wrong while generating your flashcards. Please try again." }, /Something went wrong/],
  ])("HTTP %s shows a readable message and keeps the form for retry", async (status, data, pattern) => {
    apiMock.post.mockRejectedValueOnce(httpError(status, data));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(pattern);
    expect(generateBtn()).toBeEnabled();
    expect(document.querySelector(".fc-study")).toBeNull();
  });

  it("network error: connection message, no fake cards", async () => {
    apiMock.post.mockRejectedValueOnce(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't reach the StudyPilot server/);
    expect(document.querySelector(".fc-study")).toBeNull();
  });

  it("401 shows a session message without token details", async () => {
    apiMock.post.mockRejectedValueOnce(httpError(401, { detail: "Not authenticated" }));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Your session has expired. Please log in again.");
  });

  it("retry after an error works and clears the error", async () => {
    apiMock.post.mockRejectedValueOnce(httpError(500, { detail: "Something went wrong while generating your flashcards. Please try again." }));
    await submit();
    await screen.findByRole("alert");
    apiMock.post.mockResolvedValueOnce({ data: { flashcards: CARDS } });
    fireEvent.click(generateBtn());
    await screen.findByText("Card 1 of 3");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(apiMock.post).toHaveBeenCalledTimes(2);
  });
});
