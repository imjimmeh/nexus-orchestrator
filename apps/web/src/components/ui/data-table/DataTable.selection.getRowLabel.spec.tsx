import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DataTable } from "./DataTable";
import type { ColumnDef } from "./data-table.types";

interface ProposalRow {
  id: string;
  proposal_title: string;
}

const ROWS: ProposalRow[] = [{ id: "1", proposal_title: "Improve caching" }];

const columns: ColumnDef<ProposalRow>[] = [
  { key: "proposal_title", label: "Proposal" },
];

function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DataTable<ProposalRow>
          mode="client"
          data={ROWS}
          columns={columns}
          enableSelection
          getRowLabel={(row) => row.proposal_title}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DataTable row selection with getRowLabel", () => {
  it("uses getRowLabel to compute the accessible name for row types without a title field", () => {
    renderTable();

    expect(
      screen.getByRole("checkbox", { name: "Select row Improve caching" }),
    ).toBeTruthy();
  });
});
