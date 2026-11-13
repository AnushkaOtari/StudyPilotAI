import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const hook = vi.hoisted(() => ({ useKnowledgeGraph: vi.fn() }));
vi.mock("../src/hooks/useKnowledgeGraph", () => ({ default: hook.useKnowledgeGraph }));

// The real canvas (React Flow) is covered in MindMapCanvas.test.jsx.
const canvas = vi.hoisted(() => ({ shouldThrow: false }));
vi.mock("../src/components/MindMapCanvas", () => ({
  default: function CanvasStub({ graph, selectedId, focusTick, onSelect }) {
    if (canvas.shouldThrow) throw new Error("chunk failed");
    return (
      <div data-testid="canvas" data-selected={selectedId ?? ""} data-focus={focusTick}>
        {graph.nodes.map((n) => (
          <button key={n.id} onClick={() => onSelect(n.id)}>
            {`node:${n.label}`}
          </button>
        ))}
        <button onClick={() => onSelect(null)}>pane</button>
      </div>
    );
  },
}));

import MindMapPanel from "../src/components/MindMapPanel";

const doc = (filename, status, extra = {}) => ({
  filename, status, error: null, has_graph: false, node_count: 0, edge_count: 0, warnings: [], ...extra,
});

const nodes = [
  {
    id: "a", label: "Cell", description: "Basic unit of life.", type: "main_topic",
    sources: [{ document: "Bio.pdf", pages: [2, 3], description: "Basic unit of life." }],
  },
  {
    id: "b", label: "Mitochondria", description: "Produces ATP.", type: "concept",
    sources: [{ document: "Bio.pdf", pages: [5], description: "Produces ATP." }],
  },
];

const readyData = (documents = [doc("Bio.pdf", "COMPLETED", { node_count: 2 })]) => ({
  chat_id: "c1",
  status: "COMPLETED",
  nodes,
  edges: [{ id: "e1", source: "b", target: "a", relationship: "PART_OF", label: "is part of", documents: ["Bio.pdf"] }],
  documents,
  stats: { node_count: 2, edge_count: 1, document_count: 1 },
});

const emptyData = (documents) => ({
  chat_id: "c1", status: "X", nodes: [], edges: [], documents,
  stats: { node_count: 0, edge_count: 0, document_count: 0 },
});

let api;

function setHook(overrides = {}) {
  api = {
    data: null,
    error: null,
    indexing: false,
    regenerating: false,
    actionError: null,
    refresh: vi.fn(),
    regenerate: vi.fn().mockResolvedValue(true),
    dismissActionError: vi.fn(),
    ...overrides,
  };
  hook.useKnowledgeGraph.mockReturnValue(api);
}

const err = (code, message = code) => Object.assign(new Error(message), { code });

function renderPanel(props = {}) {
  const handlers = { onOpenSource: vi.fn(), onGoToChat: vi.fn() };
  const view = render(
    <MindMapPanel chatId="c1" active refreshKey="k" {...handlers} {...props} />
  );
  return { ...handlers, ...view };
}

beforeEach(() => {
  hook.useKnowledgeGraph.mockReset();
  canvas.shouldThrow = false;
  setHook();
});

describe("MindMapPanel: wiring", () => {
  it("passes chat, active flag and refresh key to the hook", () => {
    renderPanel({ chatId: "chat-42", active: false, refreshKey: "x|y" });

    expect(hook.useKnowledgeGraph).toHaveBeenCalledWith({ chatId: "chat-42", active: false, refreshKey: "x|y" });
  });

  it("Refresh asks the hook to reload", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Refresh mind map" }));

    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("disables Refresh while a regeneration request is being sent", () => {
    setHook({ regenerating: true });
    renderPanel();

    expect(screen.getByRole("button", { name: "Refresh mind map" })).toBeDisabled();
  });
});

describe("MindMapPanel: states", () => {
  it("loading", () => {
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent("Loading your mind map");
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it.each([
    ["failed", /Could not reach the server/],
    ["unavailable", /not available right now/],
    ["invalid", /cannot be shown/],
  ])("error (%s): explains and offers to retry", (code, text) => {
    setHook({ error: err(code) });
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the mind map");
    expect(screen.getByText(text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("error: uses the backend's message for an unknown code", () => {
    setHook({ error: err("weird", "Something specific") });
    renderPanel();

    expect(screen.getByText("Something specific")).toBeInTheDocument();
  });

  it("error: a deleted chat has nothing to retry", () => {
    setHook({ error: err("gone") });
    renderPanel();

    expect(screen.getByText("This conversation was deleted.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try again/ })).not.toBeInTheDocument();
  });

  it("empty: a brand-new chat (404) is not an error", () => {
    setHook({ error: err("not_found") });
    const { onGoToChat } = renderPanel();

    expect(screen.getByRole("heading", { name: "No mind map yet" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to Chat" }));
    expect(onGoToChat).toHaveBeenCalledTimes(1);
  });

  it("empty: a chat with no PDFs, and no Go-to-Chat button without a handler", () => {
    setHook({ data: emptyData([]) });
    renderPanel({ onGoToChat: undefined });

    expect(screen.getByRole("heading", { name: "No mind map yet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to Chat" })).not.toBeInTheDocument();
  });

  it("processing: shows each PDF's progress", () => {
    setHook({
      data: emptyData([doc("A.pdf", "PROCESSING"), doc("B.pdf", "PENDING"), doc("C.pdf", "NOT_STARTED")]),
      indexing: true,
    });
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent("Building your mind map");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Building mind map")).toBeInTheDocument();
    expect(within(items[1]).getByText("Waiting to build")).toBeInTheDocument();
    expect(within(items[2]).getByText("Reading PDF")).toBeInTheDocument();
  });

  it("not generated yet: offers to generate for exactly those PDFs", () => {
    setHook({ data: emptyData([doc("A.pdf", "NOT_STARTED"), doc("B.pdf", "NOT_STARTED")]) });
    renderPanel();

    expect(screen.getByRole("heading", { name: "Mind map not generated yet" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generate mind map" }));
    expect(api.regenerate).toHaveBeenCalledWith(["A.pdf", "B.pdf"]);
  });

  it("failed: shows each PDF's reason and retries only the failed ones", () => {
    setHook({
      data: emptyData([
        doc("A.pdf", "FAILED", { error: "No readable text found in this PDF." }),
        doc("B.pdf", "FAILED", { error: "Gemini request failed." }),
      ]),
    });
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not build a mind map");
    expect(screen.getByText("No readable text found in this PDF.")).toBeInTheDocument();
    expect(screen.getByText("Gemini request failed.")).toBeInTheDocument();
    expect(screen.getByText(/chat\s+and answers are not affected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.regenerate).toHaveBeenCalledWith(["A.pdf", "B.pdf"]);
  });

  it("ready: shows the graph, the counts, and no warnings", async () => {
    setHook({ data: readyData() });
    renderPanel();

    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText("2 concepts · 1 connection")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Updating")).not.toBeInTheDocument();
  });

  it("ready: singular wording", async () => {
    setHook({ data: { ...readyData(), stats: { node_count: 1, edge_count: 0, document_count: 1 } } });
    renderPanel();

    expect(await screen.findByText("1 concept · 0 connections")).toBeInTheDocument();
  });

  it("partial: shows the graph plus which PDF failed, and retries it", async () => {
    setHook({ data: readyData([doc("Bio.pdf", "COMPLETED"), doc("Bad.pdf", "FAILED", { error: "x" })]) });
    renderPanel();

    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText(/A mind map could not be built for Bad\.pdf\./)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(api.regenerate).toHaveBeenCalledWith(["Bad.pdf"]);
  });

  it("partial: wording for several failed PDFs", async () => {
    setHook({
      data: readyData([doc("Bio.pdf", "COMPLETED"), doc("X.pdf", "FAILED"), doc("Y.pdf", "FAILED")]),
    });
    renderPanel();

    expect(await screen.findByText(/Mind maps could not be built for 2 PDFs\./)).toBeInTheDocument();
  });

  it("ready while updating: keeps the graph and shows a small 'Updating' notice", async () => {
    setHook({ data: readyData([doc("Bio.pdf", "COMPLETED"), doc("New.pdf", "PROCESSING")]) });
    renderPanel();

    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText("Updating")).toBeInTheDocument();
  });

  it("refresh failure with a graph on screen: keeps it and offers 'Try again'", async () => {
    setHook({ data: readyData(), error: err("failed") });
    renderPanel();

    expect(await screen.findByTestId("canvas")).toBeInTheDocument();
    expect(screen.getByText(/Showing the last version/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it("shows and dismisses a regenerate error", () => {
    setHook({ actionError: err("failed", "Could not start mind map generation.") });
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server");

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(api.dismissActionError).toHaveBeenCalledTimes(1);
  });

  it("explains a 503 on regenerate in plain language", () => {
    setHook({ actionError: err("unavailable") });
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent(/AI service is not configured/);
  });

  it("disables the retry button while a request is in flight", () => {
    setHook({ data: emptyData([doc("A.pdf", "FAILED")]), regenerating: true });
    renderPanel();

    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  });
});

describe("MindMapPanel: selecting concepts", () => {
  beforeEach(() => setHook({ data: readyData() }));

  it("shows nothing selected at first", async () => {
    renderPanel();

    expect((await screen.findByTestId("canvas")).dataset.selected).toBe("");
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("selecting a node opens its details: description, sources and connections", async () => {
    renderPanel();

    fireEvent.click(await screen.findByText("node:Cell"));

    const details = screen.getByRole("complementary", { name: "Details for Cell" });
    expect(within(details).getByText("Basic unit of life.")).toBeInTheDocument();
    expect(within(details).getByText("Bio.pdf")).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Open Bio.pdf at page 3" })).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Mitochondria is part of this" })).toBeInTheDocument();
    expect(screen.getByTestId("canvas").dataset.selected).toBe("a");
  });

  it("clicking the empty canvas clears the selection", async () => {
    renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));

    fireEvent.click(screen.getByText("pane"));

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("the close button clears the selection", async () => {
    renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));

    fireEvent.click(screen.getByRole("button", { name: "Close details" }));

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas").dataset.selected).toBe("");
  });

  it("choosing a connected concept selects it and asks the canvas to bring it into view", async () => {
    renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));
    expect(screen.getByTestId("canvas").dataset.focus).toBe("0");

    fireEvent.click(screen.getByRole("button", { name: "Mitochondria is part of this" }));

    expect(screen.getByRole("complementary", { name: "Details for Mitochondria" })).toBeInTheDocument();
    expect(screen.getByTestId("canvas").dataset.selected).toBe("b");
    expect(screen.getByTestId("canvas").dataset.focus).toBe("1");
  });

  it("clicking a node on the canvas does not ask the camera to move", async () => {
    renderPanel();

    fireEvent.click(await screen.findByText("node:Cell"));
    fireEvent.click(screen.getByText("node:Mitochondria"));

    expect(screen.getByTestId("canvas").dataset.focus).toBe("0");
  });

  it("opens the PDF viewer at a source page through onOpenSource", async () => {
    const { onOpenSource } = renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));

    fireEvent.click(screen.getByRole("button", { name: "Open Bio.pdf at page 2" }));

    expect(onOpenSource).toHaveBeenCalledWith({ filename: "Bio.pdf", page: 2 });
  });

  it("closes the details if a refresh removes the selected concept", async () => {
    const { rerender } = renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));

    setHook({ data: { ...readyData(), nodes: [nodes[1]], edges: [] } });
    rerender(<MindMapPanel chatId="c1" active refreshKey="k" onOpenSource={vi.fn()} />);

    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("keeps the selection while the same graph is re-fetched", async () => {
    const { rerender } = renderPanel();
    fireEvent.click(await screen.findByText("node:Cell"));

    setHook({ data: readyData() });
    rerender(<MindMapPanel chatId="c1" active refreshKey="k2" onOpenSource={vi.fn()} />);

    expect(screen.getByRole("complementary", { name: "Details for Cell" })).toBeInTheDocument();
  });
});

describe("MindMapPanel: viewer failure", () => {
  it("shows a recoverable message instead of crashing the page when the viewer fails to load", async () => {
    canvas.shouldThrow = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    setHook({ data: readyData() });
    renderPanel();

    expect(await screen.findByText("The mind map viewer could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload page" })).toBeInTheDocument();
    // the rest of the panel still works
    expect(screen.getByRole("button", { name: "Refresh mind map" })).toBeInTheDocument();

    spy.mockRestore();
  });
});
