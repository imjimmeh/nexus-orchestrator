import { render, screen } from "@testing-library/react";
import { Position, ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { SwitchEdge } from "./SwitchEdge";
import type { SwitchEdgeData } from "../serialization/types";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

function createProps(
  overrides: Partial<React.ComponentProps<typeof SwitchEdge>> = {},
) {
  const base: React.ComponentProps<typeof SwitchEdge> = {
    id: "switch-edge-1",
    type: "switch",
    data: {
      kind: "switch" as const,
      caseCondition: "value === 1",
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

describe("SwitchEdge", () => {
  it("renders without crashing with minimal props", () => {
    const { container } = renderWithProvider(
      <svg>
        <SwitchEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path");
    expect(path).toBeTruthy();
  });

  it("shows the case condition as label", () => {
    renderWithProvider(
      <svg>
        <SwitchEdge {...createProps()} />
      </svg>,
    );

    expect(screen.getByText("value === 1")).toBeTruthy();
  });

  it("shows default label when isDefault is true", () => {
    renderWithProvider(
      <svg>
        <SwitchEdge
          {...createProps({
            data: {
              kind: "switch" as const,
              caseCondition: "default",
              isDefault: true,
            } satisfies SwitchEdgeData,
          })}
        />
      </svg>,
    );

    expect(screen.getByText("(default)")).toBeTruthy();
  });

  it("renders with purple accent stroke", () => {
    const { container } = renderWithProvider(
      <svg>
        <SwitchEdge {...createProps()} />
      </svg>,
    );

    const path = container.querySelector("path") as SVGPathElement;
    expect(path).toBeTruthy();
    expect(path.style.stroke).toContain("rgb(168, 85, 247)");
  });
});
