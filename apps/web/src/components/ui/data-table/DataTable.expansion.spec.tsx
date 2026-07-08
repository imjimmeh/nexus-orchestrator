import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataTable } from "./DataTable";
import type { ColumnDef } from "./data-table.types";

interface Row {
  id: string;
  title: string;
}

const ROWS: Row[] = [{ id: "1", title: "First" }];
const columns: ColumnDef<Row>[] = [{ key: "title", label: "Title" }];

function renderTable(renderExpanded: (item: Row) => React.ReactNode) {
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
          renderExpanded={renderExpanded}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DataTable row expansion", () => {
  it("does not render expanded content until the row is toggled open", () => {
    renderTable((row) => <p>Timeline for {row.title}</p>);

    expect(screen.queryByText("Timeline for First")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand row First" }));

    expect(screen.getByText("Timeline for First")).toBeTruthy();
  });

  it("collapses expanded content when toggled again", () => {
    renderTable((row) => <p>Timeline for {row.title}</p>);

    const toggle = screen.getByRole("button", { name: "Expand row First" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Collapse row First" }));

    expect(screen.queryByText("Timeline for First")).toBeNull();
  });
});
