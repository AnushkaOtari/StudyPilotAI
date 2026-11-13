import { describe, it, expect } from "vitest";
import { computeLayout } from "../src/utils/graphLayout";
import { nodeWidth, NODE_HEIGHT } from "../src/utils/knowledgeGraph";

const n = (id, label = id, type = "concept") => ({ id, label, type });
const e = (source, target) => ({ id: `${source}-${target}`, source, target });

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + NODE_HEIGHT && b.y < a.y + NODE_HEIGHT;

describe("computeLayout", () => {
  it("returns an empty map for no nodes", () => {
    expect(computeLayout([], []).size).toBe(0);
    expect(computeLayout(undefined, undefined).size).toBe(0);
  });

  it("puts a single node at the origin (centred)", () => {
    const pos = computeLayout([n("a", "Cell")], []);

    expect(pos.size).toBe(1);
    expect(pos.get("a")).toEqual({ x: -nodeWidth("Cell") / 2, y: -NODE_HEIGHT / 2 });
  });

  it("is deterministic: same graph, same positions, whatever the input order", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => n(id));
    const edges = [e("a", "b"), e("a", "c"), e("c", "d"), e("d", "e")];

    const first = computeLayout(nodes, edges);
    const second = computeLayout(nodes, edges);
    const shuffled = computeLayout([...nodes].reverse(), [...edges].reverse());

    expect([...second]).toEqual([...first]);
    expect(Object.fromEntries(shuffled)).toEqual(Object.fromEntries(first));
  });

  it("gives every node finite coordinates, including unconnected ones", () => {
    const nodes = ["a", "b", "c", "lonely1", "lonely2"].map((id) => n(id));
    const pos = computeLayout(nodes, [e("a", "b"), e("b", "c")]);

    expect(pos.size).toBe(5);
    for (const { x, y } of pos.values()) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it("keeps nodes from overlapping", () => {
    const nodes = Array.from({ length: 25 }, (_, i) => n(`n${i}`, `Concept number ${i}`));
    const edges = Array.from({ length: 24 }, (_, i) => e("n0", `n${i + 1}`)); // a hub
    const pos = computeLayout(nodes, edges);

    const boxes = nodes.map((node) => ({ ...pos.get(node.id), w: nodeWidth(node.label) }));

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(overlaps(boxes[i], boxes[j])).toBe(false);
      }
    }
  });

  it("ignores edges that point at missing nodes or at themselves", () => {
    const pos = computeLayout([n("a"), n("b")], [e("a", "ghost"), e("ghost", "b"), e("a", "a"), e("a", "b")]);

    expect(pos.size).toBe(2);
    for (const { x, y } of pos.values()) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it("groups related concepts: linked pairs are much closer than the average pair", () => {
    // three topics, each a hub with eight concepts, the hubs loosely linked
    const nodes = [];
    const edges = [];
    for (let c = 0; c < 3; c += 1) {
      nodes.push(n(`h${c}`, `Hub topic ${c}`, "main_topic"));
      for (let i = 0; i < 8; i += 1) {
        nodes.push(n(`c${c}n${i}`, `Concept ${c}-${i}`));
        edges.push(e(`h${c}`, `c${c}n${i}`));
      }
    }
    edges.push(e("h0", "h1"));

    const pos = computeLayout(nodes, edges);
    const dist = (p, q) => Math.hypot(pos.get(p).x - pos.get(q).x, pos.get(p).y - pos.get(q).y);

    const linked = edges.reduce((sum, ed) => sum + dist(ed.source, ed.target), 0) / edges.length;

    let total = 0;
    let pairs = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        total += dist(nodes[i].id, nodes[j].id);
        pairs += 1;
      }
    }

    expect(linked).toBeLessThan((total / pairs) * 0.7);
  });

  it("handles a few hundred nodes quickly enough to run in the browser", () => {
    const nodes = Array.from({ length: 400 }, (_, i) => n(`n${i}`, `Concept ${i}`));
    const edges = Array.from({ length: 399 }, (_, i) => e(`n${Math.floor(i / 3)}`, `n${i + 1}`));

    const started = Date.now();
    const pos = computeLayout(nodes, edges);

    expect(pos.size).toBe(400);
    expect(Date.now() - started).toBeLessThan(8000);
  });

  it("honours an explicit tick count", () => {
    const nodes = ["a", "b", "c"].map((id) => n(id));
    const pos = computeLayout(nodes, [e("a", "b")], { ticks: 1 });

    expect(pos.size).toBe(3);
  });
});
