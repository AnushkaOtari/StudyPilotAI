// Radial mind-map layout.
//
// Imported only by the lazily loaded MindMapCanvas. Deterministic and
// physics-free: the same graph always gives the same picture.
//
//  1. Each connected component gets a centre: the main topic with the most
//     connections (or, with none, the best-ranked / best-connected node).
//  2. A parent for every other node is found with a weighted shortest-path
//     search from the centre. Hierarchical relationships (PART_OF, IS_A,
//     EXAMPLE_OF, which point from child to parent) are cheap to follow
//     downwards, every other link is expensive, so a concept that is "part of"
//     a subtopic is placed under that subtopic. Relationships that did not
//     become a parent link are cross-links: drawn, but they never move nodes.
//  3. Each branch gets an angular wedge proportional to its leaf count and a
//     node sits in the middle of its wedge.
//  4. Each depth gets the smallest radius at which nothing overlaps.
//  5. Components are packed side by side.

import { nodeWidth } from "./knowledgeGraph";

export const ROOT_HEIGHT = 64;
export const BRANCH_HEIGHT = 44;
export const LEAF_HEIGHT = 38;

const ROOT_MIN_WIDTH = 160;
const ROOT_MAX_WIDTH = 250;
const MAX_NODE_WIDTH = 190;

// Relationships whose edge goes child -> parent.
const CHILD_TO_PARENT = new Set(["PART_OF", "IS_A", "EXAMPLE_OF"]);

const DOWN_COST = 1; // parent -> child along a hierarchical edge
const OTHER_COST = 2.5; // any other way of travelling an edge

const TYPE_RANK = { main_topic: 0, subtopic: 1, concept: 2, example: 3 };

const MAX_BRANCH_SPAN = (5 * Math.PI) / 6; // keeps deep branches from wrapping round
const START_ANGLE = -Math.PI / 2;

const FIRST_RING_GAP = 90;
const RING_GAP = 70;
const RING_STEP = 12;
const PAD = 10;
const MAX_RING_STEPS = 400;

const COMPONENT_GAP = 140;

const byId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const rank = (n) => TYPE_RANK[n.type] ?? TYPE_RANK.concept;

function boxFor(node, depth) {
  const width = nodeWidth(node.label);

  if (depth === 0) {
    return {
      width: Math.min(ROOT_MAX_WIDTH, Math.max(ROOT_MIN_WIDTH, width + 40)),
      height: ROOT_HEIGHT,
    };
  }

  return {
    width: Math.min(MAX_NODE_WIDTH, width),
    height: depth === 1 ? BRANCH_HEIGHT : LEAF_HEIGHT,
  };
}

/** Tiny binary heap of [cost, id] pairs (ties broken by id). */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  less(a, b) {
    return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  }

  push(item) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }

  pop() {
    const h = this.items;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

function buildAdjacency(nodes, edges) {
  const known = new Set(nodes.map((n) => n.id));
  const adjacency = new Map(nodes.map((n) => [n.id, []]));

  const usable = (edges || [])
    .filter(
      (e) =>
        e &&
        known.has(e.source) &&
        known.has(e.target) &&
        e.source !== e.target
    )
    .sort((a, b) => byId(String(a.id), String(b.id)));

  for (const edge of usable) {
    const hierarchical = CHILD_TO_PARENT.has(edge.relationship);

    // Walking from target to source goes "down" a child-to-parent edge.
    adjacency.get(edge.target).push({
      to: edge.source,
      edge,
      cost: hierarchical ? DOWN_COST : OTHER_COST,
    });
    adjacency.get(edge.source).push({ to: edge.target, edge, cost: OTHER_COST });
  }

  return adjacency;
}

function findComponents(sortedNodes, adjacency) {
  const seen = new Set();
  const components = [];

  for (const start of sortedNodes) {
    if (seen.has(start.id)) continue;

    const members = [];
    const stack = [start.id];
    seen.add(start.id);

    while (stack.length) {
      const id = stack.pop();
      members.push(id);
      for (const { to } of adjacency.get(id)) {
        if (!seen.has(to)) {
          seen.add(to);
          stack.push(to);
        }
      }
    }

    components.push(members);
  }

  return components;
}

function chooseRoot(memberIds, nodesById, adjacency) {
  const degree = (id) => new Set(adjacency.get(id).map((a) => a.to)).size;

  return [...memberIds].sort((a, b) => {
    const byRank = rank(nodesById.get(a)) - rank(nodesById.get(b));
    if (byRank) return byRank;
    const byDegree = degree(b) - degree(a);
    return byDegree || byId(a, b);
  })[0];
}

/** parent / parentEdge / depth for every node reachable from the root. */
function buildTree(rootId, nodesById, adjacency) {
  const cost = new Map([[rootId, 0]]);
  const parent = new Map();
  const parentEdge = new Map();
  const done = new Set();

  const heap = new MinHeap();
  heap.push([0, rootId]);

  while (heap.size) {
    const [c, id] = heap.pop();
    if (done.has(id)) continue;
    done.add(id);

    for (const { to, edge, cost: step } of adjacency.get(id)) {
      if (done.has(to)) continue;

      const next = c + step;
      const best = cost.get(to);
      const isExample = nodesById.get(id).type === "example";

      let better = best === undefined || next < best;

      if (!better && next === best) {
        // Equally good parents: not an example, then smaller id.
        const current = parent.get(to);
        const currentIsExample = nodesById.get(current).type === "example";
        better =
          (currentIsExample && !isExample) ||
          (currentIsExample === isExample &&
            (byId(id, current) < 0 ||
              (id === current &&
                byId(String(edge.id), String(parentEdge.get(to).id)) < 0)));
      }

      if (better) {
        cost.set(to, next);
        parent.set(to, id);
        parentEdge.set(to, edge);
        heap.push([next, to]);
      }
    }
  }

  return { parent, parentEdge };
}

function layoutComponent(memberIds, nodesById, adjacency, branchOffset) {
  const rootId = chooseRoot(memberIds, nodesById, adjacency);
  const { parent, parentEdge } = buildTree(rootId, nodesById, adjacency);

  // Children lists, depths, and a root-first order (parents before children).
  const children = new Map(memberIds.map((id) => [id, []]));
  for (const [child, p] of parent) children.get(p).push(child);

  const order = [rootId];
  const depth = new Map([[rootId, 0]]);
  for (let i = 0; i < order.length; i += 1) {
    for (const child of children.get(order[i])) {
      depth.set(child, depth.get(order[i]) + 1);
      order.push(child);
    }
  }

  // Leaves under each node (a leaf counts as one).
  const leaves = new Map();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i];
    const kids = children.get(id);
    leaves.set(
      id,
      kids.length ? kids.reduce((sum, k) => sum + leaves.get(k), 0) : 1
    );
  }

  // Bigger branches first, then by name, so the order never depends on input.
  for (const kids of children.values()) {
    kids.sort(
      (a, b) =>
        leaves.get(b) - leaves.get(a) ||
        String(nodesById.get(a).label).localeCompare(
          String(nodesById.get(b).label)
        ) ||
        byId(a, b)
    );
  }

  // ---- angles ----
  const angle = new Map([[rootId, 0]]);
  const wedge = new Map([[rootId, [START_ANGLE, START_ANGLE + 2 * Math.PI]]]);

  for (const id of order) {
    const kids = children.get(id);
    if (!kids.length) continue;

    let [from, to] = wedge.get(id);
    if (id !== rootId) {
      const span = Math.min(to - from, MAX_BRANCH_SPAN);
      const mid = (from + to) / 2;
      from = mid - span / 2;
      to = mid + span / 2;
    }

    const total = kids.reduce((sum, k) => sum + leaves.get(k), 0);
    let cursor = from;

    for (const kid of kids) {
      const share = ((to - from) * leaves.get(kid)) / total;
      wedge.set(kid, [cursor, cursor + share]);
      angle.set(kid, cursor + share / 2);
      cursor += share;
    }
  }

  // ---- boxes and rings ----
  const box = new Map(
    order.map((id) => [id, boxFor(nodesById.get(id), depth.get(id))])
  );

  const rings = [];
  for (const id of order) {
    const d = depth.get(id);
    (rings[d] ||= []).push(id);
  }
  for (const ring of rings) ring.sort((a, b) => angle.get(a) - angle.get(b));

  const centre = new Map([[rootId, { x: 0, y: 0 }]]);

  const overlap = (a, b) => {
    const ca = centre.get(a);
    const cb = centre.get(b);
    return (
      Math.abs(ca.x - cb.x) < (box.get(a).width + box.get(b).width) / 2 + PAD &&
      Math.abs(ca.y - cb.y) < (box.get(a).height + box.get(b).height) / 2 + PAD
    );
  };

  let previousRadius = 0;

  for (let d = 1; d < rings.length; d += 1) {
    const ring = rings[d];
    const before = rings[d - 1];

    let radius = previousRadius + (d === 1 ? FIRST_RING_GAP : RING_GAP);

    for (let step = 0; step <= MAX_RING_STEPS; step += 1) {
      for (const id of ring) {
        centre.set(id, {
          x: Math.cos(angle.get(id)) * radius,
          y: Math.sin(angle.get(id)) * radius,
        });
      }

      let clear = true;

      // Neighbours on the same ring (a couple either side is enough).
      for (let i = 0; i < ring.length && clear; i += 1) {
        for (let j = i + 1; j <= i + 3 && j < ring.length; j += 1) {
          if (overlap(ring[i], ring[j])) {
            clear = false;
            break;
          }
        }
      }

      // The ring just inside (so a child clears its parent and its cousins).
      for (let i = 0; i < ring.length && clear; i += 1) {
        for (const other of before) {
          if (overlap(ring[i], other)) {
            clear = false;
            break;
          }
        }
      }

      if (clear) break;
      radius += RING_STEP;
    }

    previousRadius = radius;
  }

  // ---- branches (colour groups) ----
  const branchOrder = rings[1] || [];
  const branchOf = new Map();
  branchOrder.forEach((id, i) => branchOf.set(id, branchOffset + i));
  for (const id of order) {
    if (id !== rootId && !branchOf.has(id)) {
      branchOf.set(id, branchOf.get(parent.get(id)));
    }
  }

  const info = new Map();
  for (const id of order) {
    const { width, height } = box.get(id);
    const c = centre.get(id);
    const p = parent.get(id);

    info.set(id, {
      root: id === rootId,
      rootId,
      depth: depth.get(id),
      branch: id === rootId ? -1 : branchOf.get(id),
      parentId: p ?? null,
      parentEdgeId: p === undefined ? null : parentEdge.get(id).id,
      width,
      height,
      // top-left, relative to this component's centre
      x: c.x - width / 2,
      y: c.y - height / 2,
    });
  }

  return { info, branchCount: branchOrder.length };
}

/** Shelf-pack component layouts side by side (largest first). */
function packComponents(parts) {
  if (parts.length === 1) return;

  const bounds = parts.map((part) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of part.info.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    return { part, minX, minY, w: maxX - minX, h: maxY - minY };
  });

  bounds.sort((a, b) => b.w * b.h - a.w * a.h || byId(a.part.rootId, b.part.rootId));

  const area = bounds.reduce((s, b) => s + (b.w + COMPONENT_GAP) * (b.h + COMPONENT_GAP), 0);
  const rowWidth = Math.max(bounds[0].w, Math.sqrt(area) * 1.5);

  let x = 0;
  let y = 0;
  let rowHeight = 0;

  for (const b of bounds) {
    if (x > 0 && x + b.w > rowWidth) {
      x = 0;
      y += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }

    const dx = x - b.minX;
    const dy = y - b.minY;
    for (const n of b.part.info.values()) {
      n.x += dx;
      n.y += dy;
    }

    x += b.w + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, b.h);
  }
}

/**
 * @param {Array} nodes  backend nodes ({id, label, type})
 * @param {Array} edges  backend edges ({id, source, target, relationship})
 * @returns {{
 *   positions: Map<string, {x: number, y: number}>,   // top-left
 *   info: Map<string, {root, rootId, depth, branch, parentId, parentEdgeId, width, height}>
 * }}
 */
export function computeLayout(nodes, edges) {
  const positions = new Map();
  const info = new Map();

  if (!Array.isArray(nodes) || nodes.length === 0) return { positions, info };

  const sorted = [...nodes]
    .filter((n) => n && n.id !== undefined)
    .sort((a, b) => byId(a.id, b.id));
  const nodesById = new Map(sorted.map((n) => [n.id, n]));
  const adjacency = buildAdjacency(sorted, edges);

  const parts = [];
  let branchOffset = 0;

  for (const members of findComponents(sorted, adjacency)) {
    const part = layoutComponent(members, nodesById, adjacency, branchOffset);
    part.rootId = chooseRoot(members, nodesById, adjacency);
    branchOffset += part.branchCount;
    parts.push(part);
  }

  packComponents(parts);

  for (const part of parts) {
    for (const [id, n] of part.info) {
      const { x, y, ...rest } = n;
      positions.set(id, { x: Math.round(x), y: Math.round(y) });
      info.set(id, rest);
    }
  }

  return { positions, info };
}
