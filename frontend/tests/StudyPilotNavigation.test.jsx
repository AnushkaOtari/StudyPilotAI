import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock("../src/services/api", () => ({ default: apiMock }));
vi.mock("../src/hooks/useAuth", () => ({
  default: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
  useAuth: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
}));
// The real viewer (pdf.js) is covered in PdfViewerModal.test.jsx; here we only
// check WHAT StudyPilot asks it to open.
vi.mock("../src/components/PdfViewerModal", () => ({
  default: ({ chatId, filename, page, onClose }) => (
    <div role="dialog" aria-label="viewer-stub">
      <span data-testid="viewer-args">{JSON.stringify({ chatId, filename, page })}</span>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));

import StudyPilot from "../src/pages/StudyPilot";

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const conversations = [
  {
    id: 111, title: "Chat A", chat_id: "chat-a",
    messages: [
      { role: "user", text: "qa" },
      { role: "assistant", text: "answer A", citations: [
        { id: "source_1", filename: "Same Name.pdf", page: 9, text: "t" },
        { id: "source_2", filename: "Other.pdf", page: 2, text: "t" },
      ] },
    ],
  },
  {
    id: 222, title: "Chat B", chat_id: "chat-b",
    messages: [
      { role: "user", text: "qb" },
      { role: "assistant", text: "answer B", citations: [
        { id: "source_1", filename: "Same Name.pdf", page: 9, text: "t" },
      ] },
    ],
  },
];

// The viewer is lazy-loaded, so wait for it to appear.
const viewerArgs = async () => JSON.parse((await screen.findByTestId("viewer-args")).textContent);

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue({ data: [] });
  apiMock.post.mockReset();
  localStorage.setItem("studypilot_7_conversations", JSON.stringify(conversations));
  localStorage.setItem("studypilot_7_active_chat", "111");
});

describe("citation click -> viewer", () => {
  it("opens the cited file at its 1-based page for the active chat", async () => {
    render(<StudyPilot />);
    fireEvent.click(await screen.findByRole("button", { name: /Same Name\.pdf — p\. 9/ }));
    expect(await viewerArgs()).toEqual({ chatId: "chat-a", filename: "Same Name.pdf", page: 9 });
  });

  it("a second citation opens its own document and page", async () => {
    render(<StudyPilot />);
    fireEvent.click(await screen.findByRole("button", { name: /Other\.pdf — p\. 2/ }));
    expect(await viewerArgs()).toEqual({ chatId: "chat-a", filename: "Other.pdf", page: 2 });
  });

  it("same filename in another chat opens THAT chat's document", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    fireEvent.click(screen.getByText("Chat B"));
    await screen.findByText("answer B");
    fireEvent.click(screen.getByRole("button", { name: /Same Name\.pdf — p\. 9/ }));
    expect(await viewerArgs()).toEqual({ chatId: "chat-b", filename: "Same Name.pdf", page: 9 });
  });

  it("closing the viewer removes it and keeps the chat", async () => {
    render(<StudyPilot />);
    fireEvent.click(await screen.findByRole("button", { name: /Other\.pdf — p\. 2/ }));
    await viewerArgs();
    fireEvent.click(screen.getByText("stub-close"));
    await waitFor(() => expect(screen.queryByTestId("viewer-args")).toBeNull());
    expect(screen.getByText("answer A")).toBeInTheDocument();
  });
});

describe("mobile navigation drawer", () => {
  const sidebar = () => document.getElementById("app-sidebar");

  it("is closed by default and the menu button opens it", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    expect(sidebar()).not.toHaveClass("open");
    expect(document.querySelector(".sidebar-backdrop")).toBeNull();

    const menu = screen.getByRole("button", { name: "Open navigation menu" });
    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(menu);
    expect(sidebar()).toHaveClass("open");
    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".sidebar-backdrop")).not.toBeNull();
  });

  it("closes with Escape, the close button and the backdrop", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    const menu = screen.getByRole("button", { name: "Open navigation menu" });

    fireEvent.click(menu);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sidebar()).not.toHaveClass("open");

    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(sidebar()).not.toHaveClass("open");

    fireEvent.click(menu);
    fireEvent.click(document.querySelector(".sidebar-backdrop"));
    expect(sidebar()).not.toHaveClass("open");
  });

  it("choosing a conversation closes the drawer and switches chat", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.click(screen.getByText("Chat B"));
    expect(sidebar()).not.toHaveClass("open");
    expect(await screen.findByText("answer B")).toBeInTheDocument();
  });

  it("AI Quiz and Settings stay available in the sidebar", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    expect(screen.getByText("AI Quiz")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });
});
