import { memo } from "react";
import { BaseEdge, getStraightPath, useInternalNode } from "@xyflow/react";
import { edgeEndpoints } from "../utils/knowledgeGraph";

const rectOf = (node) => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width,
  height: node.measured.height,
});

/**
 * A straight edge that runs from border to border instead of centre to
 * centre, so the arrowhead is not hidden underneath the target node.
 */
function FloatingEdge({ id, source, target, markerEnd, label }) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // Nodes are measured after their first render; draw nothing until then.
  if (
    !sourceNode?.measured?.width ||
    !targetNode?.measured?.width
  ) {
    return null;
  }

  const ends = edgeEndpoints(rectOf(sourceNode), rectOf(targetNode));

  const [path, labelX, labelY] = getStraightPath({
    sourceX: ends.source.x,
    sourceY: ends.source.y,
    targetX: ends.target.x,
    targetY: ends.target.y,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelShowBg
      labelBgPadding={[6, 3]}
      labelBgBorderRadius={6}
      interactionWidth={0}
    />
  );
}

export default memo(FloatingEdge);
