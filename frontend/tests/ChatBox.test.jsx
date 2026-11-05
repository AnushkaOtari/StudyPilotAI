import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import ChatBox from "../src/components/ChatBox";

const cite = (filename, page, id = "source_1") => ({ id, filename, page, text: "evidence" });

describe("citation chips in ChatBox", () => {
  it("shows one citation under an assistant answer", () => {
    render(<ChatBox messages={[
      { role: "user", text: "What is a company?" },
      { role: "assistant", text: "A company is a legal entity.", citations: [cite("Understanding Companies.pdf", 9)] },
    ]} />);
    expect(screen.getByText("Understanding Companies.pdf — p. 9")).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
  });

  it("shows multiple citations from multiple PDFs in order", () => {
    render(<ChatBox messages={[
      { role: "assistant", text: "Answer", citations: [
        cite("Understanding Companies.pdf", 9, "source_1"),
        cite("Tax Basics.pdf", 2, "source_2"),
        cite("Understanding Companies.pdf", 10, "source_3"),
      ] },
    ]} />);
    const chips = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual([
      "Understanding Companies.pdf — p. 9",
      "Tax Basics.pdf — p. 2",
      "Understanding Companies.pdf — p. 10",
    ]);
  });

  it("does not render an empty citation section", () => {
    const { container } = render(<ChatBox messages={[
      { role: "assistant", text: "No sources here", citations: [] },
    ]} />);
    expect(container.querySelector(".citation-section")).toBeNull();
    expect(screen.queryByText("Sources")).toBeNull();
  });

  it("renders old messages without a citations field exactly as before", () => {
    const { container } = render(<ChatBox messages={[
      { role: "user", text: "old question" },
      { role: "assistant", text: "old answer" },
    ]} />);
    expect(screen.getByText("old question")).toBeInTheDocument();
    expect(screen.getByText("old answer")).toBeInTheDocument();
    expect(container.querySelector(".citation-section")).toBeNull();
  });

  it("handles missing filename or page safely", () => {
    render(<ChatBox messages={[
      { role: "assistant", text: "Answer", citations: [
        { id: "source_1", filename: "Only Name.pdf", page: null, text: "t" },
        { id: "source_2", filename: null, page: 7, text: "t" },
        { id: "source_3", filename: null, page: null, text: "t" },
        null,
      ] },
    ]} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Only Name.pdf", "p. 7"]);
  });

  it("keeps each citation set under its own assistant answer", () => {
    render(<ChatBox messages={[
      { role: "user", text: "q1" },
      { role: "assistant", text: "first answer", citations: [cite("A.pdf", 1)] },
      { role: "user", text: "q2" },
      { role: "assistant", text: "second answer", citations: [cite("B.pdf", 5)] },
      { role: "user", text: "q3" },
      { role: "assistant", text: "third answer, no sources" },
    ]} />);
    const messages = [...document.querySelectorAll(".ai-message")];
    expect(messages).toHaveLength(3);
    expect(within(messages[0]).getByText("A.pdf — p. 1")).toBeInTheDocument();
    expect(within(messages[0]).queryByText("B.pdf — p. 5")).toBeNull();
    expect(within(messages[1]).getByText("B.pdf — p. 5")).toBeInTheDocument();
    expect(within(messages[1]).queryByText("A.pdf — p. 1")).toBeNull();
    expect(messages[2].querySelector(".citation-section")).toBeNull();
  });

  it("never shows chips on user messages", () => {
    const { container } = render(<ChatBox messages={[
      { role: "user", text: "q", citations: [cite("A.pdf", 1)] },
    ]} />);
    expect(container.querySelector(".citation-section")).toBeNull();
  });

  it("chips are read-only labels (no PDF viewer exists yet)", () => {
    render(<ChatBox messages={[
      { role: "assistant", text: "Answer", citations: [cite("A.pdf", 1)] },
    ]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("still shows the welcome state with no messages", () => {
    render(<ChatBox messages={[]} />);
    expect(screen.getByText("Welcome to StudyPilot AI")).toBeInTheDocument();
  });
});
