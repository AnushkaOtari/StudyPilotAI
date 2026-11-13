// Force-directed layout for the Mind Map.
//
// Imported only by the lazily loaded MindMapCanvas, so d3-force never lands
// in the main bundle. The simulation is run to completion up front (no live
// animation) and the result is static: with the same graph you always get the
// same picture, and React Flow handles panning, zooming and selection.

import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";
import { nodeWidth, NODE_HEIGHT } from "./knowledgeGraph";

const DEFAULT_TICKS = 300;
const LARGE_GRAPH_TICKS = 120;
const LARGE_GRAPH_NODES = 600;

/**
 * @param {Array} nodes  backend nodes ({id, label, type})
 * @param {Array} edges  backend edges ({source, target})
 * @returns {Map<string, {x: number, y: number}>} top-left position per node id
 */
export function computeLayout(nodes, edges, { ticks } = {}) {
  const positions = new Map();

  if (!Array.isArray(nodes) || nodes.length === 0) return positions;

  // Sorted so the same graph always starts from the same arrangement.
  const simNodes = [...nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({
      id: n.id,
      type: n.type,
      width: nodeWidth(n.label),
    }));

  if (simNodes.length === 1) {
    positions.set(simNodes[0].id, {
      x: -simNodes[0].width / 2,
      y: -NODE_HEIGHT / 2,
    });
    return positions;
  }

  const known = new Set(simNodes.map((n) => n.id));

  const links = (edges || [])
    .filter(
      (e) =>
        known.has(e.source) && known.has(e.target) && e.source !== e.target
    )
    .map((e) => ({ source: e.source, target: e.target }))
    // The link force applies edges one after another, so their order would
    // otherwise change the picture slightly.
    .sort((a, b) =>
      a.source === b.source
        ? a.target < b.target ? -1 : a.target > b.target ? 1 : 0
        : a.source < b.source ? -1 : 1
    );

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink(links)
        .id((d) => d.id)
        .distance((l) => 130 + (l.source.width + l.target.width) / 4)
        .strength(0.5)
    )
    .force(
      "charge",
      forceManyBody().strength((d) => (d.type === "main_topic" ? -700 : -380))
    )
    .force(
      "collide",
      forceCollide((d) => d.width / 2 + 14).strength(0.9)
    )
    // A weak pull to the middle keeps unconnected clusters on screen.
    .force("x", forceX(0).strength(0.04))
    .force("y", forceY(0).strength(0.05))
    .stop();

  const steps =
    ticks ??
    (simNodes.length > LARGE_GRAPH_NODES ? LARGE_GRAPH_TICKS : DEFAULT_TICKS);

  for (let i = 0; i < steps; i += 1) simulation.tick();

  for (const n of simNodes) {
    positions.set(n.id, {
      x: Math.round(n.x - n.width / 2),
      y: Math.round(n.y - NODE_HEIGHT / 2),
    });
  }

  return positions;
}
