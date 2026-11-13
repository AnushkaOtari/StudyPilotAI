import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ConceptNode from "./ConceptNode";
import FloatingEdge from "./FloatingEdge";
import { computeLayout } from "../utils/graphLayout";
import {
  NODE_HEIGHT,
  graphSignature,
  nodeWidth,
  toFlowElements,
} from "../utils/knowledgeGraph";

import "./MindMapCanvas.css";

// Defined once, outside the component, so React Flow does not rebuild them.
const nodeTypes = { concept: ConceptNode };
const edgeTypes = { floating: FloatingEdge };

const MINIMAP_COLORS = {
  main_topic: "#F2DA76",
  subtopic: "#FFF4C7",
  example: "#E9E4D5",
};

const miniMapColor = (node) => MINIMAP_COLORS[node.data?.kind] || "#D8D2C2";

function Canvas({ graph, selectedId, focusTick, onSelect }) {
  const reactFlow = useReactFlow();
  const handledFocus = useRef(0);

  // `graph` keeps the same identity until its content changes, so the
  // layout is computed once per real change (never on a plain re-poll).
  const positions = useMemo(
    () => computeLayout(graph.nodes, graph.edges),
    [graph]
  );

  const { nodes, edges } = useMemo(
    () => toFlowElements(graph, positions, selectedId),
    [graph, positions, selectedId]
  );

  // Selecting a concept from the details list brings it into view. Clicking
  // a node on the canvas does not move the camera.
  useEffect(() => {
    if (!focusTick || focusTick === handledFocus.current) return;
    handledFocus.current = focusTick;

    const position = positions.get(selectedId);
    if (!position) return;

    reactFlow.setCenter(
      position.x + nodeWidth(findLabel(graph, selectedId)) / 2,
      position.y + NODE_HEIGHT / 2,
      { zoom: Math.max(reactFlow.getZoom(), 1), duration: 400 }
    );
  }, [focusTick, selectedId, positions, graph, reactFlow]);

  return (
    <ReactFlow
      // A different set of concepts is a different picture: refit the view.
      key={graphSignature(graph)}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable
      minZoom={0.1}
      maxZoom={2.5}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
      onlyRenderVisibleElements={nodes.length > 150}
      aria-label="Mind map. Drag to pan, scroll or pinch to zoom, select a concept for details."
    >
      <Background gap={24} size={1.5} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        nodeColor={miniMapColor}
        nodeStrokeWidth={2}
        className="mindmap-minimap"
      />
    </ReactFlow>
  );
}

function findLabel(graph, id) {
  return graph.nodes.find((n) => n.id === id)?.label || "";
}

/**
 * The interactive graph. Loaded lazily (see MindMapPanel) so React Flow and
 * d3-force only download when the Mind Map tab is first opened.
 */
function MindMapCanvas(props) {
  return (
    <div className="mindmap-canvas">
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}

export default MindMapCanvas;
