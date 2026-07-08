import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTableToolbar } from "./DataTableToolbar";
import type { FilterDef } from "./data-table.types";

describe("DataTableToolbar", () => {
  it("renders a checkbox for each multiselect option and toggles a comma-joined value", () => {
    const onFilterChange = vi.fn();
    const filters: FilterDef[] = [
      {
        key: "status",
        label: "Status",
        type: "multiselect",
        options: [
          { label: "Pending", value: "pending" },
          { label: "Promoted", value: "promoted" },
        ],
      },
    ];

    render(
      <DataTableToolbar
        searchInput=""
        onSearch={vi.fn()}
        filters={filters}
        filterValues={{ status: "pending" }}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Status/ }));
    fireEvent.click(screen.getByLabelText("Promoted"));

    expect(onFilterChange).toHaveBeenCalledWith("status", "pending,promoted");
  });

  it("renders two date inputs for a date filter and reports each independently", () => {
    const onFilterChange = vi.fn();
    const filters: FilterDef[] = [
      { key: "createdAt", label: "Created", type: "date", options: [] },
    ];

    render(
      <DataTableToolbar
        searchInput=""
        onSearch={vi.fn()}
        filters={filters}
        filterValues={{}}
        onFilterChange={onFilterChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Created from"), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText("Created to"), {
      target: { value: "2026-06-30" },
    });

    expect(onFilterChange).toHaveBeenCalledWith("createdAt", "2026-06-01");
    expect(onFilterChange).toHaveBeenCalledWith("createdAt_to", "2026-06-30");
  });
});
