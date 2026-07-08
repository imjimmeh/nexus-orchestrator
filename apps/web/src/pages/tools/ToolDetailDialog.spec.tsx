import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolDetailDialog } from "./ToolDetailDialog";
import { Tool } from "@/lib/api/tools.types";

const baseTool: Tool = {
  id: "tool-1",
  name: "file.read",
  schema: { type: "object", properties: {} },
  typescript_code: "export const tool = {};",
  tier_restriction: 1,
  source: "decorator_provider",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("ToolDetailDialog", () => {
  it("renders tool name, source badge, and implementation note", () => {
    render(
      <ToolDetailDialog
        open
        tool={baseTool}
        onOpenChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("file.read")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Implemented in code.")).toBeInTheDocument();
  });

  it("renders nothing when no tool is provided", () => {
    render(
      <ToolDetailDialog
        open
        tool={null}
        onOpenChange={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByText("Implemented in code.")).not.toBeInTheDocument();
  });
});
