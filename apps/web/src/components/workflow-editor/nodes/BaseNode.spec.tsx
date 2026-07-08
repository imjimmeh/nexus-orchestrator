import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { BaseNode } from "./BaseNode";

function renderWithProvider(ui: React.ReactElement) {
  return render(<ReactFlowProvider>{ui}</ReactFlowProvider>);
}

describe("BaseNode", () => {
  it("renders the label", () => {
    renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
      />,
    );

    expect(screen.getByText("Test Node")).toBeTruthy();
  });

  it("renders the icon", () => {
    renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon">⚙</span>}
        label="Test Node"
        accentColor="bg-blue-500"
      />,
    );

    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  it("renders children content", () => {
    renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
      >
        <p data-testid="child-content">Custom child content</p>
      </BaseNode>,
    );

    expect(screen.getByTestId("child-content")).toBeTruthy();
    expect(screen.getByText("Custom child content")).toBeTruthy();
  });

  it("renders footer when provided", () => {
    renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
        footer={<span data-testid="footer-content">Footer text</span>}
      />,
    );

    expect(screen.getByTestId("footer-content")).toBeTruthy();
    expect(screen.getByText("Footer text")).toBeTruthy();
  });

  it("does not render footer when not provided", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
      />,
    );

    const footerDiv = container.querySelector(".border-t");
    expect(footerDiv).toBeNull();
  });

  it("renders target and source Handles", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
      />,
    );

    const targetHandle = container.querySelector('[data-handlepos="left"]');
    const sourceHandle = container.querySelector('[data-handlepos="right"]');
    expect(targetHandle).toBeTruthy();
    expect(sourceHandle).toBeTruthy();
  });

  it("applies the accent color class to the colored bar", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-red-500"
      />,
    );

    const accentBar = container.querySelector(".bg-red-500");
    expect(accentBar).toBeTruthy();
  });

  it("applies selected ring when selected is true", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
        selected
      />,
    );

    const nodeDiv = container.firstElementChild;
    expect(nodeDiv?.classList.contains("ring-2")).toBe(true);
    expect(nodeDiv?.classList.contains("ring-primary")).toBe(true);
  });

  it("does not apply selected ring when selected is false", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
        selected={false}
      />,
    );

    const nodeDiv = container.firstElementChild;
    expect(nodeDiv?.classList.contains("ring-2")).toBe(false);
  });

  it("renders without selected prop (defaults to false)", () => {
    const { container } = renderWithProvider(
      <BaseNode
        icon={<span data-testid="icon" />}
        label="Test Node"
        accentColor="bg-blue-500"
      />,
    );

    const nodeDiv = container.firstElementChild;
    expect(nodeDiv?.classList.contains("ring-2")).toBe(false);
  });
});
