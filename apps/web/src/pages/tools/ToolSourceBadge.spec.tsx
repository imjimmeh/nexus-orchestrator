import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolSourceBadge } from "./ToolSourceBadge";

describe("ToolSourceBadge", () => {
  it("renders Custom for manual tools", () => {
    render(<ToolSourceBadge source="manual" />);
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("renders Built-in for decorator-provided tools", () => {
    render(<ToolSourceBadge source="decorator_provider" />);
    expect(screen.getByText("Built-in")).toBeInTheDocument();
  });

  it("renders MCP for externally synced tools", () => {
    render(<ToolSourceBadge source="external_mcp" />);
    expect(screen.getByText("MCP")).toBeInTheDocument();
  });
});
