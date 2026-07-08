import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SORT_DIRECTION,
  TOOL_SORT_FIELD,
  ToolsListSection,
} from "./ToolsListSection";
import { Tool } from "@/lib/api/tools.types";

const baseTool: Tool = {
  id: "tool-1",
  name: "file.read",
  schema: { type: "object" },
  typescript_code: "",
  tier_restriction: 1,
  source: "decorator_provider",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function renderSection(tools: Tool[]) {
  render(
    <ToolsListSection
      isLoading={false}
      tools={tools}
      total={tools.length}
      page={0}
      pageSize={20}
      search=""
      sortBy={TOOL_SORT_FIELD.NAME}
      sortDir={SORT_DIRECTION.ASC}
      onSearchChange={vi.fn()}
      onSortByChange={vi.fn()}
      onSortDirChange={vi.fn()}
      onPageChange={vi.fn()}
      onEditTool={vi.fn()}
      onDeleteTool={vi.fn()}
    />,
  );
}

describe("ToolsListSection", () => {
  it("renders a Source column with a Built-in badge for non-manual tools", () => {
    renderSection([baseTool]);

    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
  });

  it("renders a Custom badge for manual tools", () => {
    renderSection([{ ...baseTool, source: "manual" }]);

    expect(screen.getByText("Custom")).toBeInTheDocument();
  });
});
