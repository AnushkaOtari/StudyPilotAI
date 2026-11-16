// Pure helpers for the Mind Map. No React, no network, so they are
// cheap to test and safe to import from the main bundle.

// The two views of the chat page, and the ids that tie each tab to its panel.
export const VIEW_CHAT = "chat";
export const VIEW_MINDMAP = "mindmap";
export const viewTabId = (view) => `view-tab-${view}`;
export const viewPanelId = (view) => `view-panel-${view}`;

export const GRAPH_IN_PROGRESS = ["PENDING", "PROCESSING"];
const INDEXING_IN_PROGRESS = ["WAITING", "PROCESSING"];

export const NODE_TYPE_LABELS = {
  main_topic: "Main topic",
  subtopic: "Subtopic",
  concept: "Concept",
  example: "Example",
};

export function nodeTypeLabel(type) {
  return NODE_TYPE_LABELS[type] || NODE_TYPE_LABELS.concept;
}

/** Plain-English wording for a backend relationship type. */
export const RELATIONSHIP_LABELS = {
  IS_A: "is a",
  PART_OF: "is part of",
  RELATED_TO: "is related to",
  CAUSES: "causes",
  DEPENDS_ON: "depends on",
  EXAMPLE_OF: "is an example of",
  LEADS_TO: "leads to",
};

export function relationshipText(edge) {
  return (
    edge?.label ||
    RELATIONSHIP_LABELS[edge?.relationship] ||
    "is related to"
  );
}

// ---------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------

/** True while the document queue is still indexing a PDF. */
export function isIndexing(jobs) {
  return (
    Array.isArray(jobs) &&
    jobs.some((job) => INDEXING_IN_PROGRESS.includes(job?.status))
  );
}

/**
 * A short string that changes whenever a PDF's graph status, size or the set
 * of PDFs changes. Polling compares it to decide whether to re-download the
 * full graph.
 */
export function statusSignature(documents) {
  if (!Array.isArray(documents)) return "";

  return documents
    .map((d) =>
      [
        d.filename,
        d.status,
        d.node_count ?? 0,
        d.edge_count ?? 0,
        d.updated_at ?? "",
      ].join(":")
    )
    .sort()
    .join("|");
}

/** Short, friendly wording for one PDF's progress. */
export function documentStatusText(doc, indexing = false) {
  switch (doc?.status) {
    case "COMPLETED":
      return "Done";
    case "FAILED":
      return "Failed";
    case "PROCESSING":
      return "Building mind map";
    case "PENDING":
      return "Waiting to build";
    default:
      return indexing ? "Reading PDF" : "Not generated yet";
  }
}

/** Is more work expected? Drives polling. */
export function isBusy(documents, indexing) {
  const docs = Array.isArray(documents) ? documents : [];

  return (
    !!indexing || docs.some((d) => GRAPH_IN_PROGRESS.includes(d.status))
  );
}

/**
 * Decide what the panel shows.
 *
 *   loading     first request still running
 *   error       the request failed and there is nothing to show
 *   empty       no PDFs in this chat yet (also: a brand-new chat, HTTP 404)
 *   not_started PDFs exist but no graph was ever generated for them
 *   processing  no graph yet, but indexing or generation is running
 *   failed      no graph and every attempt failed
 *   partial     a graph, but some PDFs failed
 *   ready       a graph
 *
 * `busy` is also true next to ready/partial (a new PDF is being added); the
 * panel then shows the graph plus a small "updating" notice.
 */
export function deriveView({ data, error, indexing }) {
  if (!data) {
    if (error) {
      if (error.code === "not_found") {
        return base("empty");
      }
      return { ...base("error"), error };
    }
    return base("loading");
  }

  const documents = data.documents || [];
  const nodes = data.nodes || [];
  const failedDocs = documents.filter((d) => d.status === "FAILED");
  const notStartedDocs = documents.filter(
    (d) => d.status === "NOT_STARTED"
  );
  const busy = isBusy(documents, indexing);

  const view = { failedDocs, notStartedDocs, busy, error: null };

  if (nodes.length > 0) {
    return { ...view, kind: failedDocs.length > 0 ? "partial" : "ready" };
  }

  if (documents.length === 0) return { ...view, kind: "empty" };
  if (busy) return { ...view, kind: "processing" };
  if (failedDocs.length > 0) return { ...view, kind: "failed" };

  return { ...view, kind: "not_started" };
}

function base(kind) {
  return {
    kind,
    failedDocs: [],
    notStartedDocs: [],
    busy: false,
    error: null,
  };
}

// ---------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------

/**
 * "4", "4–6, 9": collapse a sorted list of page numbers into ranges.
 */
export function compressPages(pages) {
  const sorted = [
    ...new Set(
      (Array.isArray(pages) ? pages : []).filter(
        (p) => Number.isInteger(p) && p >= 1
      )
    ),
  ].sort((a, b) => a - b);

  const parts = [];

  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;

    parts.push(
      j === i ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`
    );
    i = j + 1;
  }

  return parts.join(", ");
}

/**
 * Concepts directly connected to `nodeId`, with the direction of the edge:
 *   out = nodeId -> other,  in = other -> nodeId.
 */
export function getNeighbors(graph, nodeId) {
  if (!graph || !nodeId) return [];

  const byId = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const result = [];

  for (const edge of graph.edges || []) {
    if (edge.source === nodeId && byId.has(edge.target)) {
      result.push({
        direction: "out",
        edge,
        node: byId.get(edge.target),
      });
    } else if (edge.target === nodeId && byId.has(edge.source)) {
      result.push({
        direction: "in",
        edge,
        node: byId.get(edge.source),
      });
    }
  }

  return result.sort((a, b) =>
    a.node.label.localeCompare(b.node.label)
  );
}

/** Distinct PDF names that appear in the graph. */
export function documentsInGraph(graph) {
  const names = new Set();

  for (const node of graph?.nodes || []) {
    for (const source of node.sources || []) {
      if (source.document) names.add(source.document);
    }
  }

  return [...names].sort();
}

// Rough node box, shared by the layout (collision) and the node component.
const MIN_WIDTH = 96;
const MAX_WIDTH = 220;

export function nodeWidth(label) {
  const text = String(label || "");
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, text.length * 7.5 + 36));
}

export const NODE_HEIGHT = 44;

/** Pastel colour per first-level branch; descendants inherit it. */
export const BRANCH_COLORS = [
  "#F9C9A8", // peach
  "#BFE3D0", // mint
  "#BCD9F0", // sky
  "#F5C2D0", // pink
  "#E3D7F5", // lilac
  "#F6E3A0", // butter
  "#B4DDE0", // teal
  "#D3E4B5", // sage
];
export const ROOT_COLOR = "#C9B6EE";
const CROSS_LINK_COLOR = "#9C9585";

export const branchColor = (branch) =>
  branch >= 0
    ? BRANCH_COLORS[branch % BRANCH_COLORS.length]
    : ROOT_COLOR;

/** A darker shade of a branch colour, for connector lines. */
const EDGE_COLORS = BRANCH_COLORS.map((c) => shade(c, 0.62));

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const part = (shift) =>
    Math.round(((n >> shift) & 255) * factor)
      .toString(16)
      .padStart(2, "0");
  return `#${part(16)}${part(8)}${part(0)}`;
}

const TREE_STROKE = [4, 3, 2, 1.6];

/**
 * Backend graph -> React Flow elements.
 *
 * layout: { positions: Map<id, {x, y}>, info: Map<id, ...> } from computeLayout.
 * Relationships that became a parent link in the layout are drawn as branch
 * connectors; every other relationship is a faint dashed cross-link.
 * When a node is selected, its own connections are highlighted and labelled
 * (with an arrow in the direction of the relationship) and everything else is
 * dimmed. With nothing selected, edge labels are hidden.
 */
export function toFlowElements(graph, layout, selectedId) {
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  const positions = layout?.positions || new Map();
  const info = layout?.info || new Map();

  const connected = new Set();
  if (selectedId) {
    connected.add(selectedId);
    for (const e of edges) {
      if (e.source === selectedId) connected.add(e.target);
      if (e.target === selectedId) connected.add(e.source);
    }
  }

  const flowNodes = nodes.map((n) => {
    const meta = info.get(n.id);
    const classes = [`type-${n.type || "concept"}`];

    if (selectedId) {
      classes.push(connected.has(n.id) ? "is-related" : "is-dimmed");
    }

    return {
      id: n.id,
      type: "concept",
      position: positions.get(n.id) || { x: 0, y: 0 },
      // Known from the layout. Without them the minimap (which reads the
      // nodes we pass in, not React Flow's measurements) draws nothing.
      width: meta?.width ?? nodeWidth(n.label),
      height: meta?.height ?? NODE_HEIGHT,
      selected: n.id === selectedId,
      ariaLabel: `${n.label}, ${nodeTypeLabel(n.type).toLowerCase()}`,
      className: classes.join(" "),
      data: {
        label: n.label,
        kind: n.type || "concept",
        width: meta?.width ?? nodeWidth(n.label),
        height: meta?.height ?? NODE_HEIGHT,
        depth: meta?.depth ?? 1,
        root: !!meta?.root,
        color: branchColor(meta ? meta.branch : 0),
      },
    };
  });

  const flowEdges = edges.map((e) => {
    const active =
      !!selectedId && (e.source === selectedId || e.target === selectedId);

    // The end of this edge that is the child in the layout, if it is a
    // parent link.
    const childId = [e.source, e.target].find(
      (id) => info.get(id)?.parentEdgeId === e.id
    );
    const child = childId === undefined ? null : info.get(childId);

    const stroke = active
      ? "var(--text-main)"
      : child
        ? EDGE_COLORS[child.branch % EDGE_COLORS.length]
        : CROSS_LINK_COLOR;

    const arrow = {
      type: "arrowclosed",
      width: 12,
      height: 12,
      color: active ? "var(--text-main)" : CROSS_LINK_COLOR,
    };

    // The curve is always drawn parent -> child; the arrow follows the
    // direction of the relationship itself.
    const showArrow = active || !child;
    const pointsAtChild = !child || e.target === childId;

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "floating",
      focusable: false,
      label: active ? relationshipText(e) : undefined,
      className: [
        child ? "is-tree" : "is-cross",
        active ? "is-active" : selectedId ? "is-dimmed" : "",
      ]
        .filter(Boolean)
        .join(" "),
      markerEnd: showArrow && pointsAtChild ? arrow : undefined,
      markerStart: showArrow && !pointsAtChild ? arrow : undefined,
      data: {
        relationship: e.relationship,
        tree: !!child,
        parentId: child ? child.parentId : null,
        originId: child ? child.rootId : null,
        stroke,
        strokeWidth: active
          ? 2.5
          : child
            ? TREE_STROKE[Math.min(child.depth, TREE_STROKE.length) - 1]
            : 1.4,
      },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

/** Changes only when the set of nodes/edges changes (not on a re-poll). */
export function graphSignature(graph) {
  const nodes = (graph?.nodes || []).map((n) => n.id).sort();
  const edges = (graph?.edges || []).map((e) => e.id).sort();

  return `${nodes.join(",")}#${edges.join(",")}`;
}

/**
 * Where an edge between two node boxes should start and end: on each box's
 * border, on the line between the two centres (so arrowheads are not hidden
 * under the target node).
 * Rects are {x, y, width, height}; `gap` keeps a little air around the box.
 */
export function edgeEndpoints(from, to, gap = 2) {
  const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

  const onBorder = (rect, towards) => {
    const c = centre(rect);
    const dx = towards.x - c.x;
    const dy = towards.y - c.y;

    if (dx === 0 && dy === 0) return c;

    const halfW = rect.width / 2 + gap;
    const halfH = rect.height / 2 + gap;
    const t = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);

    return { x: c.x + dx * t, y: c.y + dy * t };
  };

  return {
    source: onBorder(from, centre(to)),
    target: onBorder(to, centre(from)),
  };
}

/**
 * SVG path for an edge between two node boxes (from -> to).
 *
 * tree: a cubic S-curve that leaves `from` and arrives at `to` along the
 *   radial direction (away from `origin`, the centre of the mind map).
 * otherwise: a quadratic arc bowed to one side.
 * Returns the path plus the point halfway along it (for a label).
 */
export function edgeCurve(from, to, { tree = false, origin = null } = {}) {
  const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const unit = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
  };

  const { source: s, target: t } = edgeEndpoints(from, to);
  const dist = Math.hypot(t.x - s.x, t.y - s.y);

  if (tree) {
    const fromC = centre(from);
    const toC = centre(to);
    const o = origin ? centre(origin) : null;

    // Leaving the centre node: head straight for the child.
    const out =
      !o || (fromC.x === o.x && fromC.y === o.y)
        ? unit(toC.x - fromC.x, toC.y - fromC.y)
        : unit(fromC.x - o.x, fromC.y - o.y);
    const into = o
      ? unit(toC.x - o.x, toC.y - o.y)
      : unit(toC.x - fromC.x, toC.y - fromC.y);

    const k = dist * 0.42;
    const c1 = { x: s.x + out.x * k, y: s.y + out.y * k };
    const c2 = { x: t.x - into.x * k, y: t.y - into.y * k };

    return {
      path: `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${t.x} ${t.y}`,
      labelX: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
      labelY: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
    };
  }

  const bow = unit(-(t.y - s.y), t.x - s.x);
  const c = {
    x: (s.x + t.x) / 2 + bow.x * dist * 0.22,
    y: (s.y + t.y) / 2 + bow.y * dist * 0.22,
  };

  return {
    path: `M ${s.x} ${s.y} Q ${c.x} ${c.y}, ${t.x} ${t.y}`,
    labelX: (s.x + 2 * c.x + t.x) / 4,
    labelY: (s.y + 2 * c.y + t.y) / 4,
  };
}
