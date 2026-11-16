import { memo } from "react";
import { Handle, Position } from "@xyflow/react";

/**
 * One concept on the mind map. The handles are invisible: edges are drawn by
 * FloatingEdge, which works out its own end points, so these only have to
 * exist for React Flow to attach edges to.
 */
function ConceptNode({ data }) {
  return (
    <div
      className="concept-node"
      data-kind={data.kind}
      data-depth={Math.min(data.depth, 3)}
      data-root={data.root ? "true" : undefined}
      style={{ width: data.width, height: data.height, "--branch": data.color }}
      title={data.label}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="concept-handle"
        isConnectable={false}
      />
      <span className="concept-node-label">{data.label}</span>
      <Handle
        type="source"
        position={Position.Bottom}
        className="concept-handle"
        isConnectable={false}
      />
    </div>
  );
}

export default memo(ConceptNode);
