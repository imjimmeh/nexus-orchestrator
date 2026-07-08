import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataTable } from "./DataTable";
import type { ColumnDef, DataTableProps } from "./data-table.types";

interface Row {
  id: string;
  title: string;
}

const ROWS: Row[] = [
  { id: "1", title: "First" },
  { id: "2", title: "Second" },
];

const columns: ColumnDef<Row>[] = [{ key: "title", label: "Title" }];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DataTable<Row>
          mode="client"
          data={ROWS}
          columns={columns}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DataTable row selection", () => {
  it("does not render checkboxes when enableSelection is not set", () => {
    renderTable();

    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the bulk action bar with selected rows once a row is checked", () => {
    const renderBulkActions = vi.fn((selected: Row[]) => (
      <span>{selected.length} selected</span>
    ));

    renderTable({ enableSelection: true, renderBulkActions });

    expect(screen.queryByText(/selected/)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select row First" }));

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(renderBulkActions).toHaveBeenCalledWith([ROWS[0]]);
  });

  it("selects every row on the page via the header checkbox", () => {
    const renderBulkActions = vi.fn((selected: Row[]) => (
      <span>{selected.length} selected</span>
    ));

    renderTable({ enableSelection: true, renderBulkActions });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));

    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("clears the bulk bar when the last selected row is unchecked", () => {
    renderTable({
      enableSelection: true,
      renderBulkActions: (selected) => <span>{selected.length} selected</span>,
    });

    const checkbox = screen.getByRole("checkbox", { name: "Select row First" });
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);

    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
