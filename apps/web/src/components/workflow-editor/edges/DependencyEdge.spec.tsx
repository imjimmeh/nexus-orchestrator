import { render, screen } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { DependencyEdge } from "./DependencyEdge";
import type { DependencyEdgeData } from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createProps(
  overrides: Partial<React.ComponentProps<typeof DependencyEdge>> = {},
) {
  const base: React.ComponentProps<typeof DependencyEdge> = {
    id: "dep-edge-1",
    type: "dependency",
    data: { kind: "dependency" as const },
    source: "node-1",
    target: "node-2",
    sourceX: 0,
    sourceY: 50,
    targetX: 200,
    targetY: 50,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    selected: false,
    selectable: true,
    deletable: true,
    markerEnd: 'url("#arrow")',
    ...overrides,
  };

  return base;
}

describe("DependencyEdge", () => {
  it("renders without crashing with minimal props", () => {
    const { container } = renderWithProvider(
      <svg>
        <DependencyEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path");
    expect(path).toBeTruthy();
  });

  it("shows result policy text when provided", () => {
    renderWithProvider(
      <svg>
        <DependencyEdge
          {...createProps({
            data: {
              kind: "dependency" as const,
              resultPolicy: "success_or_skipped",
            } satisfies DependencyEdgeData,
          })}
        />
      </svg>,
    );

    expect(screen.getByText("success_or_skipped")).toBeTruthy();
  });

  it("shows optional indicator when optional is true", () => {
    renderWithProvider(
      <svg>
        <DependencyEdge
          {...createProps({
            data: {
              kind: "dependency" as const,
              optional: true,
            } satisfies DependencyEdgeData,
          })}
        />
      </svg>,
    );

    expect(screen.getByText("(optional)")).toBeTruthy();
  });

  it("shows both result policy and optional indicator", () => {
    renderWithProvider(
      <svg>
        <DependencyEdge
          {...createProps({
            data: {
              kind: "dependency" as const,
              resultPolicy: "success",
              optional: true,
            } satisfies DependencyEdgeData,
          })}
        />
      </svg>,
    );

    expect(screen.getByText("success")).toBeTruthy();
    expect(screen.getByText("(optional)")).toBeTruthy();
  });

  it("renders with solid stroke style", () => {
    const { container } = renderWithProvider(
      <svg>
        <DependencyEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path") as SVGPathElement;
    expect(path).toBeTruthy();
    expect(path.style.stroke).toContain("rgb(0, 0, 0)");
  });
});
