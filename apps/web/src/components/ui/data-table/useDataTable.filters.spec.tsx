import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDataTable } from "./useDataTable";
import type { FilterDef } from "./data-table.types";

interface Row {
  id: string;
  status: string;
  createdAt: string;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const ROWS: Row[] = [
  { id: "1", status: "pending", createdAt: "2026-06-01" },
  { id: "2", status: "promoted", createdAt: "2026-06-15" },
  { id: "3", status: "rejected", createdAt: "2026-06-30" },
];

describe("useDataTable multiselect/date filters (client mode)", () => {
  it("filters by membership when a multiselect filter value is a comma-joined list", () => {
    const { result } = renderHook(
      () =>
        useDataTable<Row>({
          mode: "client",
          data: ROWS,
          columns: [],
          filters: [
            {
              key: "status",
              label: "Status",
              type: "multiselect",
              options: [],
            },
          ] as FilterDef[],
        }),
      { wrapper },
    );

    act(() => {
      result.current.setFilter("status", "pending,rejected");
    });

    expect(result.current.data.map((row) => row.id)).toEqual(["1", "3"]);
  });

  it("filters by an inclusive date range using paired from/to filter keys", () => {
    const { result } = renderHook(
      () =>
        useDataTable<Row>({
          mode: "client",
          data: ROWS,
          columns: [],
          filters: [
            {
              key: "createdAt",
              label: "Created from",
              type: "date",
              options: [],
            },
            {
              key: "createdAt_to",
              label: "Created to",
              type: "date",
              options: [],
            },
          ] as FilterDef[],
        }),
      { wrapper },
    );

    act(() => {
      result.current.setFilter("createdAt", "2026-06-10");
    });
    act(() => {
      result.current.setFilter("createdAt_to", "2026-06-20");
    });

    expect(result.current.data.map((row) => row.id)).toEqual(["2"]);
  });
});
