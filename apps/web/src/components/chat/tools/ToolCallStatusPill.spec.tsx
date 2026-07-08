import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallStatusPill } from "./ToolCallStatusPill";

describe("ToolCallStatusPill", () => {
  it("shows running glyph when status is started", () => {
    render(<ToolCallStatusPill status="started" isError={false} />);
    expect(screen.getByText(/running/i)).toBeTruthy();
  });
  it("shows running glyph when status is updated", () => {
    render(<ToolCallStatusPill status="updated" isError={false} />);
    expect(screen.getByText(/running/i)).toBeTruthy();
  });
  it("shows success glyph when status is finished and not error", () => {
    render(<ToolCallStatusPill status="finished" isError={false} />);
    expect(screen.getByText("ok")).toBeTruthy();
  });
  it("shows failure glyph when status is finished and error", () => {
    render(<ToolCallStatusPill status="finished" isError={true} />);
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
