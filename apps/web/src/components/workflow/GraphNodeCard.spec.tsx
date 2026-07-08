import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { GraphNodeCard, shouldShowSecondaryText } from "./GraphNodeCard";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("GraphNodeCard", () => {
  it("renders type label, title, secondary text, and tier", () => {
    const { container } = renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Build workflow"
        accentColor="bg-blue-500"
        secondaryText="Run the build"
        tier="L2"
        preview={
          <span data-testid="preview">
            This is a very long preview line that should wrap safely.
          </span>
        }
      />,
    );

    expect(
      screen.getByTestId("graph-node-accent").classList.contains("bg-blue-500"),
    ).toBe(true);
    expect(screen.getByText("Job")).toBeTruthy();
    expect(screen.getByText("Build workflow")).toBeTruthy();
    expect(screen.getByText("Run the build")).toBeTruthy();
    expect(screen.getByText("Tier: L2")).toBeTruthy();
    expect(screen.getByTestId("preview").parentElement?.className).toContain(
      "break-words",
    );
    expect(screen.getByTestId("preview").parentElement?.className).toContain(
      "whitespace-pre-wrap",
    );

    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain("min-w-[210px]");
    expect(node.className).toContain("max-w-[280px]");

    expect(screen.getByText("Job").classList.contains("truncate")).toBe(true);
    expect(
      screen.getByText("Build workflow").classList.contains("truncate"),
    ).toBe(true);
    expect(
      screen.getByText("Run the build").classList.contains("truncate"),
    ).toBe(true);
    expect(screen.getByText("Tier: L2").classList.contains("truncate")).toBe(
      true,
    );
  });

  it("does not render duplicate secondary text", () => {
    renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Build workflow"
        accentColor="bg-blue-500"
        secondaryText="Build workflow"
      />,
    );

    expect(screen.getAllByText("Build workflow")).toHaveLength(1);
  });

  it("renders statusSlot and actionSlot content", () => {
    renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Build workflow"
        accentColor="bg-blue-500"
        statusSlot={<span>Status</span>}
        actionSlot={<span>Action</span>}
      />,
    );

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Action")).toBeTruthy();
    expect(screen.getByTestId("graph-node-controls").className).toContain(
      "nodrag",
    );
    expect(screen.getByTestId("graph-node-controls").className).toContain(
      "nopan",
    );
    expect(screen.getByTestId("graph-node-controls").className).toContain(
      "shrink-0",
    );
  });

  it("applies the selected ring when selected", () => {
    const { container } = renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Selected card"
        accentColor="bg-blue-500"
        selected
      />,
    );

    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain("ring-2");
    expect(node.className).toContain("ring-primary");
  });

  it("applies muted styling without reducing text opacity", () => {
    const { container } = renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Muted card"
        accentColor="bg-blue-500"
        muted
      />,
    );

    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain("bg-muted/50");
    expect(node.className).not.toContain("opacity-70");
  });

  it("renders footer content when provided", () => {
    renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Footer card"
        accentColor="bg-blue-500"
        footer={<span data-testid="footer-content">Footer text</span>}
      />,
    );

    expect(screen.getByTestId("footer-content")).toBeTruthy();
    expect(screen.getByText("Footer text")).toBeTruthy();
  });

  it("applies compact sizing and smaller handles", () => {
    const { container } = renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Compact card"
        accentColor="bg-blue-500"
        compact
      />,
    );

    const node = container.firstElementChild as HTMLElement;
    expect(node.className).toContain("min-w-[160px]");
    expect(node.className).toContain("max-w-[200px]");

    const targetHandle = container.querySelector('[data-handlepos="left"]');
    const sourceHandle = container.querySelector('[data-handlepos="right"]');
    expect(targetHandle?.className).toContain("!h-1.5");
    expect(targetHandle?.className).toContain("!w-1.5");
    expect(sourceHandle?.className).toContain("!h-1.5");
    expect(sourceHandle?.className).toContain("!w-1.5");
  });

  it("applies non-compact handle sizing by default", () => {
    const { container } = renderWithProvider(
      <GraphNodeCard
        icon={<span>Icon</span>}
        typeLabel="Job"
        title="Default card"
        accentColor="bg-blue-500"
      />,
    );

    const targetHandle = container.querySelector('[data-handlepos="left"]');
    const sourceHandle = container.querySelector('[data-handlepos="right"]');
    expect(targetHandle?.className).toContain("!h-2");
    expect(targetHandle?.className).toContain("!w-2");
    expect(sourceHandle?.className).toContain("!h-2");
    expect(sourceHandle?.className).toContain("!w-2");
  });
});

describe("shouldShowSecondaryText", () => {
  it("returns false for undefined, empty, and duplicate text, and true for distinct text", () => {
    expect(shouldShowSecondaryText("Build workflow", undefined)).toBe(false);
    expect(shouldShowSecondaryText("Build workflow", "")).toBe(false);
    expect(shouldShowSecondaryText("Build workflow", "Build workflow")).toBe(
      false,
    );
    expect(shouldShowSecondaryText("Build workflow", "Run the build")).toBe(
      true,
    );
  });
});
