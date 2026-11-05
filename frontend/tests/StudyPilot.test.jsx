import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock("../src/services/api", () => ({ default: apiMock }));
vi.mock("../src/hooks/useAuth", () => ({
  default: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
  useAuth: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
}));

import StudyPilot from "../src/pages/StudyPilot";

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const CHAT_STORAGE = "studypilot_7_conversations";

function ask(text) {
  fireEvent.change(screen.getByPlaceholderText(/Ask anything/i), { target: { value: text } });
  fireEvent.click(screen.getByTitle("Send Question"));
}

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue({ data: [] });
  apiMock.post.mockReset();
  apiMock.delete.mockReset();
});

describe("StudyPilot /ask wiring", () => {
  it("sends the same request body as before and shows answer + citations", async () => {
    apiMock.post.mockResolvedValueOnce({ data: {
      question: "What is a company?",
      answer: "A company is a legal entity.",
      sources: ["Understanding Companies.pdf"],
      citations: [
        { id: "source_1", filename: "Understanding Companies.pdf", page: 9, text: "t1" },
        { id: "source_2", filename: "Understanding Companies.pdf", page: 10, text: "t2" },
      ],
    } });
    render(<StudyPilot />);
    await screen.findByPlaceholderText(/Ask anything/i);
    ask("What is a company?");

    expect(await screen.findByText("A company is a legal entity.")).toBeInTheDocument();
    expect(screen.getByText("Understanding Companies.pdf — p. 9")).toBeInTheDocument();
    expect(screen.getByText("Understanding Companies.pdf — p. 10")).toBeInTheDocument();

    const [url, body] = apiMock.post.mock.calls[0];
    expect(url).toBe("/ask");
    expect(Object.keys(body).sort()).toEqual(["chat_id", "filename", "question"]);
    expect(body.question).toBe("What is a company?");
    expect(body.filename).toBeNull();
  });

  it("keeps each answer's citations separate across a follow-up", async () => {
    apiMock.post
      .mockResolvedValueOnce({ data: { answer: "first", sources: ["A.pdf"],
        citations: [{ id: "source_1", filename: "A.pdf", page: 1, text: "x" }] } })
      .mockResolvedValueOnce({ data: { answer: "second", sources: ["B.pdf"],
        citations: [{ id: "source_1", filename: "B.pdf", page: 4, text: "y" }] } });
    render(<StudyPilot />);
    await screen.findByPlaceholderText(/Ask anything/i);

    ask("q1");
    await screen.findByText("first");
    ask("explain that more simply");
    await screen.findByText("second");

    const bubbles = [...document.querySelectorAll(".ai-message")];
    expect(bubbles).toHaveLength(2);
    expect(within(bubbles[0]).getByText("A.pdf — p. 1")).toBeInTheDocument();
    expect(within(bubbles[0]).queryByText("B.pdf — p. 4")).toBeNull();
    expect(within(bubbles[1]).getByText("B.pdf — p. 4")).toBeInTheDocument();
  });

  it("works when the response has no citations field or empty citations", async () => {
    apiMock.post
      .mockResolvedValueOnce({ data: { answer: "legacy answer", sources: ["A.pdf"] } })
      .mockResolvedValueOnce({ data: { answer: "empty answer", sources: [], citations: [] } });
    render(<StudyPilot />);
    await screen.findByPlaceholderText(/Ask anything/i);
    ask("q1"); await screen.findByText("legacy answer");
    ask("q2"); await screen.findByText("empty answer");
    expect(document.querySelector(".citation-section")).toBeNull();
  });

  it("shows no chips for the backend-failure message", async () => {
    apiMock.post.mockRejectedValueOnce(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<StudyPilot />);
    await screen.findByPlaceholderText(/Ask anything/i);
    ask("q1");
    expect(await screen.findByText(/Failed to connect to the backend/)).toBeInTheDocument();
    expect(document.querySelector(".citation-section")).toBeNull();
  });

  it("renders saved chat history, with and without citations", async () => {
    localStorage.setItem(CHAT_STORAGE, JSON.stringify([{
      id: 111, title: "Saved chat", chat_id: "chat-abc",
      messages: [
        { role: "user", text: "old q" },
        { role: "assistant", text: "old answer (no citations field)" },
        { role: "user", text: "new q" },
        { role: "assistant", text: "new answer", citations: [
          { id: "source_1", filename: "Saved.pdf", page: 3, text: "t" } ] },
      ],
    }]));
    localStorage.setItem("studypilot_7_active_chat", "111");
    render(<StudyPilot />);
    expect(await screen.findByText("old answer (no citations field)")).toBeInTheDocument();
    expect(screen.getByText("new answer")).toBeInTheDocument();
    expect(screen.getAllByText("Saved.pdf — p. 3")).toHaveLength(1);
    await waitFor(() => expect(apiMock.get).toHaveBeenCalled());
  });

  it("persists citations with the message in the existing conversation storage", async () => {
    apiMock.post.mockResolvedValueOnce({ data: { answer: "stored", sources: ["A.pdf"],
      citations: [{ id: "source_1", filename: "A.pdf", page: 2, text: "t" }] } });
    render(<StudyPilot />);
    await screen.findByPlaceholderText(/Ask anything/i);
    ask("q1");
    await screen.findByText("stored");
    const saved = JSON.parse(localStorage.getItem(CHAT_STORAGE));
    const assistant = saved[0].messages.find((m) => m.role === "assistant");
    expect(assistant.citations).toEqual([{ id: "source_1", filename: "A.pdf", page: 2, text: "t" }]);
    expect(Object.keys(saved[0].messages[0])).toEqual(["role", "text"]); // user message shape unchanged
  });
});
