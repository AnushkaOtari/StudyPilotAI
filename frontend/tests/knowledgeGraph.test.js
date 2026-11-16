import { describe, it, expect } from "vitest";
import {
  BRANCH_COLORS,
  ROOT_COLOR,
  branchColor,
  compressPages,
  deriveView,
  documentStatusText,
  documentsInGraph,
  edgeCurve,
  edgeEndpoints,
  getNeighbors,
  graphSignature,
  isBusy,
  isIndexing,
  nodeTypeLabel,
  nodeWidth,
  relationshipText,
  statusSignature,
  toFlowElements,
  VIEW_CHAT,
  VIEW_MINDMAP,
  viewPanelId,
  viewTabId,
} from "../src/utils/knowledgeGraph";

const doc = (filename, status, extra = {}) => ({
  filename,
  status,
  node_count: 0,
  edge_count: 0,
  error: null,
  ...extra,
});

const node = (id, label, extra = {}) => ({
  id,
  label,
  description: "",
  type: "concept",
  sources: [{ document: "A.pdf", pages: [1], description: "" }],
  ...extra,
});

const edge = (id, source, target, extra = {}) => ({
  id,
  source,
  target,
  relationship: "PART_OF",
  label: "is part of",
  documents: ["A.pdf"],
  ...extra,
});

const graph = {
  nodes: [node("a", "Cell"), node("b", "Mitochondria"), node("c", "Nucleus"), node("d", "Lonely")],
  edges: [edge("e1", "b", "a"), edge("e2", "c", "a", { relationship: "RELATED_TO", label: "" })],
};

describe("deriveView", () => {
  it("is loading before the first response", () => {
    expect(deriveView({ data: null, error: null }).kind).toBe("loading");
  });

  it("treats a 404 (brand-new chat, nothing uploaded) as empty, not an error", () => {
    expect(deriveView({ data: null, error: { code: "not_found" } }).kind).toBe("empty");
  });

  it.each(["failed", "gone", "unavailable"])("shows an error for code %s when there is no data", (code) => {
    const view = deriveView({ data: null, error: { code, message: "x" } });
    expect(view.kind).toBe("error");
    expect(view.error.code).toBe(code);
  });

  it("is empty when the chat has no PDFs", () => {
    expect(deriveView({ data: { nodes: [], documents: [] } }).kind).toBe("empty");
  });

  it("is not_started when PDFs exist but no graph was ever generated", () => {
    const view = deriveView({ data: { nodes: [], documents: [doc("a.pdf", "NOT_STARTED")] } });
    expect(view.kind).toBe("not_started");
    expect(view.notStartedDocs.map((d) => d.filename)).toEqual(["a.pdf"]);
  });

  it.each([
    ["graph PENDING", [doc("a.pdf", "PENDING")], false],
    ["graph PROCESSING", [doc("a.pdf", "PROCESSING")], false],
    ["PDF still being indexed", [doc("a.pdf", "NOT_STARTED")], true],
  ])("is processing while %s", (_, documents, indexing) => {
    const view = deriveView({ data: { nodes: [], documents }, indexing });
    expect(view.kind).toBe("processing");
    expect(view.busy).toBe(true);
  });

  it("is failed when nothing was produced and every attempt failed", () => {
    const view = deriveView({
      data: { nodes: [], documents: [doc("a.pdf", "FAILED", { error: "No readable text found in this PDF." })] },
    });
    expect(view.kind).toBe("failed");
    expect(view.failedDocs[0].error).toMatch(/No readable text/);
  });

  it("is ready for a graph with no failures", () => {
    const view = deriveView({ data: { nodes: graph.nodes, documents: [doc("A.pdf", "COMPLETED")] } });
    expect(view.kind).toBe("ready");
    expect(view.busy).toBe(false);
  });

  it("is partial when there is a graph but a PDF failed", () => {
    const view = deriveView({
      data: { nodes: graph.nodes, documents: [doc("A.pdf", "COMPLETED"), doc("B.pdf", "FAILED")] },
    });
    expect(view.kind).toBe("partial");
    expect(view.failedDocs.map((d) => d.filename)).toEqual(["B.pdf"]);
  });

  it("keeps showing the graph, flagged busy, while a new PDF is processed", () => {
    const view = deriveView({
      data: { nodes: graph.nodes, documents: [doc("A.pdf", "COMPLETED"), doc("B.pdf", "PROCESSING")] },
    });
    expect(view.kind).toBe("ready");
    expect(view.busy).toBe(true);
  });

  it("keeps the graph when a regeneration failed (last good graph is kept by the backend)", () => {
    const view = deriveView({
      data: { nodes: graph.nodes, documents: [doc("A.pdf", "FAILED", { has_graph: true })] },
    });
    expect(view.kind).toBe("partial");
  });
});

describe("status helpers", () => {
  it("isIndexing is true only for WAITING / PROCESSING queue jobs", () => {
    expect(isIndexing([{ status: "COMPLETED" }, { status: "WAITING" }])).toBe(true);
    expect(isIndexing([{ status: "PROCESSING" }])).toBe(true);
    expect(isIndexing([{ status: "COMPLETED" }, { status: "FAILED" }, { status: "CANCELLED" }])).toBe(false);
    expect(isIndexing([])).toBe(false);
    expect(isIndexing(undefined)).toBe(false);
  });

  it("isBusy covers graph jobs and indexing", () => {
    expect(isBusy([doc("a", "COMPLETED")], false)).toBe(false);
    expect(isBusy([doc("a", "PENDING")], false)).toBe(true);
    expect(isBusy([doc("a", "PROCESSING")], false)).toBe(true);
    expect(isBusy([doc("a", "FAILED"), doc("b", "NOT_STARTED")], false)).toBe(false);
    expect(isBusy([], true)).toBe(true);
    expect(isBusy(undefined, false)).toBe(false);
  });

  it("statusSignature ignores order but notices every relevant change", () => {
    const a = [doc("a.pdf", "COMPLETED", { node_count: 3 }), doc("b.pdf", "PENDING")];
    const reordered = [a[1], a[0]];

    expect(statusSignature(a)).toBe(statusSignature(reordered));
    expect(statusSignature(a)).not.toBe(statusSignature([a[0], doc("b.pdf", "PROCESSING")]));
    expect(statusSignature(a)).not.toBe(statusSignature([doc("a.pdf", "COMPLETED", { node_count: 4 }), a[1]]));
    expect(statusSignature(a)).not.toBe(statusSignature([a[0]]));
    expect(statusSignature([doc("a", "X", { updated_at: 1 })])).not.toBe(
      statusSignature([doc("a", "X", { updated_at: 2 })])
    );
    expect(statusSignature(undefined)).toBe("");
  });
});

describe("documentStatusText", () => {
  it.each([
    ["COMPLETED", false, "Done"],
    ["FAILED", false, "Failed"],
    ["PROCESSING", false, "Building mind map"],
    ["PENDING", false, "Waiting to build"],
    ["NOT_STARTED", true, "Reading PDF"],
    ["NOT_STARTED", false, "Not generated yet"],
  ])("%s (indexing=%s) -> %s", (status, indexing, text) => {
    expect(documentStatusText({ status }, indexing)).toBe(text);
  });
});

describe("view ids", () => {
  it("ties each tab to its panel", () => {
    expect(viewTabId(VIEW_MINDMAP)).toBe("view-tab-mindmap");
    expect(viewPanelId(VIEW_CHAT)).toBe("view-panel-chat");
    expect(VIEW_CHAT).not.toBe(VIEW_MINDMAP);
  });
});

describe("compressPages", () => {
  it.each([
    [[4], "4"],
    [[4, 5], "4–5"],
    [[9, 4, 5, 6], "4–6, 9"],
    [[1, 3, 5], "1, 3, 5"],
    [[2, 2, 3], "2–3"],
    [[], ""],
    [undefined, ""],
    [[0, -1, 1.5, "x", 7], "7"],
  ])("%j -> %j", (pages, expected) => {
    expect(compressPages(pages)).toBe(expected);
  });
});

describe("getNeighbors", () => {
  it("lists connected concepts with direction, sorted by name", () => {
    const result = getNeighbors(graph, "a");

    expect(result.map((r) => [r.node.label, r.direction])).toEqual([
      ["Mitochondria", "in"],
      ["Nucleus", "in"],
    ]);

    const fromB = getNeighbors(graph, "b");
    expect(fromB).toHaveLength(1);
    expect(fromB[0]).toMatchObject({ direction: "out", node: { id: "a" } });
  });

  it("returns nothing for an isolated node, an unknown id or no graph", () => {
    expect(getNeighbors(graph, "d")).toEqual([]);
    expect(getNeighbors(graph, "zzz")).toEqual([]);
    expect(getNeighbors(null, "a")).toEqual([]);
    expect(getNeighbors(graph, null)).toEqual([]);
  });

  it("ignores edges whose other end is missing", () => {
    const broken = { nodes: [node("a", "A")], edges: [edge("e", "a", "ghost")] };
    expect(getNeighbors(broken, "a")).toEqual([]);
  });
});

describe("misc helpers", () => {
  it("documentsInGraph lists each PDF once, sorted", () => {
    const g = {
      nodes: [
        node("a", "A", { sources: [{ document: "B.pdf" }, { document: "A.pdf" }] }),
        node("b", "B", { sources: [{ document: "B.pdf" }] }),
        node("c", "C", { sources: undefined }),
      ],
    };
    expect(documentsInGraph(g)).toEqual(["A.pdf", "B.pdf"]);
    expect(documentsInGraph(null)).toEqual([]);
  });

  it("relationshipText prefers the edge label, then a readable default", () => {
    expect(relationshipText({ label: "includes", relationship: "PART_OF" })).toBe("includes");
    expect(relationshipText({ label: "", relationship: "LEADS_TO" })).toBe("leads to");
    expect(relationshipText({ relationship: "UNKNOWN" })).toBe("is related to");
    expect(relationshipText(undefined)).toBe("is related to");
  });

  it("nodeTypeLabel falls back to Concept", () => {
    expect(nodeTypeLabel("main_topic")).toBe("Main topic");
    expect(nodeTypeLabel("weird")).toBe("Concept");
  });

  it("nodeWidth grows with the label but stays within bounds", () => {
    expect(nodeWidth("A")).toBe(96);
    expect(nodeWidth("x".repeat(500))).toBe(220);
    expect(nodeWidth("Photosynthesis")).toBeGreaterThan(nodeWidth("Cell"));
    expect(nodeWidth(undefined)).toBe(96);
  });

  it("graphSignature changes with the graph's shape but not its order", () => {
    const reordered = { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() };

    expect(graphSignature(graph)).toBe(graphSignature(reordered));
    expect(graphSignature(graph)).not.toBe(graphSignature({ ...graph, nodes: graph.nodes.slice(1) }));
    expect(graphSignature(null)).toBe("#");
  });
});

describe("toFlowElements", () => {
  const layout = {
    positions: new Map([
      ["a", { x: 10, y: 20 }],
      ["b", { x: 30, y: 40 }],
    ]),
    info: new Map([
      ["a", { root: true, rootId: "a", depth: 0, branch: -1, parentId: null, parentEdgeId: null, width: 160, height: 64 }],
      ["b", { root: false, rootId: "a", depth: 1, branch: 2, parentId: "a", parentEdgeId: "e1", width: 100, height: 44 }],
    ]),
  };

  it("maps every node and edge, using layout positions and sizes (default 0,0)", () => {
    const { nodes, edges } = toFlowElements(graph, layout, null);

    expect(nodes).toHaveLength(4);
    expect(edges).toHaveLength(2);
    expect(nodes.find((n) => n.id === "a")).toMatchObject({
      type: "concept",
      position: { x: 10, y: 20 },
      width: 160,
      height: 64,
      selected: false,
      data: { label: "Cell", kind: "concept", root: true, depth: 0, width: 160, height: 64 },
    });
    expect(nodes.find((n) => n.id === "d").position).toEqual({ x: 0, y: 0 });
    expect(edges[0]).toMatchObject({ id: "e1", source: "b", target: "a", type: "floating" });
    expect(nodes.find((n) => n.id === "a").ariaLabel).toBe("Cell, concept");
  });

  it("gives every node an explicit size (the minimap needs it) even without a layout", () => {
    const { nodes } = toFlowElements(graph, null, null);

    for (const n of nodes) {
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it("colours a node by its branch, and the centre with the root colour", () => {
    const { nodes } = toFlowElements(graph, layout, null);

    expect(nodes.find((n) => n.id === "a").data.color).toBe(ROOT_COLOR);
    expect(nodes.find((n) => n.id === "b").data.color).toBe(BRANCH_COLORS[2]);
  });

  it("draws the layout's parent link as a branch connector and the rest as cross-links", () => {
    const { edges } = toFlowElements(graph, layout, null);
    const e1 = edges.find((e) => e.id === "e1");
    const e2 = edges.find((e) => e.id === "e2");

    expect(e1.className).toBe("is-tree");
    expect(e1.data).toMatchObject({ tree: true, parentId: "a", originId: "a" });
    expect(e2.className).toBe("is-cross");
    expect(e2.data.tree).toBe(false);
    expect(e1.data.strokeWidth).toBeGreaterThan(e2.data.strokeWidth);
  });

  it("branch connectors have no arrowhead; cross-links do", () => {
    const { edges } = toFlowElements(graph, layout, null);

    const e1 = edges.find((e) => e.id === "e1");
    const e2 = edges.find((e) => e.id === "e2");
    expect(e1.markerEnd).toBeUndefined();
    expect(e1.markerStart).toBeUndefined();
    expect(e2.markerEnd || e2.markerStart).toBeTruthy();
  });

  it("with nothing selected: no dimming and no edge labels", () => {
    const { nodes, edges } = toFlowElements(graph, layout, null);

    expect(nodes.every((n) => !n.className.includes("is-dimmed"))).toBe(true);
    expect(edges.every((e) => e.label === undefined && !e.className.includes("is-dimmed"))).toBe(true);
  });

  it("with a selection: marks it, highlights and labels its edges, dims the rest", () => {
    const { nodes, edges } = toFlowElements(graph, layout, "b");
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

    expect(byId.b.selected).toBe(true);
    expect(byId.b.className).toContain("is-related");
    expect(byId.a.className).toContain("is-related"); // neighbour
    expect(byId.c.className).toContain("is-dimmed");
    expect(byId.d.className).toContain("is-dimmed");

    const e1 = edges.find((e) => e.id === "e1");
    const e2 = edges.find((e) => e.id === "e2");
    expect(e1.label).toBe("is part of");
    expect(e1.className).toContain("is-active");
    expect(e1.markerEnd || e1.markerStart).toBeTruthy(); // direction shown for the selection
    expect(e2.label).toBeUndefined();
    expect(e2.className).toContain("is-dimmed");
  });

  it("copes with an empty or missing graph", () => {
    expect(toFlowElements(null, null, null)).toEqual({ nodes: [], edges: [] });
  });
});

describe("branchColor", () => {
  it("is the root colour for the centre (-1)", () => {
    expect(branchColor(-1)).toBe(ROOT_COLOR);
  });

  it("gives neighbouring branches different pastel colours and wraps round", () => {
    expect(branchColor(0)).not.toBe(branchColor(1));
    expect(branchColor(BRANCH_COLORS.length)).toBe(branchColor(0));
    expect(BRANCH_COLORS.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });
});

describe("edgeCurve", () => {
  const box = (x, y, width = 100, height = 40) => ({ x, y, width, height });
  const centre = box(-80, -20, 160, 40);

  const numbers = (path) => path.match(/-?\d+(\.\d+)?/g).map(Number);

  it("draws a cubic S-curve for a branch connector, from border to border", () => {
    const child = box(300, -20);
    const { path } = edgeCurve(centre, child, { tree: true, origin: centre });

    expect(path.startsWith("M ")).toBe(true);
    expect(path).toContain(" C ");
    const [sx, sy, , , , , tx, ty] = numbers(path);
    expect(sx).toBeCloseTo(82, 0); // right border of the centre box (+2 gap)
    expect(sy).toBeCloseTo(0, 0);
    expect(tx).toBeCloseTo(298, 0); // left border of the child
    expect(ty).toBeCloseTo(0, 0);
  });

  it("curves: the control points are not on the straight line for an off-axis child", () => {
    const parent = box(300, -20);
    const child = box(500, 200);
    const { path } = edgeCurve(parent, child, { tree: true, origin: centre });
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = numbers(path);

    const cross = (px, py) =>
      Math.abs((tx - sx) * (sy - py) - (sx - px) * (ty - sy)) / Math.hypot(tx - sx, ty - sy);
    expect(cross(c1x, c1y) + cross(c2x, c2y)).toBeGreaterThan(5);
  });

  it("draws a cross-link as a quadratic arc and gives a label point", () => {
    const { path, labelX, labelY } = edgeCurve(box(0, 0), box(300, 200));

    expect(path).toContain(" Q ");
    expect(Number.isFinite(labelX)).toBe(true);
    expect(Number.isFinite(labelY)).toBe(true);
  });

  it("never produces NaN for boxes at the same spot", () => {
    for (const opts of [{}, { tree: true, origin: null }, { tree: true, origin: centre }]) {
      const { path } = edgeCurve(box(0, 0), box(0, 0), opts);
      expect(path).not.toContain("NaN");
    }
  });
});

describe("edgeEndpoints", () => {
  const box = (x, y, width = 100, height = 40) => ({ x, y, width, height });

  it("starts and ends on the box borders, on the line between the centres", () => {
    const { source, target } = edgeEndpoints(box(0, 0), box(300, 0), 0);

    expect(source).toEqual({ x: 100, y: 20 });   // right edge of the first box
    expect(target).toEqual({ x: 300, y: 20 });   // left edge of the second
  });

  it("works vertically and diagonally", () => {
    const vertical = edgeEndpoints(box(0, 0), box(0, 200), 0);
    expect(vertical.source).toEqual({ x: 50, y: 40 });
    expect(vertical.target).toEqual({ x: 50, y: 200 });

    const diagonal = edgeEndpoints(box(0, 0), box(400, 400), 0);
    // 100x40 boxes with a 45-degree line: it leaves through the bottom edge.
    expect(diagonal.source.y).toBeCloseTo(40, 5);
    expect(diagonal.source.x).toBeGreaterThan(50);
    expect(diagonal.target.y).toBeLessThan(400 + 20);
  });

  it("leaves a gap around the box so the arrowhead stays clear", () => {
    const tight = edgeEndpoints(box(0, 0), box(300, 0), 0);
    const gapped = edgeEndpoints(box(0, 0), box(300, 0), 4);

    expect(gapped.target.x).toBe(tight.target.x - 4);
    expect(gapped.source.x).toBe(tight.source.x + 4);
  });

  it("does not blow up when the boxes share a centre", () => {
    const { source, target } = edgeEndpoints(box(0, 0), box(0, 0));

    expect(source).toEqual({ x: 50, y: 20 });
    expect(target).toEqual({ x: 50, y: 20 });
  });

  it("is symmetric: swapping the boxes swaps the endpoints", () => {
    const ab = edgeEndpoints(box(0, 0), box(250, 120));
    const ba = edgeEndpoints(box(250, 120), box(0, 0));

    expect(ab.source).toEqual(ba.target);
    expect(ab.target).toEqual(ba.source);
  });
});
