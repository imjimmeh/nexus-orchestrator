// apps/web/src/components/ui/data-table/useDataTable.url.spec.tsx
import { describe, expect, it } from "vitest";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDataTable } from "./useDataTable";

function wrapper(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("useDataTable url persistence", () => {
  it("hydrates initial state from the URL when urlKey is set", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/?wi_q=auth&wi_sort=title&wi_dir=asc&wi_page=2") },
    );

    expect(result.current.searchInput).toBe("auth");
    expect(result.current.sortBy).toBe("title");
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.meta.page).toBe(2);
  });

  it("hydrates namespaced filter values from the URL", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/?wi_f_status=todo&wi_f_priority=p1") },
    );

    expect(result.current.filterValues).toEqual({
      status: "todo",
      priority: "p1",
    });
  });

  it("falls back to defaultFilterValues when urlKey is set but the URL has no filter params yet", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          defaultFilterValues: { status: "pending,promoted" },
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/") },
    );

    expect(result.current.filterValues).toEqual({
      status: "pending,promoted",
    });
  });

  it("lets URL filter params override individual defaultFilterValues keys", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          defaultFilterValues: { status: "pending,promoted", priority: "p1" },
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/?wi_f_status=rejected") },
    );

    expect(result.current.filterValues).toEqual({
      status: "rejected",
      priority: "p1",
    });
  });

  it("ignores params from other namespaces", () => {
    const { result } = renderHook(
      () =>
        useDataTable<{ id: string }>({
          mode: "server",
          columns: [],
          urlKey: "wi",
          fetchFn: async () => ({
            data: [],
            meta: {
              pagination: { total: 0, page: 1, limit: 20, totalPages: 0 },
            },
          }),
          queryKey: ["x"],
        }),
      { wrapper: wrapper("/?board_q=other&wi_q=mine") },
    );

    expect(result.current.searchInput).toBe("mine");
  });

  it("converges when two DataTables with different urlKeys share one router (regression: reorder ping-pong loop)", async () => {
    function fetchEmpty() {
      return Promise.resolve({
        data: [],
        meta: { pagination: { total: 0, page: 1, limit: 20, totalPages: 0 } },
      });
    }

    function TwoTables() {
      useDataTable<{ id: string }>({
        mode: "server",
        columns: [],
        urlKey: "aa",
        defaultFilterValues: { status: "pending" },
        fetchFn: fetchEmpty,
        queryKey: ["aa"],
      });
      useDataTable<{ id: string }>({
        mode: "server",
        columns: [],
        urlKey: "bb",
        defaultFilterValues: { status: "pending" },
        fetchFn: fetchEmpty,
        queryKey: ["bb"],
      });
      const [params] = useSearchParams();
      return <span data-testid="search">{params.toString()}</span>;
    }

    render(<TwoTables />, { wrapper: wrapper("/") });

    const searchEl = screen.getByTestId("search");
    await waitFor(() => {
      expect(searchEl.textContent).toContain("aa_f_status=pending");
      expect(searchEl.textContent).toContain("bb_f_status=pending");
    });

    // Both tables' sync effects must have settled by now. If the reorder
    // ping-pong regresses, each table's unconditional delete+re-add of its
    // own filter params keeps moving them to the end of the query string,
    // which keeps re-triggering the other table's sync effect forever —
    // so this value would still be changing after further ticks.
    const settled = searchEl.textContent;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(searchEl.textContent).toBe(settled);
  });
});
