import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallHeader } from "./ToolCallHeader";

describe("ToolCallHeader", () => {
  it("renders glyph, label and status pill", () => {
    render(
      <ToolCallHeader
        glyph="$"
        label="npm install"
        status="finished"
        isError={false}
      />,
    );
    expect(screen.getByText("$")).toBeTruthy();
    expect(screen.getByText("npm install")).toBeTruthy();
    expect(screen.getByText("ok")).toBeTruthy();
  });
  it("renders duration badge when provided", () => {
    render(
      <ToolCallHeader
        glyph="$"
        label="npm install"
        status="finished"
        isError={false}
        durationMs={1234}
      />,
    );
    expect(screen.getByText(/1234ms/i)).toBeTruthy();
  });
  it("omits duration badge when not provided", () => {
    render(
      <ToolCallHeader
        glyph="$"
        label="npm install"
        status="finished"
        isError={false}
      />,
    );
    expect(screen.queryByText(/ms/i)).toBeNull();
  });
});
