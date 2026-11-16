import { memo } from "react";
import { BaseEdge, useInternalNode } from "@xyflow/react";
import { edgeCurve } from "../utils/knowledgeGraph";

const rectOf = (node) => ({
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width,
  height: node.measured.height,
});

const hasSize = (node) => !!node?.measured?.width;

/**
 * A curved connector that runs from border to border.
 *
 * Branch connectors (`data.tree`) are drawn from the parent to the child as a
 * smooth S-curve that leaves and arrives along the radial direction. Every
 * other relationship is a gentle arc.
 */
function FloatingEdge({
  id,
  source,
  target,
  markerStart,
  markerEnd,
  label,
  data,
}) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const originNode = useInternalNode(data?.originId || "");

  // Nodes are measured after their first render; draw nothing until then.
  if (!hasSize(sourceNode) || !hasSize(targetNode)) return null;

  const tree = !!data?.tree;
  const fromIsSource = !tree || data.parentId === source;

  const from = rectOf(fromIsSource ? sourceNode : targetNode);
  const to = rectOf(fromIsSource ? targetNode : sourceNode);
  const origin = hasSize(originNode) ? rectOf(originNode) : null;

  const { path, labelX, labelY } = edgeCurve(from, to, { tree, origin });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerStart={markerStart}
      markerEnd={markerEnd}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelShowBg
      labelBgPadding={[6, 3]}
      labelBgBorderRadius={6}
      interactionWidth={0}
      style={{
        stroke: data?.stroke,
        strokeWidth: data?.strokeWidth,
      }}
    />
  );
}

export default memo(FloatingEdge);
