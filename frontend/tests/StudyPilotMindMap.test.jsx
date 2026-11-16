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

// What /files returns for each chat.
const filesOf = { "chat-a": ["Cells.pdf", "Bio.pdf"], "chat-b": ["Other.pdf"] };

// Two PDFs with DIFFERENT concepts and page numbers. The backend returns only
// the requested PDF's graph; the fake does the same, so a request that
// forgets the filename can only ever get an obviously wrong answer.
const CONCEPTS = {
  "Cells.pdf": { label: "Mitochondria", page: 3 },
  "Bio.pdf": { label: "Photosynthesis", page: 7 },
  "Other.pdf": { label: "Gravity", page: 1 },
};

const graphFor = (chatId, filename) => {
  const { label, page } = CONCEPTS[filename];
  return {
    chat_id: chatId,
    status: "COMPLETED",
    nodes: [
      {
        id: `n-${filename}`, label, description: `About ${label}.`, type: "main_topic",
        sources: [{ document: filename, pages: [page], description: `About ${label}.` }],
      },
    ],
    edges: [],
    documents: [{ filename, status: "COMPLETED", error: null, has_graph: true, node_count: 1, edge_count: 0, warnings: [] }],
    stats: { node_count: 1, edge_count: 0, document_count: 1 },
  };
};

const graphCalls = () => apiMock.get.mock.calls.filter(([url]) => String(url).startsWith("/knowledge-graph"));
const fullGraphCalls = () => graphCalls().filter(([url]) => url === "/knowledge-graph");
const requested = () => fullGraphCalls().map(([, c]) => c.params);

let graphResponse;

beforeEach(() => {
  graphResponse = (chatId, filename) => Promise.resolve({ data: graphFor(chatId, filename) });
  apiMock.get.mockReset().mockImplementation((url, config) => {
    const { chat_id: chatId, filename } = config?.params || {};
    if (url === "/files") return Promise.resolve({ data: filesOf[chatId] || [] });
    if (url === "/knowledge-graph") return graphResponse(chatId, filename);
    if (url === "/knowledge-graph/status") {
      return Promise.resolve({ data: { chat_id: chatId, status: "COMPLETED", documents: [] } });
    }
    return Promise.resolve({ data: [] });
  });
  apiMock.post.mockReset();
  localStorage.clear();
  localStorage.setItem("studypilot_7_conversations", JSON.stringify(conversations));
  localStorage.setItem("studypilot_7_active_chat", "111");
});

/** Start with a document selected in the sidebar (or "All Documents"). */
const selectInitially = (filename) => {
  if (filename) localStorage.setItem("studypilot_7_selected_pdf", filename);
};

const openMindMap = () => fireEvent.click(screen.getByRole("tab", { name: "Mind Map" }));
const sidebar = () => screen.getByText("Study Materials").closest(".sidebar-section");
const pickInSidebar = (name) => fireEvent.click(within(sidebar()).getByText(name));

async function ready() {
  await screen.findByText("answer A");
  // the sidebar lists this chat's PDFs once /files has answered
  await within(sidebar()).findByText("Bio.pdf");
}

describe("tabs", () => {
  it("starts on Chat and makes no knowledge-graph request", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(graphCalls()).toHaveLength(0);
  });

  it("keeps the chat mounted (hidden) and its typed text when switching tabs", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "half-typed question" } });
    const chatPanel = document.getElementById("view-panel-chat");

    openMindMap();
    await screen.findByTestId("canvas");

    expect(document.getElementById("view-panel-chat")).toBe(chatPanel); // same DOM element
    expect(chatPanel).not.toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));

    expect(chatPanel).toBeVisible();
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("half-typed question");
  });

  it("does not request the graph while the Chat tab is showing again", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    const before = graphCalls().length;

    await new Promise((r) => setTimeout(r, 50));

    expect(graphCalls().length).toBe(before);
  });

  it("returning to Mind Map refreshes the graph", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByTestId("canvas");
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    const before = fullGraphCalls().length;

    openMindMap();

    await waitFor(() => expect(fullGraphCalls().length).toBe(before + 1));
  });
});

describe("Mind Map shows only the selected document", () => {
  it("requests the selected PDF's graph, and shows only its concepts", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();

    openMindMap();

    expect(await screen.findByText("node:Photosynthesis")).toBeInTheDocument();
    expect(screen.queryByText("node:Mitochondria")).not.toBeInTheDocument();
    expect(requested()).toEqual([{ chat_id: "chat-a", filename: "Bio.pdf" }]);
  });

  it("the other PDF shows its own, different, concepts", async () => {
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();

    openMindMap();

    expect(await screen.findByText("node:Mitochondria")).toBeInTheDocument();
    expect(screen.queryByText("node:Photosynthesis")).not.toBeInTheDocument();
    expect(requested()).toEqual([{ chat_id: "chat-a", filename: "Cells.pdf" }]);
  });

  it("switching document in the sidebar replaces the graph", async () => {
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByText("node:Mitochondria");

    pickInSidebar("Bio.pdf");

    expect(await screen.findByText("node:Photosynthesis")).toBeInTheDocument();
    expect(screen.queryByText("node:Mitochondria")).not.toBeInTheDocument();

    pickInSidebar("Cells.pdf");

    expect(await screen.findByText("node:Mitochondria")).toBeInTheDocument();
    expect(screen.queryByText("node:Photosynthesis")).not.toBeInTheDocument();
  });

  it("never makes a Mind Map request without a document (no merged graph is ever asked for)", async () => {
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByText("node:Mitochondria");
    pickInSidebar("Bio.pdf");
    await screen.findByText("node:Photosynthesis");
    fireEvent.click(within(sidebar()).getByText("All Documents"));
    await screen.findByText("Select a document");

    for (const [, config] of graphCalls()) {
      expect(config.params.filename).toBeTruthy();
    }
  });

  it("'All Documents' asks the user to pick one, and requests no graph", async () => {
    render(<StudyPilot />); // nothing selected = All Documents
    await ready();

    openMindMap();

    expect(await screen.findByText("Select a document")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
    expect(graphCalls()).toHaveLength(0);
    const picker = screen.getByRole("heading", { name: "Select a document" }).closest(".mindmap-state");
    expect(within(picker).getByRole("button", { name: /Cells\.pdf/ })).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: /Bio\.pdf/ })).toBeInTheDocument();
  });

  it("choosing a PDF from that prompt loads just that PDF", async () => {
    render(<StudyPilot />);
    await ready();
    openMindMap();
    const prompt = (await screen.findByRole("heading", { name: "Select a document" })).closest(".mindmap-state");

    fireEvent.click(within(prompt).getByRole("button", { name: /Bio\.pdf/ }));

    expect(await screen.findByText("node:Photosynthesis")).toBeInTheDocument();
    expect(requested()).toEqual([{ chat_id: "chat-a", filename: "Bio.pdf" }]);
  });

  it("going back to 'All Documents' drops the graph instead of merging", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByText("node:Photosynthesis");

    fireEvent.click(within(sidebar()).getByText("All Documents"));

    expect(await screen.findByText("Select a document")).toBeInTheDocument();
    expect(screen.queryByText("node:Photosynthesis")).not.toBeInTheDocument();
  });

  it("each document keeps its own graph when switching back and forth", async () => {
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByText("node:Mitochondria");

    for (const [name, label, other] of [
      ["Bio.pdf", "Photosynthesis", "Mitochondria"],
      ["Cells.pdf", "Mitochondria", "Photosynthesis"],
      ["Bio.pdf", "Photosynthesis", "Mitochondria"],
    ]) {
      pickInSidebar(name);
      expect(await screen.findByText(`node:${label}`)).toBeInTheDocument();
      expect(screen.queryByText(`node:${other}`)).not.toBeInTheDocument();
    }
  });

  it("a slow answer for the previous document cannot replace the current graph", async () => {
    let releaseCells;
    graphResponse = (chatId, filename) =>
      filename === "Cells.pdf"
        ? new Promise((resolve) => { releaseCells = () => resolve({ data: graphFor(chatId, filename) }); })
        : Promise.resolve({ data: graphFor(chatId, filename) });
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await waitFor(() => expect(requested()).toHaveLength(1)); // Cells.pdf still pending

    pickInSidebar("Bio.pdf");
    expect(await screen.findByText("node:Photosynthesis")).toBeInTheDocument();
    releaseCells(); // the stale answer arrives late
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByText("node:Photosynthesis")).toBeInTheDocument();
    expect(screen.queryByText("node:Mitochondria")).not.toBeInTheDocument();
  });

  it("a PDF selected earlier that is not in this chat is treated as 'All Documents'", async () => {
    selectInitially("Gone.pdf");
    render(<StudyPilot />);
    await ready();

    openMindMap();

    expect(await screen.findByText("Select a document")).toBeInTheDocument();
    expect(graphCalls()).toHaveLength(0);
  });

  it("source pages open the selected document's PDF at the right page", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();

    fireEvent.click(await screen.findByText("node:Photosynthesis"));
    const details = screen.getByRole("complementary", { name: /Details for Photosynthesis/ });
    expect(within(details).queryByText("Cells.pdf")).not.toBeInTheDocument();
    fireEvent.click(within(details).getByRole("button", { name: "Open Bio.pdf at page 7" }));

    const args = JSON.parse((await screen.findByTestId("viewer-args")).textContent);
    expect(args).toEqual({ chatId: "chat-a", filename: "Bio.pdf", page: 7 });
  });

  it("the other document's source page opens the other PDF", async () => {
    selectInitially("Cells.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();

    fireEvent.click(await screen.findByText("node:Mitochondria"));
    fireEvent.click(screen.getByRole("button", { name: "Open Cells.pdf at page 3" }));

    const args = JSON.parse((await screen.findByTestId("viewer-args")).textContent);
    expect(args).toEqual({ chatId: "chat-a", filename: "Cells.pdf", page: 3 });
  });
});

describe("Mind Map across conversations and errors", () => {
  it("switching conversation never carries the document over from the other chat", async () => {
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();
    openMindMap();
    await screen.findByText("node:Photosynthesis");

    fireEvent.click(screen.getByText("Chat B"));

    // chat-b has no Bio.pdf: asks to pick one of ITS documents; no chat-b request used Bio.pdf
    expect(await screen.findByText("Select a document")).toBeInTheDocument();
    expect(screen.queryByText("node:Photosynthesis")).not.toBeInTheDocument();
    expect(requested().filter((p) => p.chat_id === "chat-b")).toEqual([]);
  });

  it("a graph error is shown in the tab and the chat keeps working", async () => {
    graphResponse = () => Promise.reject(Object.assign(new Error("boom"), { response: { status: 500 } }));
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();

    openMindMap();

    expect(await screen.findByText("Could not load the mind map")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByText("answer A")).toBeVisible();
    expect(screen.getByRole("textbox")).toBeEnabled();
  });

  it("a 404 for the selected PDF is the empty state, not an error", async () => {
    graphResponse = () => Promise.reject(Object.assign(new Error("nf"), { response: { status: 404 } }));
    selectInitially("Bio.pdf");
    render(<StudyPilot />);
    await ready();

    openMindMap();

    expect(await screen.findByRole("heading", { name: "No mind map yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
