import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  const mockFiles = [
    "src/components/Button.tsx",
    "src/components/Input.tsx",
    "src/utils/helpers.ts",
    "package.json",
    "README.md",
  ];

  it("renders file tree structure", () => {
    render(
      <FileTree files={mockFiles} selectedPath={null} onSelectFile={vi.fn()} />,
    );

    expect(screen.getByText("Repository")).toBeTruthy();
    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.getByText("package.json")).toBeTruthy();
  });

  it("expands folders when clicked", () => {
    render(
      <FileTree files={mockFiles} selectedPath={null} onSelectFile={vi.fn()} />,
    );

    // Root is expanded (depth 0 < 2), src folder is at depth 1, also expanded by default
    // components is at depth 2, so it's collapsed initially
    expect(screen.queryByText("Button.tsx")).toBeNull();

    // Click components to expand
    const componentsFolder = screen.getByText("components");
    fireEvent.click(componentsFolder);

    expect(screen.getByText("Button.tsx")).toBeTruthy();
    expect(screen.getByText("Input.tsx")).toBeTruthy();
  });

  it("calls onSelectFile when file is clicked", () => {
    const onSelectFile = vi.fn();
    render(
      <FileTree
        files={mockFiles}
        selectedPath={null}
        onSelectFile={onSelectFile}
      />,
    );

    const packageJson = screen.getByText("package.json");
    fireEvent.click(packageJson);

    expect(onSelectFile).toHaveBeenCalledWith("package.json");
  });
});
