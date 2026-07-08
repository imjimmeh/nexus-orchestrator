import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { DependencyEdgeData } from "../serialization/types";
import { truncate } from "./utils";

type DependencyEdgeType = Edge<DependencyEdgeData, "dependency">;

export function DependencyEdge({
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
}: EdgeProps<DependencyEdgeType>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const resultPolicy = data?.resultPolicy;
  const optional = data?.optional;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: "#000000", strokeWidth: 2, ...style }}
      />
      {(resultPolicy !== undefined || optional) && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <foreignObject x={-50} y={-10} width={100} height={20}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                background: selected ? "#f8fafc" : "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "4px",
                padding: "1px 6px",
                fontSize: "10px",
                color: "#334155",
                width: "fit-content",
                margin: "0 auto",
                whiteSpace: "nowrap",
              }}
              className="nodrag nopan"
            >
              {resultPolicy !== undefined && (
                <span>{truncate(resultPolicy, 24)}</span>
              )}
              {optional && <span> (optional)</span>}
            </div>
          </foreignObject>
        </g>
      )}
    </>
  );
}
