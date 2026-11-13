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
      style={{ width: data.width }}
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
