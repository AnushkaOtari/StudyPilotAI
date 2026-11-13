import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock("../src/services/api", () => ({ default: apiMock }));
vi.mock("../src/hooks/useAuth", () => ({
  default: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
  useAuth: () => ({ currentUser: { id: 7, username: "tester" }, logout: vi.fn() }),
}));
vi.mock("../src/components/PdfViewerModal", () => ({
  default: ({ chatId, filename, page, onClose }) => (
    <div role="dialog" aria-label="viewer-stub">
      <span data-testid="viewer-args">{JSON.stringify({ chatId, filename, page })}</span>
      <button onClick={onClose}>stub-close</button>
    </div>
  ),
}));
// React Flow itself is covered in MindMapCanvas.test.jsx.
vi.mock("../src/components/MindMapCanvas", () => ({
  default: ({ graph, onSelect }) => (
    <div data-testid="canvas">
      {graph.nodes.map((n) => (
        <button key={n.id} onClick={() => onSelect(n.id)}>{`node:${n.label}`}</button>
      ))}
    </div>
  ),
}));

import StudyPilot from "../src/pages/StudyPilot";

const render = (ui) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

const conversations = [
  { id: 111, title: "Chat A", chat_id: "chat-a", messages: [{ role: "user", text: "qa" }, { role: "assistant", text: "answer A" }] },
  { id: 222, title: "Chat B", chat_id: "chat-b", messages: [{ role: "user", text: "qb" }, { role: "assistant", text: "answer B" }] },
];

const graphFor = (chatId) => ({
  chat_id: chatId,
  status: "COMPLETED",
  nodes: [
    {
      id: "n1", label: `Concept of ${chatId}`, description: "A description.", type: "main_topic",
      sources: [{ document: "Notes.pdf", pages: [4], description: "A description." }],
    },
  ],
  edges: [],
  documents: [{ filename: "Notes.pdf", status: "COMPLETED", error: null, has_graph: true, node_count: 1, edge_count: 0, warnings: [] }],
  stats: { node_count: 1, edge_count: 0, document_count: 1 },
});

const graphCalls = () => apiMock.get.mock.calls.filter(([url]) => String(url).startsWith("/knowledge-graph"));
const fullGraphCalls = () => graphCalls().filter(([url]) => url === "/knowledge-graph");

let graphResponse;

beforeEach(() => {
  graphResponse = (chatId) => Promise.resolve({ data: graphFor(chatId) });
  apiMock.get.mockReset().mockImplementation((url, config) => {
    if (url === "/knowledge-graph") return graphResponse(config?.params?.chat_id);
    if (url === "/knowledge-graph/status") return Promise.resolve({ data: { documents: [] } });
    return Promise.resolve({ data: [] });
  });
  apiMock.post.mockReset();
  localStorage.setItem("studypilot_7_conversations", JSON.stringify(conversations));
  localStorage.setItem("studypilot_7_active_chat", "111");
});

const openMindMap = () => fireEvent.click(screen.getByRole("tab", { name: "Mind Map" }));

describe("tabs", () => {
  it("starts on Chat and makes no knowledge-graph request", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Mind Map" })).toHaveAttribute("aria-selected", "false");
    expect(graphCalls()).toHaveLength(0);
  });

  it("opening Mind Map requests the active chat's graph", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");

    openMindMap();

    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(fullGraphCalls()).toHaveLength(1);
    expect(fullGraphCalls()[0][1].params).toEqual({ chat_id: "chat-a" });
    expect(screen.getByText("node:Concept of chat-a")).toBeInTheDocument();
  });

  it("keeps the chat mounted (hidden) and its typed text when switching tabs", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "half-typed question" } });
    const chatPanel = document.getElementById("view-panel-chat");

    openMindMap();
    await screen.findByTestId("canvas");

    expect(document.getElementById("view-panel-chat")).toBe(chatPanel); // same DOM element
    expect(chatPanel).not.toBeVisible();
    expect(screen.getByText("answer A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect(chatPanel).toBeVisible();
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("half-typed question");
  });

  it("returning to Mind Map refreshes the graph", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");

    openMindMap();
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    const before = fullGraphCalls().length;

    openMindMap();

    await waitFor(() => expect(fullGraphCalls().length).toBe(before + 1));
  });

  it("does not request the graph while the Chat tab is showing again", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    openMindMap();
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    const before = graphCalls().length;

    await new Promise((r) => setTimeout(r, 50));

    expect(graphCalls().length).toBe(before);
  });
});

describe("Mind Map inside StudyPilot", () => {
  it("opens the PDF viewer at a source page of the active chat", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    openMindMap();

    fireEvent.click(await screen.findByText("node:Concept of chat-a"));
    const details = screen.getByRole("complementary", { name: /Details for Concept of chat-a/ });
    fireEvent.click(within(details).getByRole("button", { name: "Open Notes.pdf at page 4" }));

    const args = JSON.parse((await screen.findByTestId("viewer-args")).textContent);
    expect(args).toEqual({ chatId: "chat-a", filename: "Notes.pdf", page: 4 });
  });

  it("switching conversation loads that conversation's graph", async () => {
    render(<StudyPilot />);
    await screen.findByText("answer A");
    openMindMap();
    await screen.findByText("node:Concept of chat-a");

    fireEvent.click(screen.getByText("Chat B"));

    expect(await screen.findByText("node:Concept of chat-b")).toBeInTheDocument();
    expect(screen.queryByText("node:Concept of chat-a")).not.toBeInTheDocument();
    expect(fullGraphCalls().map(([, c]) => c.params.chat_id)).toContain("chat-b");
  });

  it("a graph error is shown in the tab and the chat keeps working", async () => {
    graphResponse = () => Promise.reject(Object.assign(new Error("boom"), { response: { status: 500 } }));
    render(<StudyPilot />);
    await screen.findByText("answer A");

    openMindMap();

    expect(await screen.findByText("Could not load the mind map")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByText("answer A")).toBeVisible();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("a new conversation without uploads shows the empty state, not an error", async () => {
    graphResponse = () => Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } }));
    render(<StudyPilot />);
    await screen.findByText("answer A");

    openMindMap();

    expect(await screen.findByRole("heading", { name: "No mind map yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("'Go to Chat' from the empty state returns to the chat", async () => {
    graphResponse = () => Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } }));
    render(<StudyPilot />);
    await screen.findByText("answer A");
    openMindMap();

    fireEvent.click(await screen.findByRole("button", { name: "Go to Chat" }));

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });
});
