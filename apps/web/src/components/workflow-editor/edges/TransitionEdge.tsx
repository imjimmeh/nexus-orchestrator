import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { TransitionEdgeData } from "../serialization/types";
import { truncate } from "./utils";

type TransitionEdgeType = Edge<TransitionEdgeData, "transition">;

export function TransitionEdge({
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
}: EdgeProps<TransitionEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const conditionText = truncate(data?.condition ?? "", 30);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: "#f97316",
          strokeWidth: 2,
          strokeDasharray: "6 4",
          ...style,
        }}
      />
      {conditionText.length > 0 && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <foreignObject x={-50} y={-10} width={100} height={20}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: selected ? "#fff7ed" : "#ffffff",
                border: "1px solid #fdba74",
                borderRadius: "4px",
                padding: "1px 6px",
                fontSize: "10px",
                color: "#c2410c",
                width: "fit-content",
                margin: "0 auto",
                whiteSpace: "nowrap",
              }}
              className="nodrag nopan"
            >
              <span>{conditionText}</span>
            </div>
          </foreignObject>
        </g>
      )}
    </>
  );
}
