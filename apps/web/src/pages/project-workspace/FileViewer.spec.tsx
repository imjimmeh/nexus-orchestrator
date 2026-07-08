import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileViewer } from "./FileViewer";

describe("FileViewer", () => {
  it("shows loading state", () => {
    render(
      <FileViewer
        content={null}
        filePath="test.ts"
        isLoading={true}
        error={null}
      />,
    );

    expect(screen.getByText("Loading file...")).toBeTruthy();
  });

  it("shows empty state when no file selected", () => {
    render(
      <FileViewer
        content={null}
        filePath={null}
        isLoading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Select a file to view")).toBeTruthy();
  });

  it("shows error state", () => {
    render(
      <FileViewer
        content={null}
        filePath="test.ts"
        isLoading={false}
        error="Failed to load file"
      />,
    );

    expect(screen.getByText("Failed to load file")).toBeTruthy();
  });
});
