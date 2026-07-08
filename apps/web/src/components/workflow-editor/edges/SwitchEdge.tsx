import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { SwitchEdgeData } from "../serialization/types";
import { truncate } from "./utils";

type SwitchEdgeType = Edge<SwitchEdgeData, "switch">;

export function SwitchEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
}: EdgeProps<SwitchEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const caseCondition = data?.caseCondition ?? "";
  const isDefault = data?.isDefault ?? false;
  const hasLabel = isDefault || caseCondition.length > 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: "#a855f7", strokeWidth: 2, ...style }}
      />
      {hasLabel && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <foreignObject x={-50} y={-10} width={100} height={20}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: selected ? "#faf5ff" : "#ffffff",
                border: "1px solid #d8b4fe",
                borderRadius: "4px",
                padding: "1px 6px",
                fontSize: "10px",
                color: "#7e22ce",
                width: "fit-content",
                margin: "0 auto",
                whiteSpace: "nowrap",
              }}
              className="nodrag nopan"
            >
              {isDefault ? (
                <span>(default)</span>
              ) : (
                <span>{truncate(caseCondition, 30)}</span>
              )}
            </div>
          </foreignObject>
        </g>
      )}
    </>
  );
}
