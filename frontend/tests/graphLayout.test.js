import { describe, it, expect } from "vitest";
import { computeLayout, ROOT_HEIGHT } from "../src/utils/graphLayout";

const node = (id, label = id, type = "concept") => ({ id, label, type });
let counter = 0;
const edge = (source, target, relationship = "PART_OF") => ({
  id: `e${counter++}:${source}>${target}`,
  source,
  target,
  relationship,
});

/** A generic topic -> subtopics -> concepts -> examples tree. */
function tree({ subtopics = 4, concepts = 3, examples = 0 } = {}) {
  const nodes = [node("root", "Central topic", "main_topic")];
  const edges = [];

  for (let s = 0; s < subtopics; s += 1) {
    const sid = `s${s}`;
    nodes.push(node(sid, `Subtopic ${s}`, "subtopic"));
    edges.push(edge(sid, "root"));

    for (let c = 0; c < concepts; c += 1) {
      const cid = `c${s}_${c}`;
      nodes.push(node(cid, `Concept ${s}.${c}`));
      edges.push(edge(cid, sid));

      for (let x = 0; x < examples; x += 1) {
        const xid = `x${s}_${c}_${x}`;
        nodes.push(node(xid, `Example ${s}.${c}.${x}`, "example"));
        edges.push(edge(xid, cid, "EXAMPLE_OF"));
      }
    }
  }

  return { nodes, edges };
}

const rectOf = (layout, id) => {
  const p = layout.positions.get(id);
  const { width, height } = layout.info.get(id);
  return { x: p.x, y: p.y, width, height, cx: p.x + width / 2, cy: p.y + height / 2 };
};

const overlaps = (a, b) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function overlappingPairs(graph, layout) {
  const ids = graph.nodes.map((n) => n.id);
  const bad = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      if (overlaps(rectOf(layout, ids[i]), rectOf(layout, ids[j]))) bad.push([ids[i], ids[j]]);
    }
  }
  return bad;
}

const angleOf = (r) => Math.atan2(r.cy, r.cx);
const angleBetween = (a, b) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
};

describe("computeLayout: basics", () => {
  it("returns empty maps for no nodes or bad input", () => {
    for (const input of [[], null, undefined]) {
      const layout = computeLayout(input, []);
      expect(layout.positions.size).toBe(0);
      expect(layout.info.size).toBe(0);
    }
  });

  it("puts a single node at the centre, as the root", () => {
    const layout = computeLayout([node("a", "Only topic")], []);
    const r = rectOf(layout, "a");

    expect(layout.info.get("a")).toMatchObject({ root: true, depth: 0, branch: -1, parentId: null });
    expect(r.cx).toBeCloseTo(0, 0);
    expect(r.cy).toBeCloseTo(0, 0);
  });

  it("every node gets a finite position and a size", () => {
    const graph = tree({ examples: 2 });
    const layout = computeLayout(graph.nodes, graph.edges);

    expect(layout.positions.size).toBe(graph.nodes.length);
    for (const n of graph.nodes) {
      const p = layout.positions.get(n.id);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(layout.info.get(n.id).width).toBeGreaterThan(0);
      expect(layout.info.get(n.id).height).toBeGreaterThan(0);
    }
  });

  it("ignores edges to missing nodes and edges from a node to itself", () => {
    const layout = computeLayout(
      [node("a"), node("b")],
      [edge("a", "ghost"), edge("a", "a"), edge("b", "a")]
    );

    expect(layout.positions.size).toBe(2);
    expect(layout.info.get("b").parentId).toBe("a");
  });
});

describe("computeLayout: radial structure", () => {
  const graph = tree({ subtopics: 5, concepts: 3, examples: 1 });
  const layout = computeLayout(graph.nodes, graph.edges);

  it("centres the main topic", () => {
    expect(layout.info.get("root")).toMatchObject({ root: true, depth: 0, parentId: null });
    const r = rectOf(layout, "root");
    expect(r.cx).toBeCloseTo(0, 0);
    expect(r.cy).toBeCloseTo(0, 0);
  });

  it("makes the centre the most prominent box and shrinks the rest with depth", () => {
    const root = layout.info.get("root");
    const sub = layout.info.get("s0");
    const concept = layout.info.get("c0_0");

    expect(root.height).toBe(ROOT_HEIGHT);
    expect(root.height).toBeGreaterThan(sub.height);
    expect(sub.height).toBeGreaterThan(concept.height);
    expect(root.width).toBeGreaterThan(sub.width);
  });

  it("uses the real relationships for parents: depth follows PART_OF / EXAMPLE_OF", () => {
    for (let s = 0; s < 5; s += 1) {
      expect(layout.info.get(`s${s}`)).toMatchObject({ depth: 1, parentId: "root" });
      for (let c = 0; c < 3; c += 1) {
        expect(layout.info.get(`c${s}_${c}`)).toMatchObject({ depth: 2, parentId: `s${s}` });
        expect(layout.info.get(`x${s}_${c}_0`)).toMatchObject({ depth: 3, parentId: `c${s}_${c}` });
      }
    }
  });

  it("spreads the subtopics around the centre in different directions", () => {
    const angles = [0, 1, 2, 3, 4].map((s) => angleOf(rectOf(layout, `s${s}`)));

    // 5 branches share the full circle: neighbours are well apart.
    const sorted = [...angles].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i += 1) {
      const next = sorted[(i + 1) % sorted.length];
      const gap = (next - sorted[i] + 2 * Math.PI) % (2 * Math.PI);
      expect(gap).toBeGreaterThan(0.6);
    }
  });

  it("places each concept on the same side as its own subtopic", () => {
    for (let s = 0; s < 5; s += 1) {
      const parentAngle = angleOf(rectOf(layout, `s${s}`));
      for (let c = 0; c < 3; c += 1) {
        const child = rectOf(layout, `c${s}_${c}`);
        expect(angleBetween(angleOf(child), parentAngle)).toBeLessThan(Math.PI / 2);
      }
    }
  });

  it("puts deeper levels further from the centre", () => {
    const dist = (id) => Math.hypot(rectOf(layout, id).cx, rectOf(layout, id).cy);

    for (let s = 0; s < 5; s += 1) {
      expect(dist(`s${s}`)).toBeGreaterThan(0);
      expect(dist(`c${s}_0`)).toBeGreaterThan(dist(`s${s}`));
      expect(dist(`x${s}_0_0`)).toBeGreaterThan(dist(`c${s}_0`));
    }
  });

  it("gives each first-level branch its own colour index, inherited by its descendants", () => {
    const branches = [0, 1, 2, 3, 4].map((s) => layout.info.get(`s${s}`).branch);

    expect(new Set(branches).size).toBe(5);
    expect(layout.info.get("root").branch).toBe(-1);

    for (let s = 0; s < 5; s += 1) {
      const b = layout.info.get(`s${s}`).branch;
      expect(layout.info.get(`c${s}_1`).branch).toBe(b);
      expect(layout.info.get(`x${s}_1_0`).branch).toBe(b);
    }
  });

  it("records which relationship placed each node (for the branch connectors)", () => {
    const sub = layout.info.get("s2");
    expect(sub.parentEdgeId).toMatch(/^e\d+:s2>root$/);
    expect(layout.info.get("root").parentEdgeId).toBeNull();
  });
});

describe("computeLayout: cross-links", () => {
  it("keeps a relationship between two branches without moving anything", () => {
    const base = tree({ subtopics: 3, concepts: 2 });
    const without = computeLayout(base.nodes, base.edges);
    const withCross = computeLayout(base.nodes, [...base.edges, edge("c0_0", "c2_1", "RELATED_TO")]);

    for (const n of base.nodes) {
      expect(withCross.positions.get(n.id)).toEqual(without.positions.get(n.id));
      expect(withCross.info.get(n.id).parentId).toBe(without.info.get(n.id).parentId);
    }
  });

  it("keeps a concept under the subtopic it is PART OF, even if it also relates to another subtopic", () => {
    const nodes = [
      node("root", "Centre", "main_topic"),
      node("A", "Subtopic A", "subtopic"),
      node("B", "Subtopic B", "subtopic"),
      node("x", "Concept X"),
    ];
    const edges = [
      edge("A", "root"),
      edge("B", "root"),
      edge("x", "B"), // x is part of B
      edge("x", "A", "RELATED_TO"), // ...and merely related to A
    ];
    const layout = computeLayout(nodes, edges);

    expect(layout.info.get("x")).toMatchObject({ parentId: "B", depth: 2 });
    expect(layout.info.get("x").branch).toBe(layout.info.get("B").branch);
  });

  it("does not turn a sideways link into a parent link", () => {
    const base = tree({ subtopics: 2, concepts: 2 });
    const cross = edge("c0_0", "c1_0", "LEADS_TO");
    const layout = computeLayout(base.nodes, [...base.edges, cross]);

    expect(layout.info.get("c1_0").parentEdgeId).not.toBe(cross.id);
    expect(layout.info.get("c0_0").parentEdgeId).not.toBe(cross.id);
  });
});

describe("computeLayout: choosing the centre", () => {
  it("prefers a main topic, and then the best connected one", () => {
    const nodes = [
      node("hub", "Hub concept"), // many links, but not a main topic
      node("m1", "Main one", "main_topic"),
      node("a"), node("b"), node("c"),
    ];
    const edges = [
      edge("a", "hub"), edge("b", "hub"), edge("c", "hub"),
      edge("m1", "hub", "RELATED_TO"),
    ];

    expect(computeLayout(nodes, edges).info.get("m1").root).toBe(true);
  });

  it("works with no main topic at all: the best connected node becomes the centre", () => {
    const nodes = [node("hub", "Hub"), node("a"), node("b"), node("c")];
    const edges = [edge("a", "hub"), edge("b", "hub"), edge("c", "hub")];
    const layout = computeLayout(nodes, edges);

    expect(layout.info.get("hub")).toMatchObject({ root: true, depth: 0 });
    expect(layout.info.get("a").depth).toBe(1);
  });

  it("two connected main topics: one is the centre, the other a branch", () => {
    const nodes = [node("m1", "First", "main_topic"), node("m2", "Second", "main_topic"), node("x"), node("y")];
    const edges = [edge("x", "m1"), edge("y", "m1"), edge("m2", "m1", "RELATED_TO")];
    const layout = computeLayout(nodes, edges);

    expect(layout.info.get("m1").root).toBe(true);
    expect(layout.info.get("m2")).toMatchObject({ root: false, depth: 1 });
  });

  it("two unconnected main topics each get their own centre, side by side", () => {
    const nodes = [
      node("m1", "Topic one", "main_topic"), node("a1"), node("a2"),
      node("m2", "Topic two", "main_topic"), node("b1"), node("b2"),
    ];
    const edges = [edge("a1", "m1"), edge("a2", "m1"), edge("b1", "m2"), edge("b2", "m2")];
    const layout = computeLayout(nodes, edges);

    expect(layout.info.get("m1").root).toBe(true);
    expect(layout.info.get("m2").root).toBe(true);
    expect(layout.info.get("a1").rootId).toBe("m1");
    expect(layout.info.get("b1").rootId).toBe("m2");
    expect(overlappingPairs({ nodes }, layout)).toEqual([]);

    // The two mind maps do not intrude on each other's area.
    const box = (ids) => {
      const rs = ids.map((id) => rectOf(layout, id));
      return {
        x1: Math.min(...rs.map((r) => r.x)), x2: Math.max(...rs.map((r) => r.x + r.width)),
        y1: Math.min(...rs.map((r) => r.y)), y2: Math.max(...rs.map((r) => r.y + r.height)),
      };
    };
    const A = box(["m1", "a1", "a2"]);
    const B = box(["m2", "b1", "b2"]);
    expect(A.x2 <= B.x1 || B.x2 <= A.x1 || A.y2 <= B.y1 || B.y2 <= A.y1).toBe(true);
  });
});

describe("computeLayout: awkward graphs", () => {
  it("handles unconnected nodes: each is placed, nothing overlaps", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d"), node("e")];
    const layout = computeLayout(nodes, []);

    expect(layout.positions.size).toBe(5);
    expect(nodes.every((n) => layout.info.get(n.id).root)).toBe(true);
    expect(overlappingPairs({ nodes }, layout)).toEqual([]);
  });

  it("handles cycles: terminates and gives every node exactly one parent chain to the centre", () => {
    const nodes = [node("a", "A", "main_topic"), node("b"), node("c"), node("d")];
    const edges = [
      edge("b", "a"), edge("c", "b", "RELATED_TO"), edge("a", "c", "LEADS_TO"), // a <- b <- c -> a
      edge("d", "c", "PART_OF"), edge("c", "d", "RELATED_TO"),
    ];
    const layout = computeLayout(nodes, edges);

    for (const n of nodes) {
      let id = n.id;
      let hops = 0;
      while (layout.info.get(id).parentId !== null) {
        id = layout.info.get(id).parentId;
        hops += 1;
        expect(hops).toBeLessThan(nodes.length);
      }
      expect(layout.info.get(id).root).toBe(true);
    }
  });

  it("handles mutual links and duplicate edges", () => {
    const layout = computeLayout(
      [node("a", "A", "main_topic"), node("b")],
      [edge("b", "a"), edge("a", "b", "RELATED_TO"), edge("b", "a")]
    );

    expect(layout.info.get("b")).toMatchObject({ parentId: "a", depth: 1 });
  });

  it("copes with very long and empty labels", () => {
    const nodes = [node("a", "x".repeat(300), "main_topic"), node("b", ""), node("c", "y".repeat(200))];
    const layout = computeLayout(nodes, [edge("b", "a"), edge("c", "a")]);

    for (const n of nodes) expect(Number.isFinite(layout.positions.get(n.id).x)).toBe(true);
    expect(overlappingPairs({ nodes }, layout)).toEqual([]);
  });
});

describe("computeLayout: determinism", () => {
  it("gives the same layout for the same graph, whatever the order of nodes and edges", () => {
    const graph = tree({ subtopics: 6, concepts: 4, examples: 1 });
    const a = computeLayout(graph.nodes, graph.edges);
    const b = computeLayout([...graph.nodes].reverse(), [...graph.edges].reverse());
    const c = computeLayout(
      [...graph.nodes].sort((x, y) => (x.label < y.label ? 1 : -1)),
      [...graph.edges].sort((x, y) => (x.id < y.id ? 1 : -1))
    );

    for (const n of graph.nodes) {
      expect(b.positions.get(n.id)).toEqual(a.positions.get(n.id));
      expect(c.positions.get(n.id)).toEqual(a.positions.get(n.id));
      expect(b.info.get(n.id)).toEqual(a.info.get(n.id));
    }
  });

  it("is repeatable", () => {
    const graph = tree({ subtopics: 4, concepts: 3 });
    const a = computeLayout(graph.nodes, graph.edges);
    const b = computeLayout(graph.nodes, graph.edges);

    expect([...b.positions]).toEqual([...a.positions]);
  });
});

describe("computeLayout: size and shape", () => {
  it("small graph (3 nodes): compact, no overlap", () => {
    const nodes = [node("a", "Topic", "main_topic"), node("b"), node("c")];
    const graph = { nodes };
    const layout = computeLayout(nodes, [edge("b", "a"), edge("c", "a")]);

    expect(overlappingPairs(graph, layout)).toEqual([]);
    const r = [...nodes].map((n) => rectOf(layout, n.id));
    const width = Math.max(...r.map((q) => q.x + q.width)) - Math.min(...r.map((q) => q.x));
    expect(width).toBeLessThan(800);
  });

  it("medium graph (~35 nodes): no overlapping nodes", () => {
    const graph = tree({ subtopics: 6, concepts: 4, examples: 0 });
    const layout = computeLayout(graph.nodes, graph.edges);

    expect(graph.nodes.length).toBeGreaterThan(25);
    expect(overlappingPairs(graph, layout)).toEqual([]);
  });

  it("medium graph: roughly round, not a stretched horizontal strip", () => {
    const graph = tree({ subtopics: 6, concepts: 4, examples: 1 });
    const layout = computeLayout(graph.nodes, graph.edges);
    const rs = graph.nodes.map((n) => rectOf(layout, n.id));
    const w = Math.max(...rs.map((r) => r.x + r.width)) - Math.min(...rs.map((r) => r.x));
    const h = Math.max(...rs.map((r) => r.y + r.height)) - Math.min(...rs.map((r) => r.y));

    expect(w / h).toBeGreaterThan(0.6);
    expect(w / h).toBeLessThan(1.7);
  });

  it("surrounds the centre: nodes lie on every side of it", () => {
    const graph = tree({ subtopics: 6, concepts: 3 });
    const layout = computeLayout(graph.nodes, graph.edges);
    const rs = graph.nodes.filter((n) => n.id !== "root").map((n) => rectOf(layout, n.id));

    expect(rs.some((r) => r.cx > 100)).toBe(true);
    expect(rs.some((r) => r.cx < -100)).toBe(true);
    expect(rs.some((r) => r.cy > 100)).toBe(true);
    expect(rs.some((r) => r.cy < -100)).toBe(true);
  });

  it("lopsided graph (one huge branch, several tiny ones) still has no overlaps", () => {
    const nodes = [node("root", "Centre", "main_topic"), node("big", "Big branch", "subtopic")];
    const edges = [edge("big", "root")];
    for (let i = 0; i < 25; i += 1) {
      nodes.push(node(`k${i}`, `Leaf concept ${i}`));
      edges.push(edge(`k${i}`, "big"));
    }
    for (let i = 0; i < 4; i += 1) {
      nodes.push(node(`t${i}`, `Tiny ${i}`, "subtopic"));
      edges.push(edge(`t${i}`, "root"));
    }
    const layout = computeLayout(nodes, edges);

    expect(overlappingPairs({ nodes }, layout)).toEqual([]);
  });

  it("large graph (~600 nodes): every node placed, in a reasonable time", () => {
    const graph = tree({ subtopics: 12, concepts: 12, examples: 3 });
    expect(graph.nodes.length).toBeGreaterThan(550);

    const started = performance.now();
    const layout = computeLayout(graph.nodes, graph.edges);
    const took = performance.now() - started;

    expect(layout.positions.size).toBe(graph.nodes.length);
    expect(took).toBeLessThan(3000);
    for (const n of graph.nodes) {
      const p = layout.positions.get(n.id);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });

  it("large graph: still no overlapping nodes", () => {
    const graph = tree({ subtopics: 8, concepts: 8, examples: 2 });
    const layout = computeLayout(graph.nodes, graph.edges);

    expect(overlappingPairs(graph, layout)).toEqual([]);
  });
});
