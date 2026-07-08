import { render, screen } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { TransitionEdge } from "./TransitionEdge";
import type { TransitionEdgeData } from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createProps(
  overrides: Partial<React.ComponentProps<typeof TransitionEdge>> = {},
) {
  const base: React.ComponentProps<typeof TransitionEdge> = {
    id: "trans-edge-1",
    type: "transition",
    data: {
      kind: "transition" as const,
      condition: "success",
      target: "next-job",
    },
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

describe("TransitionEdge", () => {
  it("renders without crashing with minimal props", () => {
    const { container } = renderWithProvider(
      <svg>
        <TransitionEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path");
    expect(path).toBeTruthy();
  });

  it("shows the condition text as label", () => {
    renderWithProvider(
      <svg>
        <TransitionEdge {...createProps()} />
      </svg>,
    );

    expect(screen.getByText("success")).toBeTruthy();
  });

  it("truncates condition text longer than 30 characters", () => {
    const longCondition =
      "this-is-a-very-long-condition-string-that-exceeds-thirty-chars";
    renderWithProvider(
      <svg>
        <TransitionEdge
          {...createProps({
            data: {
              kind: "transition" as const,
              condition: longCondition,
              target: "next-job",
            } satisfies TransitionEdgeData,
          })}
        />
      </svg>,
    );

    const expected = longCondition.slice(0, 30);
    expect(screen.getByText(expected)).toBeTruthy();
    expect(() => screen.getByText(longCondition)).toThrow();
  });

  it("renders with dashed stroke style", () => {
    const { container } = renderWithProvider(
      <svg>
        <TransitionEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path") as SVGPathElement;
    expect(path).toBeTruthy();
    expect(path.style.stroke).toContain("rgb(249, 115, 22)");
    expect(path.style.strokeDasharray).toBe("6 4");
  });
});
