# Learning Tab Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shared `DataTable` component with the generic capabilities the Learning tab needs (multiselect/date filters, a default filter state, row selection with a bulk-action bar, row expansion), then migrate the Learning Candidates and Skill Proposals cards onto it against the new backend contract built in `docs/superpowers/plans/2026-07-01-learning-tab-backend-rewrite.md`.

**Architecture:** `DataTable`'s 5 existing consumers (Workflows, GlobalWorkItemsPage, ExecutionLogs, EventLedgerFeed, WorkflowEventsFeed) are unaffected — every DataTable change is an additive/optional prop. The two Learning cards stop being prop-driven (`items`/`isLoading`/`statusFilter` passed from `LearningTab.tsx`) and become self-contained consumers of `DataTable mode="server"`, following the exact pattern `Workflows.tsx`/`GlobalWorkItemsPage.tsx` already use: a page-level `fetchFn` calling the API client directly and a `ColumnDef[]`/`FilterDef[]` pair, with `DataTable` owning its own `useQuery`/pagination/sort/search/selection state internally. The two now-dead list-fetching hooks (`useLearningCandidates`, `useSkillImprovementProposals`) are deleted outright rather than kept alongside the new ones — this codebase's convention is elimination, not deprecation.

**Tech Stack:** React 19, TanStack Query v5, React Router (`useSearchParams`), Vitest + React Testing Library, date-fns, Radix UI (Checkbox, Popover).

## Global Constraints

- Never use `eslint-disable`, `@ts-ignore`, or `@ts-nocheck` — fix findings in code (CLAUDE.md lint policy).
- React components stay presentation-focused; side effects belong in hooks (web quality gate).
- Delete dead code outright (no re-exports, no `@deprecated` markers) once a replacement lands in the same task.
- TDD: write the failing test before the implementation for every step that changes behavior.
- Run `npm run test:unit:web` (or a scoped `vitest run <path>` for faster iteration) after each task.
- This plan assumes the backend plan (`2026-07-01-learning-tab-backend-rewrite.md`) has shipped: `GET /memory/learning/candidates` and `GET /skills/proposals` return `{data, meta: {pagination, ...}}` and accept `page/search/sortBy/sortDir/status(csv)/...`; the new single/bulk reject/archive/promote/approve endpoints exist.

---

### Task 1: `DataTable` — `defaultFilterValues` + multiselect/date filter types

**Files:**

- Modify: `apps/web/src/components/ui/data-table/data-table.types.ts`
- Modify: `apps/web/src/components/ui/data-table/useDataTable.ts`
- Modify: `apps/web/src/components/ui/data-table/DataTableToolbar.tsx`
- Create: `apps/web/src/components/ui/data-table/DataTableToolbar.spec.tsx`
- Create: `apps/web/src/components/ui/data-table/useDataTable.filters.spec.tsx`

**Interfaces:**

- Produces: `FilterDef.type` widens from `"select"` to `"select" | "multiselect" | "date"`. `DataTableProps`/`UseDataTableOptions` gain an optional `defaultFilterValues?: Record<string, string>` used only when there's no URL state yet. `useDataTable`'s client-mode `computeClientResult` filter loop branches per `FilterDef.type` (multiselect: comma-split membership check; date: this filter's key is paired with a `${key}_to` companion key registered as a second `FilterDef`, and the range check is `value >= from && value <= to` — the toolbar renders these two side by side under one label). `DataTableToolbar` renders a checkbox-popover for `"multiselect"` and two `<input type="date">` elements for `"date"` filters instead of the existing `<Select>`. Consumed by Task 8/9 (Learning cards) and by the backend query params from the backend plan (comma-joined multiselect values match `?status=a,b`).

- [ ] **Step 1: Write the failing `useDataTable` tests**

```typescript
// apps/web/src/components/ui/data-table/useDataTable.filters.spec.tsx
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
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
          ],
        }),
      { wrapper },
    );

    result.current.setFilter("status", "pending,rejected");

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
            { key: "createdAt", label: "Created from", type: "date", options: [] },
            { key: "createdAt_to", label: "Created to", type: "date", options: [] },
          ],
        }),
      { wrapper },
    );

    result.current.setFilter("createdAt", "2026-06-10");
    result.current.setFilter("createdAt_to", "2026-06-20");

    expect(result.current.data.map((row) => row.id)).toEqual(["2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/components/ui/data-table/useDataTable.filters.spec.tsx`
Expected: FAIL — `computeClientResult` treats every filter as exact-string-equality

- [ ] **Step 3: Widen `FilterDef` and add `defaultFilterValues`**

In `apps/web/src/components/ui/data-table/data-table.types.ts`:

```typescript
export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "multiselect" | "date";
  options: { label: string; value: string }[];
}
```

Add `defaultFilterValues?: Record<string, string>;` to `DataTableProps<T>` (alongside `defaultSort`).

- [ ] **Step 4: Thread `filterType` lookup + branch the client-mode filter loop**

In `apps/web/src/components/ui/data-table/useDataTable.ts`, `computeClientResult` currently takes no knowledge of filter _types_ — add a `filters` parameter and branch:

```typescript
function computeClientResult<T>(
  rawData: T[],
  search: string,
  filterValues: Record<string, string>,
  filters: FilterDef[] | undefined,
  sortBy: string | undefined,
  sortDir: "asc" | "desc",
  page: number,
  limit: number,
): ListResponse<T> {
  let result = [...rawData];

  if (search) {
    const lower = search.toLowerCase();
    result = result.filter((item) =>
      Object.values(item as object).some(
        (v) => typeof v === "string" && v.toLowerCase().includes(lower),
      ),
    );
  }

  const filterTypeByKey = new Map(
    (filters ?? []).map((filter) => [filter.key, filter.type]),
  );

  for (const [key, value] of Object.entries(filterValues)) {
    if (value === "__all__" || value === "") continue;
    const type = filterTypeByKey.get(key) ?? "select";

    if (type === "multiselect") {
      const values = new Set(value.split(",").map((v) => v.trim()));
      result = result.filter((item) => {
        const itemVal = (item as Record<string, unknown>)[key];
        return typeof itemVal === "string" && values.has(itemVal);
      });
      continue;
    }

    if (type === "date") {
      if (key.endsWith("_to")) continue; // handled alongside its paired "from" key below
      const toValue = filterValues[`${key}_to`];
      result = result.filter((item) => {
        const itemVal = (item as Record<string, unknown>)[key];
        if (typeof itemVal !== "string") return false;
        if (itemVal < value) return false;
        if (toValue && itemVal > toValue) return false;
        return true;
      });
      continue;
    }

    result = result.filter((item) => {
      const itemVal = (item as Record<string, unknown>)[key];
      if (itemVal === null || itemVal === undefined) return false;
      if (typeof itemVal === "boolean") return String(itemVal) === value;
      return String(itemVal).toLowerCase() === value.toLowerCase();
    });
  }

  if (sortBy) {
    result.sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sortBy];
      const bVal = (b as Record<string, unknown>)[sortBy];
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return 1;
      if (bVal === null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, {
        numeric: true,
      });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const total = result.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const paged = result.slice(start, start + limit);

  return {
    data: paged,
    meta: { pagination: { total, page, limit, totalPages } },
  };
}
```

Update the single call site inside `useDataTable` (the `clientResult = useMemo(...)` block) to pass `options.filters` as the new 4th argument, shifting the rest along:

```typescript
const clientResult = useMemo(() => {
  if (mode !== "client" || !rawData) return null;
  return computeClientResult(
    rawData,
    search,
    filterValues,
    filters,
    sortBy,
    sortDir,
    page,
    limit,
  );
}, [
  mode,
  rawData,
  search,
  filterValues,
  filters,
  sortBy,
  sortDir,
  page,
  limit,
]);
```

(`filters` must be destructured from `options` at the top of `useDataTable` alongside `mode`/`data`/`fetchFn` — it already flows in as a parameter to `useDataTable`, just wasn't forwarded to `computeClientResult` before.)

- [ ] **Step 5: Wire `defaultFilterValues` into `resolveInitialState`**

```typescript
function resolveInitialState(
  defaultSort: string | undefined,
  defaultSortDir: "asc" | "desc",
  defaultFilterValues: Record<string, string> | undefined,
  initial: DataTableInitialState | undefined,
): DataTableInitialState {
  return {
    page: initial?.page ?? 1,
    search: initial?.search ?? "",
    sortBy: initial?.sortBy ?? defaultSort,
    sortDir: initial?.sortDir ?? defaultSortDir,
    filterValues: initial?.filterValues ?? defaultFilterValues ?? {},
  };
}
```

Thread `defaultFilterValues` through `useDataTableState`'s call to `resolveInitialState` and through the top-level `useDataTable` function's destructured options (mirroring how `defaultSort`/`defaultSortDir`/`defaultLimit` already flow in).

- [ ] **Step 6: Run the `useDataTable` filter tests to verify they pass**

Run: `npx vitest run apps/web/src/components/ui/data-table/useDataTable.filters.spec.tsx`
Expected: PASS

- [ ] **Step 7: Write the failing `DataTableToolbar` tests**

```typescript
// apps/web/src/components/ui/data-table/DataTableToolbar.spec.tsx
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

    fireEvent.click(screen.getByRole("button", { name: "Status" }));
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
```

- [ ] **Step 8: Run the toolbar tests to verify they fail**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTableToolbar.spec.tsx`
Expected: FAIL — `DataTableToolbar` only renders `<Select>` for every filter today

- [ ] **Step 9: Implement the toolbar UI**

```typescript
// apps/web/src/components/ui/data-table/DataTableToolbar.tsx
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { FilterDef } from "./data-table.types";

interface DataTableToolbarProps {
  searchInput: string;
  onSearch: (value: string) => void;
  filters?: FilterDef[];
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}

function MultiSelectFilter({
  filter,
  value,
  onChange,
}: Readonly<{
  filter: FilterDef;
  value: string;
  onChange: (value: string) => void;
}>) {
  const selected = new Set(value ? value.split(",") : []);

  function toggle(optionValue: string) {
    const next = new Set(selected);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    onChange([...next].join(","));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-[160px] justify-start">
          {filter.label}
          {selected.size > 0 ? ` (${String(selected.size)})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-2">
        {filter.options.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={`${filter.key}-${option.value}`}
              checked={selected.has(option.value)}
              onCheckedChange={() => {
                toggle(option.value);
              }}
            />
            <Label htmlFor={`${filter.key}-${option.value}`}>
              {option.label}
            </Label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DateRangeFilter({
  filter,
  filterValues,
  onFilterChange,
}: Readonly<{
  filter: FilterDef;
  filterValues: Record<string, string>;
  onFilterChange: (key: string, value: string) => void;
}>) {
  const toKey = `${filter.key}_to`;
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${filter.key}-from`}>{filter.label} from</Label>
        <Input
          id={`${filter.key}-from`}
          type="date"
          value={filterValues[filter.key] ?? ""}
          onChange={(e) => {
            onFilterChange(filter.key, e.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${filter.key}-to`}>{filter.label} to</Label>
        <Input
          id={`${filter.key}-to`}
          type="date"
          value={filterValues[toKey] ?? ""}
          onChange={(e) => {
            onFilterChange(toKey, e.target.value);
          }}
        />
      </div>
    </div>
  );
}

export function DataTableToolbar({
  searchInput,
  onSearch,
  filters,
  filterValues,
  onFilterChange,
}: DataTableToolbarProps) {
  const [localSearch, setLocalSearch] = useState(searchInput);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(localSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [localSearch, onSearch]);

  useEffect(() => {
    setLocalSearch(searchInput);
  }, [searchInput]);

  return (
    <div className="flex flex-wrap items-center gap-3 py-4">
      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      {filters
        ?.filter((filter) => !filter.key.endsWith("_to"))
        .map((filter) => {
          if (filter.type === "multiselect") {
            return (
              <MultiSelectFilter
                key={filter.key}
                filter={filter}
                value={filterValues[filter.key] ?? ""}
                onChange={(value) => {
                  onFilterChange(filter.key, value);
                }}
              />
            );
          }
          if (filter.type === "date") {
            return (
              <DateRangeFilter
                key={filter.key}
                filter={filter}
                filterValues={filterValues}
                onFilterChange={onFilterChange}
              />
            );
          }
          return (
            <Select
              key={filter.key}
              value={filterValues[filter.key] ?? "__all__"}
              onValueChange={(value) => onFilterChange(filter.key, value)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={filter.label} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All {filter.label}</SelectItem>
                {filter.options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        })}
    </div>
  );
}
```

Note the "date" branch's paired `${key}_to` `FilterDef` is filtered out of the render loop (`!filter.key.endsWith("_to")`) since `DateRangeFilter` renders both inputs for its base key — the paired `FilterDef` only exists so `useDataTable`'s `filterTypeByKey` lookup (Step 4) resolves `_to` as a `"date"` filter too. Consumers (Task 8/9) register the pair as two adjacent `FilterDef` entries with the same `label`.

- [ ] **Step 10: Run the toolbar tests to verify they pass**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTableToolbar.spec.tsx`
Expected: PASS

- [ ] **Step 11: Run the full data-table test directory to verify nothing broke**

Run: `npx vitest run apps/web/src/components/ui/data-table`
Expected: PASS (all files, including the pre-existing `useDataTable.url.spec.tsx`)

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table.types.ts apps/web/src/components/ui/data-table/useDataTable.ts apps/web/src/components/ui/data-table/DataTableToolbar.tsx apps/web/src/components/ui/data-table/DataTableToolbar.spec.tsx apps/web/src/components/ui/data-table/useDataTable.filters.spec.tsx
git commit -m "feat(web): add multiselect/date filter types and defaultFilterValues to DataTable"
```

---

### Task 2: `DataTable` — row selection + bulk-action bar

**Files:**

- Modify: `apps/web/src/components/ui/data-table/data-table.types.ts`
- Modify: `apps/web/src/components/ui/data-table/useDataTable.ts`
- Modify: `apps/web/src/components/ui/data-table/DataTable.tsx`
- Create: `apps/web/src/components/ui/data-table/DataTable.selection.spec.tsx`

**Interfaces:**

- Produces: `DataTableProps<T>` gains `enableSelection?: boolean` and `renderBulkActions?: (selected: T[]) => ReactNode`. `useDataTable` gains `selectedIds: Set<string>`, `toggleSelected(id: string)`, `toggleAllSelected(ids: string[])`, `clearSelection()`. `DataTable` renders a checkbox column (header checkbox = select-all-on-page) when `enableSelection` is true, and renders `renderBulkActions(selectedRows)` in a bar above the table whenever `selectedIds.size > 0`. Consumed by Task 8/9 (bulk reject/archive/promote/approve toolbars).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/components/ui/data-table/DataTable.selection.spec.tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTable.selection.spec.tsx`
Expected: FAIL — no selection support exists yet

- [ ] **Step 3: Add selection props to `DataTableProps`**

In `data-table.types.ts`, add to `DataTableProps<T>`:

```typescript
  enableSelection?: boolean;
  renderBulkActions?: (selected: T[]) => ReactNode;
```

(`ReactNode` is already imported in this file.)

- [ ] **Step 4: Add selection state to `useDataTable`**

In `useDataTable.ts`, add local selection state (reset whenever the page's row-id set changes, since selections shouldn't silently persist across an unrelated page/filter change) and return it from the hook:

```typescript
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

const toggleSelected = useCallback((id: string) => {
  setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
}, []);

const toggleAllSelected = useCallback((ids: string[]) => {
  setSelectedIds((prev) =>
    ids.every((id) => prev.has(id)) ? new Set() : new Set(ids),
  );
}, []);

const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
```

Add `selectedIds`, `toggleSelected`, `toggleAllSelected`, `clearSelection` to the object `useDataTable` returns.

- [ ] **Step 5: Render the selection column and bulk-action bar in `DataTable`**

In `DataTable.tsx`:

```typescript
import { Checkbox } from "@/components/ui/checkbox";
```

```typescript
export function DataTable<T extends { id?: string }>({
  mode,
  columns,
  filters,
  fetchFn,
  queryKey,
  data: rawData,
  defaultSort,
  defaultSortDir,
  defaultLimit,
  defaultFilterValues,
  urlKey,
  isLoading: externalLoading,
  emptyMessage = "No results found",
  onRowClick,
  enableSelection = false,
  renderBulkActions,
}: DataTableProps<T>) {
  const {
    data,
    meta,
    isLoading: internalLoading,
    setPage,
    setSort,
    setSearch,
    searchInput,
    setFilter,
    filterValues,
    sortBy,
    sortDir,
    selectedIds,
    toggleSelected,
    toggleAllSelected,
  } = useDataTable<T>({
    mode,
    columns,
    filters,
    data: rawData,
    fetchFn,
    queryKey,
    defaultSort,
    defaultSortDir,
    defaultLimit,
    defaultFilterValues,
    urlKey,
  });

  const isLoading = externalLoading ?? internalLoading;
  const rowIds = data.map((item, index) => item.id ?? `row-${index.toString()}`);
  const selectedRows = data.filter((item, index) =>
    selectedIds.has(item.id ?? `row-${index.toString()}`),
  );
  const allOnPageSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));

  const renderSortIcon = (columnKey: string) => {
    if (sortBy !== columnKey) return <ArrowUpDown className="ml-2 h-3 w-3" />;
    return sortDir === "asc" ? (
      <ArrowUp className="ml-2 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-2 h-3 w-3" />
    );
  };

  return (
    <div className="space-y-0">
      <DataTableToolbar
        searchInput={searchInput}
        onSearch={setSearch}
        filters={filters}
        filterValues={filterValues}
        onFilterChange={setFilter}
      />
      {enableSelection && selectedRows.length > 0 && renderBulkActions ? (
        <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 mb-2">
          {renderBulkActions(selectedRows)}
        </div>
      ) : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {enableSelection ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={allOnPageSelected}
                    onCheckedChange={() => {
                      toggleAllSelected(rowIds);
                    }}
                  />
                </TableHead>
              ) : null}
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={
                    col.sortable ? "cursor-pointer select-none" : col.className
                  }
                  onClick={() => col.sortable && setSort(col.key)}
                >
                  <div className="flex items-center">
                    {col.label}
                    {col.sortable && renderSortIcon(col.key)}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (enableSelection ? 1 : 0)}
                  className="text-center h-24"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length + (enableSelection ? 1 : 0)}
                  className="text-center h-24"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, index) => {
                const rowId = item.id ?? `row-${index.toString()}`;
                return (
                  <TableRow
                    key={rowId}
                    className={onRowClick ? "cursor-pointer" : undefined}
                    onClick={() => onRowClick?.(item)}
                  >
                    {enableSelection ? (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select row ${item.title as string}`}
                          checked={selectedIds.has(rowId)}
                          onCheckedChange={() => {
                            toggleSelected(rowId);
                          }}
                        />
                      </TableCell>
                    ) : null}
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.render
                          ? col.render(item)
                          : String(item[col.key] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination meta={meta} onPageChange={setPage} />
    </div>
  );
}
```

Note: `aria-label={`Select row ${item.title as string}`}` assumes `T` has a `title` field for the accessible label, which holds for both Learning cards (Task 8/9) — this is fine for this codebase's two upcoming consumers, but is a shortcut worth flagging: a more general solution would take a `getRowLabel?: (item: T) => string` prop. Since no other DataTable consumer uses selection yet, keep the shortcut for now rather than generalizing prematurely (YAGNI) — if the test in Step 1 fails because `Row` here has `title`, that's expected and matches this shortcut; if a future consumer's `T` lacks `title`, add `getRowLabel` then.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTable.selection.spec.tsx`
Expected: PASS

- [ ] **Step 7: Run the full data-table test directory to verify nothing broke**

Run: `npx vitest run apps/web/src/components/ui/data-table`
Expected: PASS (all files)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table.types.ts apps/web/src/components/ui/data-table/useDataTable.ts apps/web/src/components/ui/data-table/DataTable.tsx apps/web/src/components/ui/data-table/DataTable.selection.spec.tsx
git commit -m "feat(web): add row selection and bulk-action bar to DataTable"
```

---

### Task 3: `DataTable` — row expansion (`renderExpanded`)

**Files:**

- Modify: `apps/web/src/components/ui/data-table/data-table.types.ts`
- Modify: `apps/web/src/components/ui/data-table/DataTable.tsx`
- Create: `apps/web/src/components/ui/data-table/DataTable.expansion.spec.tsx`

**Interfaces:**

- Produces: `DataTableProps<T>` gains `renderExpanded?: (item: T) => ReactNode`. When set, each row gets a chevron toggle in its own leading column (or trailing, after selection) that reveals a full-width row below it. Consumed by Task 8/9 for the candidate/proposal timeline.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/components/ui/data-table/DataTable.expansion.spec.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTable.expansion.spec.tsx`
Expected: FAIL — no expansion toggle exists yet

- [ ] **Step 3: Add `renderExpanded` to `DataTableProps`**

In `data-table.types.ts`:

```typescript
  renderExpanded?: (item: T) => ReactNode;
```

- [ ] **Step 4: Implement the expand toggle + expanded row in `DataTable`**

In `DataTable.tsx`, import the chevron icons and add local state:

```typescript
import { ChevronDown, ChevronRight } from "lucide-react";
```

Add `renderExpanded` to the destructured props, and inside the component:

```typescript
const [expandedId, setExpandedId] = useState<string | null>(null);
```

(add `useState` to the existing React import line if not already imported in this file — `DataTable.tsx` today has no `useState`, so add `import { useState } from "react";`).

Add the toggle column (rendered before the selection column, if any) and the expanded row, inside the `<TableHeader>`'s `<TableRow>`:

```typescript
              {renderExpanded ? <TableHead className="w-10" /> : null}
```

and inside the body row map:

```typescript
              data.map((item, index) => {
                const rowId = item.id ?? `row-${index.toString()}`;
                const isExpanded = expandedId === rowId;
                return (
                  <>
                    <TableRow
                      key={rowId}
                      className={onRowClick ? "cursor-pointer" : undefined}
                      onClick={() => onRowClick?.(item)}
                    >
                      {renderExpanded ? (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            aria-label={
                              isExpanded
                                ? `Collapse row ${item.title as string}`
                                : `Expand row ${item.title as string}`
                            }
                            onClick={() =>
                              setExpandedId(isExpanded ? null : rowId)
                            }
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </TableCell>
                      ) : null}
                      {enableSelection ? (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select row ${item.title as string}`}
                            checked={selectedIds.has(rowId)}
                            onCheckedChange={() => {
                              toggleSelected(rowId);
                            }}
                          />
                        </TableCell>
                      ) : null}
                      {columns.map((col) => (
                        <TableCell key={col.key} className={col.className}>
                          {col.render
                            ? col.render(item)
                            : String(item[col.key] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                    {isExpanded && renderExpanded ? (
                      <TableRow key={`${rowId}-expanded`}>
                        <TableCell
                          colSpan={
                            columns.length +
                            (enableSelection ? 1 : 0) +
                            (renderExpanded ? 1 : 0)
                          }
                        >
                          {renderExpanded(item)}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </>
                );
              })
```

(The `<>...</>` fragment wraps the pair of table rows per data item since a `.map()` callback can only return one JSX node.) Same `item.title as string` shortcut as Task 2's selection checkbox — acceptable for now per the same reasoning.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/components/ui/data-table/DataTable.expansion.spec.tsx`
Expected: PASS

- [ ] **Step 6: Run the full data-table test directory to verify nothing broke**

Run: `npx vitest run apps/web/src/components/ui/data-table`
Expected: PASS (all files)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/data-table/data-table.types.ts apps/web/src/components/ui/data-table/DataTable.tsx apps/web/src/components/ui/data-table/DataTable.expansion.spec.tsx
git commit -m "feat(web): add per-row expansion slot to DataTable"
```

---

### Task 4: API types — new fields + paginated envelope + action request/response shapes

**Files:**

- Modify: `apps/web/src/lib/api/types.ts`

**Interfaces:**

- Produces: `LearningCandidate` gains `promoted_at: string | null`, `human_approved_at: string | null`, `first_seen_at: string`, `last_seen_at: string`, `rejected_at: string | null`, `rejected_by: string | null`, `rejection_reason: string | null`, `archived_at: string | null`, `archived_by: string | null`, `archive_reason: string | null`. `SkillImprovementProposal` gains `approved_at: string | null`, `approved_by: string | null`, `rejected_at: string | null`, `rejected_by: string | null`, `rejection_reason: string | null`. `LearningCandidateListResponse`/`SkillImprovementProposalListResponse` switch to `{data, meta: {pagination: PaginationMeta, ...}}`. `ListLearningCandidatesRequest`/`ListSkillImprovementProposalsRequest` widen to the new query shape. New: `RejectLearningCandidateRequest`, `ArchiveLearningCandidateRequest`, `BulkRejectLearningCandidatesRequest`, `BulkArchiveLearningCandidatesRequest`, `BulkPromoteLearningCandidatesRequest`, `BulkPromoteLearningCandidatesResult`, `BulkApproveSkillImprovementProposalsRequest`, `BulkRejectSkillImprovementProposalsRequest`. Consumed by Task 5 (API client), Task 6 (hooks), Task 8/9 (cards). This is a plain hand-maintained TypeScript mirror of the backend's `@nexus/core` contract (this codebase's existing convention — `apps/web` does not import `@nexus/core` schemas directly), so keep the shapes in exact lockstep with `packages/core/src/schemas/memory/learning-contracts.schema.ts` from the backend plan.

- [ ] **Step 1: Update `LearningCandidate` and `SkillImprovementProposal`**

Replace the existing `LearningCandidate` interface (around line 1283):

```typescript
export interface LearningCandidate extends Timestamps {
  id: string;
  scope_type: string;
  scope_id: string | null;
  candidate_type: string;
  title: string;
  summary: string;
  fingerprint: string;
  score: number;
  confidence: number;
  recurrence_count: number;
  signals_json: Record<string, unknown>;
  status: LearningCandidateStatus;
  promoted_at: string | null;
  human_approved_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
}
```

Replace the existing `SkillImprovementProposal` interface (around line 1306):

```typescript
export interface SkillImprovementProposal extends Timestamps {
  id: string;
  learning_candidate_id: string | null;
  target_skill_name: string;
  proposal_title: string;
  proposal_summary: string;
  status: SkillImprovementProposalStatus;
  generated_from_run_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  rejection_reason: string | null;
  applied_at: string | null;
  scope_confirmation: SkillProposalScopeConfirmation | null;
}
```

- [ ] **Step 2: Replace the list response envelopes**

```typescript
export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LearningCandidateListResponse {
  data: LearningCandidate[];
  meta: {
    pagination: PaginationMeta;
    suppressedCount: number;
  };
}

export interface SkillImprovementProposalListResponse {
  data: SkillImprovementProposal[];
  meta: {
    pagination: PaginationMeta;
  };
}
```

(If a `PaginationMeta` type already exists elsewhere in this file — e.g. reused by `GlobalWorkItemsPage`'s `PaginatedWorkItems` or `PaginatedResponse<T>` — reuse that one instead of declaring a duplicate; check for an existing `PaginationMeta`/`Pagination` export first with a quick search before adding a new one.)

- [ ] **Step 3: Widen the list request types + add the new action request/response types**

```typescript
export interface ListLearningCandidatesRequest {
  status?: string[];
  candidate_type?: string[];
  scope_type?: string;
  scope_id?: string;
  search?: string;
  min_score?: number;
  created_from?: string;
  created_to?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface ListSkillImprovementProposalsRequest {
  status?: string[];
  search?: string;
  created_from?: string;
  created_to?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface RejectLearningCandidateRequest {
  reason: string;
  rejected_by?: string;
}

export interface ArchiveLearningCandidateRequest {
  reason?: string;
  archived_by?: string;
}

export interface BulkRejectLearningCandidatesRequest {
  candidate_ids: string[];
  reason: string;
  rejected_by?: string;
}

export interface BulkArchiveLearningCandidatesRequest {
  candidate_ids: string[];
  reason?: string;
  archived_by?: string;
}

export interface BulkPromoteLearningCandidatesRequest {
  candidate_ids: string[];
  requested_by?: string;
}

export interface BulkPromoteLearningCandidatesResult {
  candidateId: string;
  result?: { candidate_id: string; memory_segment_id: string; status: string };
  error?: string;
}

export interface BulkApproveSkillImprovementProposalsRequest {
  proposal_ids: string[];
  approved_by?: string;
}

export interface BulkRejectSkillImprovementProposalsRequest {
  proposal_ids: string[];
  reason: string;
  rejected_by?: string;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run build --workspace=apps/web` (or the project's `typecheck` script if faster/available — check `apps/web/package.json`)
Expected: fails here with errors in `client.projects.learning.ts`, `client.projects.types.ts`, `useLearningMemory.ts`, `LearningTab.tsx`, and the two card components — these are fixed in Tasks 5, 6, 8, 9, 10. This step is a checkpoint, not a gate; do not attempt to fix downstream files yet.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/types.ts
git commit -m "feat(web): widen learning candidate/proposal types and paginated response envelope"
```

---

### Task 5: API client — new query shape, envelope, and lifecycle action methods

**Files:**

- Modify: `apps/web/src/lib/api/client.projects.types.ts`
- Modify: `apps/web/src/lib/api/client.projects.learning.ts`
- Create: `apps/web/src/lib/api/client.projects.learning.spec.ts`

**Interfaces:**

- Consumes: the types from Task 4.
- Produces: `getLearningCandidates`/`getSkillImprovementProposals` build the new query-param shape (comma-joined `status`, `page`, `search`, `sortBy`, `sortDir`, etc.) and return the `{data, meta}` envelope. New methods: `rejectLearningCandidate(candidateId, data)`, `archiveLearningCandidate(candidateId, data)`, `bulkRejectLearningCandidates(data)`, `bulkArchiveLearningCandidates(data)`, `bulkPromoteLearningCandidates(data)`, `bulkApproveSkillImprovementProposals(data)`, `bulkRejectSkillImprovementProposals(data)`. Consumed by Task 6 (hooks) and Task 8/9 (cards' `fetchFn`s call `getLearningCandidates`/`getSkillImprovementProposals` directly).

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/lib/api/client.projects.learning.spec.ts
import { describe, expect, it, vi } from "vitest";
import { projectLearningApiMethods } from "./client.projects.learning";
import type { ApiClient } from "./client";

function createClient() {
  const get = vi.fn().mockResolvedValue({});
  const post = vi.fn().mockResolvedValue({});
  return { get, post, ctx: { get, post } as unknown as ApiClient };
}

describe("projectLearningApiMethods", () => {
  it("builds a comma-joined status query and the new pagination params for candidates", async () => {
    const { get, ctx } = createClient();

    await projectLearningApiMethods.getLearningCandidates.call(ctx, {
      status: ["pending", "promoted"],
      candidate_type: ["agent_capture"],
      search: "flaky",
      min_score: 0.4,
      page: 2,
      limit: 25,
      sortBy: "score",
      sortDir: "desc",
    });

    expect(get).toHaveBeenCalledWith(
      "/memory/learning/candidates?status=pending%2Cpromoted&candidate_type=agent_capture&search=flaky&min_score=0.4&page=2&limit=25&sortBy=score&sortDir=desc",
    );
  });

  it("omits unset query params for candidates", async () => {
    const { get, ctx } = createClient();

    await projectLearningApiMethods.getLearningCandidates.call(ctx, {});

    expect(get).toHaveBeenCalledWith("/memory/learning/candidates");
  });

  it("builds the comma-joined status query for proposals", async () => {
    const { get, ctx } = createClient();

    await projectLearningApiMethods.getSkillImprovementProposals.call(ctx, {
      status: ["approved", "applied"],
      page: 1,
      limit: 10,
    });

    expect(get).toHaveBeenCalledWith(
      "/skills/proposals?status=approved%2Capplied&page=1&limit=10",
    );
  });

  it("rejects a learning candidate", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.rejectLearningCandidate.call(
      ctx,
      "candidate-1",
      { reason: "Not useful" },
    );

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/candidate-1/reject",
      { reason: "Not useful" },
    );
  });

  it("archives a learning candidate", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.archiveLearningCandidate.call(
      ctx,
      "candidate-1",
      {},
    );

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/candidate-1/archive",
      {},
    );
  });

  it("bulk rejects learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkRejectLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
      reason: "stale batch",
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-reject",
      { candidate_ids: ["c1"], reason: "stale batch" },
    );
  });

  it("bulk archives learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkArchiveLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-archive",
      { candidate_ids: ["c1"] },
    );
  });

  it("bulk promotes learning candidates", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkPromoteLearningCandidates.call(ctx, {
      candidate_ids: ["c1"],
    });

    expect(post).toHaveBeenCalledWith(
      "/memory/learning/candidates/bulk-promote",
      { candidate_ids: ["c1"] },
    );
  });

  it("bulk approves skill improvement proposals", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkApproveSkillImprovementProposals.call(
      ctx,
      { proposal_ids: ["p1"] },
    );

    expect(post).toHaveBeenCalledWith("/skills/proposals/bulk-approve", {
      proposal_ids: ["p1"],
    });
  });

  it("bulk rejects skill improvement proposals", async () => {
    const { post, ctx } = createClient();

    await projectLearningApiMethods.bulkRejectSkillImprovementProposals.call(
      ctx,
      { proposal_ids: ["p1"], reason: "duplicate batch" },
    );

    expect(post).toHaveBeenCalledWith("/skills/proposals/bulk-reject", {
      proposal_ids: ["p1"],
      reason: "duplicate batch",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/lib/api/client.projects.learning.spec.ts`
Expected: FAIL — module doesn't have the new query shape or methods yet

- [ ] **Step 3: Rewrite `client.projects.learning.ts`**

```typescript
import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  ArchiveLearningCandidateRequest,
  BulkApproveSkillImprovementProposalsRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkPromoteLearningCandidatesResult,
  BulkRejectLearningCandidatesRequest,
  BulkRejectSkillImprovementProposalsRequest,
  ConfirmSkillProposalScopeRequest,
  LearningCandidate,
  LearningCandidateListResponse,
  LearningSweepRunSummary,
  LearningSweepStatus,
  ListLearningCandidatesRequest,
  ListSkillImprovementProposalsRequest,
  RejectLearningCandidateRequest,
  SkillImprovementProposal,
  SkillImprovementProposalListResponse,
  SkillImprovementProposalPreview,
} from "./types";

type LearningProjectApiMethods = Pick<
  ApiClientProjectMethods,
  | "getLearningMemoryStatus"
  | "runLearningMemorySweep"
  | "getLearningCandidates"
  | "getSkillImprovementProposals"
  | "approveSkillImprovementProposal"
  | "rejectSkillImprovementProposal"
  | "confirmSkillImprovementProposalScope"
  | "getSkillImprovementProposalPreview"
  | "rejectLearningCandidate"
  | "archiveLearningCandidate"
  | "bulkRejectLearningCandidates"
  | "bulkArchiveLearningCandidates"
  | "bulkPromoteLearningCandidates"
  | "bulkApproveSkillImprovementProposals"
  | "bulkRejectSkillImprovementProposals"
>;

function appendListParams(
  query: URLSearchParams,
  params: Record<string, string | number | string[] | undefined>,
): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      query.append(key, value.join(","));
      continue;
    }
    query.append(key, String(value));
  }
}

export const projectLearningApiMethods: LearningProjectApiMethods = {
  async getLearningMemoryStatus(this: ApiClient) {
    return this.get<LearningSweepStatus>("/memory/learning/status");
  },

  async runLearningMemorySweep(this: ApiClient) {
    return this.post<LearningSweepRunSummary>("/memory/learning/run", {});
  },

  async getLearningCandidates(
    this: ApiClient,
    params?: ListLearningCandidatesRequest,
  ) {
    const query = new URLSearchParams();
    appendListParams(query, {
      status: params?.status,
      candidate_type: params?.candidate_type,
      scope_type: params?.scope_type,
      scope_id: params?.scope_id,
      search: params?.search,
      min_score: params?.min_score,
      created_from: params?.created_from,
      created_to: params?.created_to,
      page: params?.page,
      limit: params?.limit,
      sortBy: params?.sortBy,
      sortDir: params?.sortDir,
    });

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<LearningCandidateListResponse>(
      `/memory/learning/candidates${suffix}`,
    );
  },

  async getSkillImprovementProposals(
    this: ApiClient,
    params?: ListSkillImprovementProposalsRequest,
  ) {
    const query = new URLSearchParams();
    appendListParams(query, {
      status: params?.status,
      search: params?.search,
      created_from: params?.created_from,
      created_to: params?.created_to,
      page: params?.page,
      limit: params?.limit,
      sortBy: params?.sortBy,
      sortDir: params?.sortDir,
    });

    const suffix = query.toString().length > 0 ? `?${query.toString()}` : "";
    return this.get<SkillImprovementProposalListResponse>(
      `/skills/proposals${suffix}`,
    );
  },

  async approveSkillImprovementProposal(this: ApiClient, proposalId, data) {
    return this.post<SkillImprovementProposal>(
      `/skills/proposals/${proposalId}/approve`,
      data ?? {},
    );
  },

  async rejectSkillImprovementProposal(this: ApiClient, proposalId, data) {
    return this.post<SkillImprovementProposal>(
      `/skills/proposals/${proposalId}/reject`,
      data,
    );
  },

  async confirmSkillImprovementProposalScope(
    this: ApiClient,
    proposalId: string,
    data: ConfirmSkillProposalScopeRequest,
  ) {
    return this.post<SkillImprovementProposal>(
      `/skills/proposals/${proposalId}/confirm-scope`,
      data,
    );
  },

  async getSkillImprovementProposalPreview(
    this: ApiClient,
    proposalId: string,
  ) {
    return this.get<SkillImprovementProposalPreview>(
      `/skills/proposals/${proposalId}/preview`,
    );
  },

  async rejectLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: RejectLearningCandidateRequest,
  ) {
    return this.post<LearningCandidate>(
      `/memory/learning/candidates/${candidateId}/reject`,
      data,
    );
  },

  async archiveLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: ArchiveLearningCandidateRequest,
  ) {
    return this.post<LearningCandidate>(
      `/memory/learning/candidates/${candidateId}/archive`,
      data,
    );
  },

  async bulkRejectLearningCandidates(
    this: ApiClient,
    data: BulkRejectLearningCandidatesRequest,
  ) {
    return this.post<LearningCandidate[]>(
      "/memory/learning/candidates/bulk-reject",
      data,
    );
  },

  async bulkArchiveLearningCandidates(
    this: ApiClient,
    data: BulkArchiveLearningCandidatesRequest,
  ) {
    return this.post<LearningCandidate[]>(
      "/memory/learning/candidates/bulk-archive",
      data,
    );
  },

  async bulkPromoteLearningCandidates(
    this: ApiClient,
    data: BulkPromoteLearningCandidatesRequest,
  ) {
    return this.post<BulkPromoteLearningCandidatesResult[]>(
      "/memory/learning/candidates/bulk-promote",
      data,
    );
  },

  async bulkApproveSkillImprovementProposals(
    this: ApiClient,
    data: BulkApproveSkillImprovementProposalsRequest,
  ) {
    return this.post<SkillImprovementProposal[]>(
      "/skills/proposals/bulk-approve",
      data,
    );
  },

  async bulkRejectSkillImprovementProposals(
    this: ApiClient,
    data: BulkRejectSkillImprovementProposalsRequest,
  ) {
    return this.post<SkillImprovementProposal[]>(
      "/skills/proposals/bulk-reject",
      data,
    );
  },
};
```

Check how `this.get<T>`/`this.post<T>` unwrap the `{success, data}` envelope the backend controllers return (Task 15/16 of the backend plan wrap everything in `{success: true, data: ...}`) — if `ApiClient.get`/`.post` already unwrap `.data` generically (likely, since the existing `approve`/`reject` methods above return `SkillImprovementProposal` directly, not `{success, data}`), no extra unwrapping is needed here; the bulk methods returning `LearningCandidate[]`/`SkillImprovementProposal[]`/`BulkPromoteLearningCandidatesResult[]` follow the same convention.

- [ ] **Step 4: Add the new method signatures to `ApiClientProjectMethods`**

In `apps/web/src/lib/api/client.projects.types.ts`, add alongside the existing `getSkillImprovementProposalPreview` declaration:

```typescript
  rejectLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: RejectLearningCandidateRequest,
  ): Promise<LearningCandidate>;
  archiveLearningCandidate(
    this: ApiClient,
    candidateId: string,
    data: ArchiveLearningCandidateRequest,
  ): Promise<LearningCandidate>;
  bulkRejectLearningCandidates(
    this: ApiClient,
    data: BulkRejectLearningCandidatesRequest,
  ): Promise<LearningCandidate[]>;
  bulkArchiveLearningCandidates(
    this: ApiClient,
    data: BulkArchiveLearningCandidatesRequest,
  ): Promise<LearningCandidate[]>;
  bulkPromoteLearningCandidates(
    this: ApiClient,
    data: BulkPromoteLearningCandidatesRequest,
  ): Promise<BulkPromoteLearningCandidatesResult[]>;
  bulkApproveSkillImprovementProposals(
    this: ApiClient,
    data: BulkApproveSkillImprovementProposalsRequest,
  ): Promise<SkillImprovementProposal[]>;
  bulkRejectSkillImprovementProposals(
    this: ApiClient,
    data: BulkRejectSkillImprovementProposalsRequest,
  ): Promise<SkillImprovementProposal[]>;
```

Add the corresponding type imports (`RejectLearningCandidateRequest`, `ArchiveLearningCandidateRequest`, `BulkRejectLearningCandidatesRequest`, `BulkArchiveLearningCandidatesRequest`, `BulkPromoteLearningCandidatesRequest`, `BulkPromoteLearningCandidatesResult`, `BulkApproveSkillImprovementProposalsRequest`, `BulkRejectSkillImprovementProposalsRequest`) to this file's existing `import type { ... } from "./types"` block.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/lib/api/client.projects.learning.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/api/client.projects.types.ts apps/web/src/lib/api/client.projects.learning.ts apps/web/src/lib/api/client.projects.learning.spec.ts
git commit -m "feat(web): rewrite learning API client onto new query shape, add lifecycle action methods"
```

---

### Task 6: Hooks — delete dead list hooks, add lifecycle action hooks

**Files:**

- Modify: `apps/web/src/hooks/useLearningMemory.ts`

**Interfaces:**

- Consumes: the new API client methods (Task 5).
- Produces: `useLearningCandidates`/`useSkillImprovementProposals` (the list-fetching `useQuery` hooks) are **deleted** — Task 8/9's `DataTable`-driven cards call `api.getLearningCandidates`/`api.getSkillImprovementProposals` directly inside their own `fetchFn`, matching `Workflows.tsx`'s pattern, so these hooks have no remaining caller. New mutation hooks: `useRejectLearningCandidate`, `useArchiveLearningCandidate`, `useBulkRejectLearningCandidates`, `useBulkArchiveLearningCandidates`, `useBulkPromoteLearningCandidates`, `useBulkApproveSkillImprovementProposals`, `useBulkRejectSkillImprovementProposals` — each invalidates `queryKeys.learning.candidates()`/`.proposals()` on success, same pattern as `useApproveSkillImprovementProposal`. Consumed by Task 8/9.

This task has no dedicated spec file today (`useLearningMemory.spec.ts` doesn't exist) — the existing coverage is indirect, through `LearningTab.spec.tsx`'s hook mocks. Since Task 10 rewrites `LearningTab.spec.tsx` entirely once the cards absorb this hook usage, write a small direct spec file here instead of relying on that indirection.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/hooks/useLearningMemory.spec.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useArchiveLearningCandidate,
  useBulkApproveSkillImprovementProposals,
  useBulkArchiveLearningCandidates,
  useBulkPromoteLearningCandidates,
  useBulkRejectLearningCandidates,
  useBulkRejectSkillImprovementProposals,
  useRejectLearningCandidate,
} from "./useLearningMemory";

vi.mock("@/lib/api/client", () => ({
  api: {
    rejectLearningCandidate: vi.fn().mockResolvedValue({ id: "c1" }),
    archiveLearningCandidate: vi.fn().mockResolvedValue({ id: "c1" }),
    bulkRejectLearningCandidates: vi.fn().mockResolvedValue([{ id: "c1" }]),
    bulkArchiveLearningCandidates: vi.fn().mockResolvedValue([{ id: "c1" }]),
    bulkPromoteLearningCandidates: vi
      .fn()
      .mockResolvedValue([{ candidateId: "c1", result: { status: "promoted" } }]),
    bulkApproveSkillImprovementProposals: vi
      .fn()
      .mockResolvedValue([{ id: "p1" }]),
    bulkRejectSkillImprovementProposals: vi
      .fn()
      .mockResolvedValue([{ id: "p1" }]),
  },
}));

import { api } from "@/lib/api/client";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("learning candidate/proposal lifecycle mutation hooks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useRejectLearningCandidate calls the API with candidateId + body", async () => {
    const { result } = renderHook(() => useRejectLearningCandidate(), {
      wrapper,
    });

    await result.current.mutateAsync({
      candidateId: "c1",
      reason: "Not useful",
      rejectedBy: "reviewer-1",
    });

    expect(api.rejectLearningCandidate).toHaveBeenCalledWith("c1", {
      reason: "Not useful",
      rejected_by: "reviewer-1",
    });
  });

  it("useArchiveLearningCandidate calls the API with candidateId + body", async () => {
    const { result } = renderHook(() => useArchiveLearningCandidate(), {
      wrapper,
    });

    await result.current.mutateAsync({ candidateId: "c1" });

    expect(api.archiveLearningCandidate).toHaveBeenCalledWith("c1", {
      reason: undefined,
      archived_by: undefined,
    });
  });

  it("useBulkRejectLearningCandidates passes candidate_ids/reason through", async () => {
    const { result } = renderHook(() => useBulkRejectLearningCandidates(), {
      wrapper,
    });

    await result.current.mutateAsync({
      candidateIds: ["c1"],
      reason: "stale batch",
    });

    expect(api.bulkRejectLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      reason: "stale batch",
      rejected_by: undefined,
    });
  });

  it("useBulkArchiveLearningCandidates passes candidate_ids through", async () => {
    const { result } = renderHook(() => useBulkArchiveLearningCandidates(), {
      wrapper,
    });

    await result.current.mutateAsync({ candidateIds: ["c1"] });

    expect(api.bulkArchiveLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      reason: undefined,
      archived_by: undefined,
    });
  });

  it("useBulkPromoteLearningCandidates passes candidate_ids through", async () => {
    const { result } = renderHook(() => useBulkPromoteLearningCandidates(), {
      wrapper,
    });

    const response = await result.current.mutateAsync({ candidateIds: ["c1"] });

    expect(api.bulkPromoteLearningCandidates).toHaveBeenCalledWith({
      candidate_ids: ["c1"],
      requested_by: undefined,
    });
    expect(response).toEqual([
      { candidateId: "c1", result: { status: "promoted" } },
    ]);
  });

  it("useBulkApproveSkillImprovementProposals passes proposal_ids through", async () => {
    const { result } = renderHook(
      () => useBulkApproveSkillImprovementProposals(),
      { wrapper },
    );

    await result.current.mutateAsync({ proposalIds: ["p1"] });

    expect(api.bulkApproveSkillImprovementProposals).toHaveBeenCalledWith({
      proposal_ids: ["p1"],
      approved_by: undefined,
    });
  });

  it("useBulkRejectSkillImprovementProposals passes proposal_ids/reason through", async () => {
    const { result } = renderHook(
      () => useBulkRejectSkillImprovementProposals(),
      { wrapper },
    );

    await result.current.mutateAsync({
      proposalIds: ["p1"],
      reason: "duplicate batch",
    });

    expect(api.bulkRejectSkillImprovementProposals).toHaveBeenCalledWith({
      proposal_ids: ["p1"],
      reason: "duplicate batch",
      rejected_by: undefined,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/hooks/useLearningMemory.spec.ts`
Expected: FAIL — the new hooks don't exist yet

- [ ] **Step 3: Delete the dead list hooks and add the new mutation hooks**

In `apps/web/src/hooks/useLearningMemory.ts`, delete entirely: `DEFAULT_PAGE_LIMIT`, `DEFAULT_PAGE_OFFSET`, `normalizeLearningCandidateParams`, `normalizeSkillProposalParams`, `useLearningCandidates`, `useSkillImprovementProposals` (their only caller, `LearningTab.tsx`, is rewritten in Task 10 to no longer call them).

Add the new mutation hooks (after `useConfirmSkillImprovementProposalScope`, before `useSkillImprovementProposalPreview`):

```typescript
export function useRejectLearningCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateId: string;
      reason: string;
      rejectedBy?: string;
    }) =>
      api.rejectLearningCandidate(params.candidateId, {
        reason: params.reason,
        rejected_by: params.rejectedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useArchiveLearningCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateId: string;
      reason?: string;
      archivedBy?: string;
    }) =>
      api.archiveLearningCandidate(params.candidateId, {
        reason: params.reason,
        archived_by: params.archivedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkRejectLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateIds: string[];
      reason: string;
      rejectedBy?: string;
    }) =>
      api.bulkRejectLearningCandidates({
        candidate_ids: params.candidateIds,
        reason: params.reason,
        rejected_by: params.rejectedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkArchiveLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      candidateIds: string[];
      reason?: string;
      archivedBy?: string;
    }) =>
      api.bulkArchiveLearningCandidates({
        candidate_ids: params.candidateIds,
        reason: params.reason,
        archived_by: params.archivedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkPromoteLearningCandidates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { candidateIds: string[]; requestedBy?: string }) =>
      api.bulkPromoteLearningCandidates({
        candidate_ids: params.candidateIds,
        requested_by: params.requestedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningCandidates(queryClient),
      ]);
    },
  });
}

export function useBulkApproveSkillImprovementProposals() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { proposalIds: string[]; approvedBy?: string }) =>
      api.bulkApproveSkillImprovementProposals({
        proposal_ids: params.proposalIds,
        approved_by: params.approvedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningProposals(queryClient),
      ]);
    },
  });
}

export function useBulkRejectSkillImprovementProposals() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      proposalIds: string[];
      reason: string;
      rejectedBy?: string;
    }) =>
      api.bulkRejectSkillImprovementProposals({
        proposal_ids: params.proposalIds,
        reason: params.reason,
        rejected_by: params.rejectedBy,
      }),
    onSuccess: async () => {
      await Promise.all([
        invalidateLearningStatus(queryClient),
        invalidateLearningProposals(queryClient),
      ]);
    },
  });
}
```

Remove the now-unused `ListLearningCandidatesRequest`/`ListSkillImprovementProposalsRequest`/`LearningCandidateStatus`/`SkillImprovementProposalStatus` imports if nothing else in this file still references them (the deleted hooks were their only consumers here) — double check before removing, since `queryKeys.learning.candidates`/`.proposals` calls still need _some_ argument shape; if `queryKeys.ts` expects a specific param object for cache-key purposes, keep whichever import that requires.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/hooks/useLearningMemory.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/hooks/useLearningMemory.ts apps/web/src/hooks/useLearningMemory.spec.ts
git commit -m "feat(web): replace dead learning list hooks with reject/archive/bulk mutation hooks"
```

---

### Task 7: "New since last visit" + "stale" client-side helpers

**Files:**

- Create: `apps/web/src/pages/project-workspace/learningTabRecency.ts`
- Create: `apps/web/src/pages/project-workspace/learningTabRecency.spec.ts`

**Interfaces:**

- Produces: `getLastViewedAt(projectId: string): string | null`, `markViewedNow(projectId: string): void` (localStorage-backed, per-project key, matching the existing `useLocalStorage`/`localStorage.getItem` convention in this codebase), `isNewSinceLastVisit(timestamp: string, lastViewedAt: string | null): boolean`, `isStalePending(status: string, createdAt: string, now: Date, staleDays?: number): boolean` (defaults to 7 days per the design spec). Consumed by Task 8/9's column renderers.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/pages/project-workspace/learningTabRecency.spec.ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastViewedAt,
  isNewSinceLastVisit,
  isStalePending,
  markViewedNow,
} from "./learningTabRecency";

describe("learningTabRecency", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns null when nothing has been viewed yet", () => {
    expect(getLastViewedAt("project-1")).toBeNull();
  });

  it("stores and retrieves a per-project last-viewed timestamp", () => {
    markViewedNow("project-1");

    const lastViewed = getLastViewedAt("project-1");
    expect(lastViewed).not.toBeNull();
    expect(new Date(lastViewed as string).getTime()).not.toBeNaN();
  });

  it("keeps last-viewed timestamps independent per project", () => {
    markViewedNow("project-1");

    expect(getLastViewedAt("project-2")).toBeNull();
  });

  describe("isNewSinceLastVisit", () => {
    it("is true when there is no prior visit at all", () => {
      expect(isNewSinceLastVisit("2026-06-30T00:00:00.000Z", null)).toBe(true);
    });

    it("is true when the item's timestamp is after the last visit", () => {
      expect(
        isNewSinceLastVisit(
          "2026-06-30T00:00:00.000Z",
          "2026-06-29T00:00:00.000Z",
        ),
      ).toBe(true);
    });

    it("is false when the item's timestamp is before the last visit", () => {
      expect(
        isNewSinceLastVisit(
          "2026-06-28T00:00:00.000Z",
          "2026-06-29T00:00:00.000Z",
        ),
      ).toBe(false);
    });
  });

  describe("isStalePending", () => {
    const now = new Date("2026-07-10T00:00:00.000Z");

    it("is true when a pending item is older than 7 days by default", () => {
      expect(isStalePending("pending", "2026-07-01T00:00:00.000Z", now)).toBe(
        true,
      );
    });

    it("is false when a pending item is within 7 days", () => {
      expect(isStalePending("pending", "2026-07-05T00:00:00.000Z", now)).toBe(
        false,
      );
    });

    it("is false for non-pending statuses regardless of age", () => {
      expect(isStalePending("rejected", "2026-06-01T00:00:00.000Z", now)).toBe(
        false,
      );
    });

    it("respects a custom staleDays threshold", () => {
      expect(
        isStalePending("pending", "2026-07-08T00:00:00.000Z", now, 1),
      ).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/pages/project-workspace/learningTabRecency.spec.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/pages/project-workspace/learningTabRecency.ts
const LAST_VIEWED_KEY_PREFIX = "nexus_learning_tab_last_viewed_";
const DEFAULT_STALE_DAYS = 7;

function lastViewedKey(projectId: string): string {
  return `${LAST_VIEWED_KEY_PREFIX}${projectId}`;
}

export function getLastViewedAt(projectId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(lastViewedKey(projectId));
}

export function markViewedNow(projectId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    lastViewedKey(projectId),
    new Date().toISOString(),
  );
}

export function isNewSinceLastVisit(
  timestamp: string,
  lastViewedAt: string | null,
): boolean {
  if (!lastViewedAt) {
    return true;
  }
  return new Date(timestamp).getTime() > new Date(lastViewedAt).getTime();
}

export function isStalePending(
  status: string,
  createdAt: string,
  now: Date,
  staleDays: number = DEFAULT_STALE_DAYS,
): boolean {
  if (status !== "pending") {
    return false;
  }
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/pages/project-workspace/learningTabRecency.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/learningTabRecency.ts apps/web/src/pages/project-workspace/learningTabRecency.spec.ts
git commit -m "feat(web): add new-since-last-visit and stale-pending helpers for the Learning tab"
```

---

### Task 8: `LearningTabCandidatesCard` — migrate onto `DataTable`

**Files:**

- Modify: `apps/web/src/pages/project-workspace/LearningTabCandidatesCard.tsx`
- Modify: `apps/web/src/pages/project-workspace/LearningTab.types.ts` (drop the now-obsolete `LearningTabCandidatesCardProps`)
- Modify: `apps/web/src/pages/project-workspace/LearningTab.helpers.ts` (drop `toLearningCandidateStatus`, now unused — status is a multiselect `FilterDef`, not a single mapped value)
- Rewrite: `apps/web/src/pages/project-workspace/LearningTabCandidatesCard.spec.tsx`

**Interfaces:**

- Consumes: `DataTable` (Tasks 1–3), `api.getLearningCandidates` (Task 5), `useRejectLearningCandidate`/`useArchiveLearningCandidate`/`useBulkRejectLearningCandidates`/`useBulkArchiveLearningCandidates`/`useBulkPromoteLearningCandidates` (Task 6), `getLastViewedAt`/`markViewedNow`/`isNewSinceLastVisit`/`isStalePending` (Task 7).
- Produces: `LearningTabCandidatesCard` becomes a zero-prop component (`export function LearningTabCandidatesCard(): ReactNode`) — no more `items`/`isLoading`/`statusFilter`/`onStatusFilterChange`/`suppressedCount` props; it fetches and renders itself. Consumed by Task 10 (`LearningTab.tsx` now renders `<LearningTabCandidatesCard />` with no props).

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/pages/project-workspace/LearningTabCandidatesCard.spec.tsx` entirely:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LearningCandidate } from "@/lib/api/types";
import { LearningTabCandidatesCard } from "./LearningTabCandidatesCard";

const apiMock = vi.hoisted(() => ({
  getLearningCandidates: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

const mutationsMock = vi.hoisted(() => ({
  rejectMutateAsync: vi.fn(),
  archiveMutateAsync: vi.fn(),
  bulkRejectMutateAsync: vi.fn(),
  bulkArchiveMutateAsync: vi.fn(),
  bulkPromoteMutateAsync: vi.fn(),
}));
vi.mock("@/hooks/useLearningMemory", () => ({
  useRejectLearningCandidate: () => ({
    mutateAsync: mutationsMock.rejectMutateAsync,
    isPending: false,
  }),
  useArchiveLearningCandidate: () => ({
    mutateAsync: mutationsMock.archiveMutateAsync,
    isPending: false,
  }),
  useBulkRejectLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkRejectMutateAsync,
    isPending: false,
  }),
  useBulkArchiveLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkArchiveMutateAsync,
    isPending: false,
  }),
  useBulkPromoteLearningCandidates: () => ({
    mutateAsync: mutationsMock.bulkPromoteMutateAsync,
    isPending: false,
  }),
}));

function makeCandidate(
  overrides: Partial<LearningCandidate> & { id: string; title: string },
): LearningCandidate {
  return {
    scope_type: "global",
    scope_id: null,
    candidate_type: "retrospective",
    summary: "A test summary",
    fingerprint: `fp-${overrides.id}`,
    score: 0.5,
    confidence: 0.5,
    recurrence_count: 1,
    signals_json: {},
    status: "pending",
    promoted_at: null,
    human_approved_at: null,
    first_seen_at: "2026-06-01T00:00:00.000Z",
    last_seen_at: "2026-06-01T00:00:00.000Z",
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    archived_at: null,
    archived_by: null,
    archive_reason: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/project-1/board"]}>
        <LearningTabCandidatesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LearningTabCandidatesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    apiMock.getLearningCandidates.mockResolvedValue({
      data: [makeCandidate({ id: "c1", title: "Avoid N+1 query pattern" })],
      meta: {
        pagination: { total: 1, page: 1, limit: 25, totalPages: 1 },
        suppressedCount: 0,
      },
    });
  });

  it("fetches candidates itself and renders the result", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });
    expect(apiMock.getLearningCandidates).toHaveBeenCalled();
  });

  it("defaults the status filter to pending and promoted", async () => {
    renderCard();

    await waitFor(() => {
      expect(apiMock.getLearningCandidates).toHaveBeenCalledWith(
        expect.objectContaining({ status: ["pending", "promoted"] }),
      );
    });
  });

  it("rejects a candidate via the inline action, requiring a reason", async () => {
    mutationsMock.rejectMutateAsync.mockResolvedValue({ id: "c1" });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reject candidate c1" }));
    fireEvent.change(screen.getByLabelText("Rejection reason"), {
      target: { value: "Not useful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));

    await waitFor(() => {
      expect(mutationsMock.rejectMutateAsync).toHaveBeenCalledWith({
        candidateId: "c1",
        reason: "Not useful",
        rejectedBy: undefined,
      });
    });
  });

  it("bulk archives selected candidates", async () => {
    mutationsMock.bulkArchiveMutateAsync.mockResolvedValue([{ id: "c1" }]);
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Avoid N+1 query pattern",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive selected" }));

    await waitFor(() => {
      expect(mutationsMock.bulkArchiveMutateAsync).toHaveBeenCalledWith({
        candidateIds: ["c1"],
      });
    });
  });

  it("expands a row to show the candidate timeline", async () => {
    renderCard();

    await waitFor(() => {
      expect(screen.getByText("Avoid N+1 query pattern")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Expand row Avoid N+1 query pattern",
      }),
    );

    expect(screen.getByText(/First seen/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTabCandidatesCard.spec.tsx`
Expected: FAIL — the component still takes `items`/`isLoading` props and renders bespoke cards, not `DataTable`

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/pages/project-workspace/LearningTabCandidatesCard.tsx
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import type {
  ColumnDef,
  FilterDef,
  ListQuery,
  ListResponse,
} from "@/components/ui/data-table";
import { formatDateTimeSafe, formatDistanceToNowSafe } from "@/lib/utils";
import { api } from "@/lib/api/client";
import {
  useArchiveLearningCandidate,
  useBulkArchiveLearningCandidates,
  useBulkPromoteLearningCandidates,
  useBulkRejectLearningCandidates,
  useRejectLearningCandidate,
} from "@/hooks/useLearningMemory";
import type { LearningCandidate } from "@/lib/api/types";
import {
  candidateStatusBadgeVariant,
  formatLearningScopeLabel,
  formatLearningPercent,
  formatLearningScore,
} from "./LearningTab.helpers";
import { getLastViewedAt, isNewSinceLastVisit, isStalePending } from "./learningTabRecency";

const CANDIDATE_STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  type: "multiselect",
  options: [
    { label: "Pending", value: "pending" },
    { label: "Promoted", value: "promoted" },
    { label: "Rejected", value: "rejected" },
    { label: "Archived", value: "archived" },
  ],
};

const CANDIDATE_TYPE_FILTER: FilterDef = {
  key: "candidate_type",
  label: "Type",
  type: "select",
  options: [
    { label: "Agent capture", value: "agent_capture" },
    { label: "Retrospective", value: "retrospective" },
    { label: "Global memory", value: "global_memory" },
    { label: "Runtime learning", value: "runtime_learning" },
  ],
};

const CANDIDATE_DATE_FILTER: FilterDef = {
  key: "created_from",
  label: "Created",
  type: "date",
  options: [],
};

const CANDIDATE_DATE_FILTER_TO: FilterDef = {
  key: "created_from_to",
  label: "Created",
  type: "date",
  options: [],
};

async function fetchCandidatesPage(
  query: ListQuery & Record<string, unknown>,
): Promise<ListResponse<LearningCandidate>> {
  const response = await api.getLearningCandidates({
    status: typeof query.status === "string" ? query.status.split(",") : undefined,
    candidate_type:
      typeof query.candidate_type === "string" ? [query.candidate_type] : undefined,
    search: query.search,
    created_from: query.created_from as string | undefined,
    created_to: query.created_from_to as string | undefined,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  });

  return {
    data: response.data,
    meta: { pagination: response.meta.pagination },
  };
}

function CandidateTimeline({ candidate }: Readonly<{ candidate: LearningCandidate }>) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>First seen: {formatDateTimeSafe(candidate.first_seen_at)}</p>
      <p>Last seen: {formatDateTimeSafe(candidate.last_seen_at)}</p>
      {candidate.promoted_at ? (
        <p>Promoted: {formatDateTimeSafe(candidate.promoted_at)}</p>
      ) : null}
      {candidate.rejected_at ? (
        <p>
          Rejected: {formatDateTimeSafe(candidate.rejected_at)}
          {candidate.rejected_by ? ` by ${candidate.rejected_by}` : ""}
          {candidate.rejection_reason ? ` — ${candidate.rejection_reason}` : ""}
        </p>
      ) : null}
      {candidate.archived_at ? (
        <p>
          Archived: {formatDateTimeSafe(candidate.archived_at)}
          {candidate.archived_by ? ` by ${candidate.archived_by}` : ""}
          {candidate.archive_reason ? ` — ${candidate.archive_reason}` : ""}
        </p>
      ) : null}
    </div>
  );
}

interface RejectFormProps {
  candidate: LearningCandidate;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function RejectForm({ candidate, onCancel, onConfirm }: Readonly<RejectFormProps>) {
  const [reason, setReason] = useState("");

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`reject-reason-${candidate.id}`} className="sr-only">
        Rejection reason
      </label>
      <Input
        id={`reject-reason-${candidate.id}`}
        aria-label="Rejection reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason"
        className="h-8 w-40"
      />
      <Button size="sm" variant="destructive" onClick={() => onConfirm(reason)} aria-label="Confirm reject">
        Confirm
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export function LearningTabCandidatesCard() {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const rejectMutation = useRejectLearningCandidate();
  const archiveMutation = useArchiveLearningCandidate();
  const bulkRejectMutation = useBulkRejectLearningCandidates();
  const bulkArchiveMutation = useBulkArchiveLearningCandidates();
  const bulkPromoteMutation = useBulkPromoteLearningCandidates();
  const lastViewedAt = getLastViewedAt("current");
  const now = new Date();

  const columns: ColumnDef<LearningCandidate>[] = [
    {
      key: "title",
      label: "Title",
      sortable: true,
      render: (candidate) => (
        <div className="flex items-center gap-2">
          <span>{candidate.title}</span>
          {isNewSinceLastVisit(candidate.created_at, lastViewedAt) ? (
            <Badge variant="secondary">New</Badge>
          ) : null}
          {isStalePending(candidate.status, candidate.created_at, now) ? (
            <Badge variant="outline">Stale</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (candidate) => (
        <Badge variant={candidateStatusBadgeVariant(candidate.status)}>
          {candidate.status}
        </Badge>
      ),
    },
    {
      key: "scope_type",
      label: "Scope",
      render: (candidate) => (
        <Badge variant="outline">{formatLearningScopeLabel({ candidate })}</Badge>
      ),
    },
    {
      key: "score",
      label: "Score",
      sortable: true,
      render: (candidate) => formatLearningScore(candidate.score),
    },
    {
      key: "confidence",
      label: "Confidence",
      render: (candidate) => formatLearningPercent(candidate.confidence),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      className: "text-xs text-muted-foreground",
      render: (candidate) => formatDistanceToNowSafe(candidate.created_at, "—"),
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (candidate) => {
        if (candidate.status !== "pending") {
          return null;
        }
        if (rejectingId === candidate.id) {
          return (
            <RejectForm
              candidate={candidate}
              onCancel={() => setRejectingId(null)}
              onConfirm={(reason) => {
                void rejectMutation.mutateAsync({
                  candidateId: candidate.id,
                  reason,
                  rejectedBy: undefined,
                });
                setRejectingId(null);
              }}
            />
          );
        }
        return (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`Reject candidate ${candidate.id}`}
              onClick={() => setRejectingId(candidate.id)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void archiveMutation.mutateAsync({ candidateId: candidate.id })
              }
            >
              Archive
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning Candidates</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable<LearningCandidate>
          mode="server"
          urlKey="lc"
          queryKey={["learning-candidates"]}
          fetchFn={fetchCandidatesPage}
          columns={columns}
          filters={[
            CANDIDATE_STATUS_FILTER,
            CANDIDATE_TYPE_FILTER,
            CANDIDATE_DATE_FILTER,
            CANDIDATE_DATE_FILTER_TO,
          ]}
          defaultFilterValues={{ status: "pending,promoted" }}
          defaultSort="score"
          defaultSortDir="desc"
          enableSelection
          renderExpanded={(candidate) => <CandidateTimeline candidate={candidate} />}
          renderBulkActions={(selected) => (
            <>
              <span className="text-sm">{selected.length} selected</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void bulkRejectMutation.mutateAsync({
                    candidateIds: selected.map((c) => c.id),
                    reason: "Bulk rejected",
                  })
                }
              >
                Reject selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label="Archive selected"
                onClick={() =>
                  void bulkArchiveMutation.mutateAsync({
                    candidateIds: selected.map((c) => c.id),
                  })
                }
              >
                Archive selected
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  void bulkPromoteMutation.mutateAsync({
                    candidateIds: selected.map((c) => c.id),
                  })
                }
              >
                Promote selected
              </Button>
            </>
          )}
          emptyMessage="No learning candidates found for this filter."
        />
      </CardContent>
    </Card>
  );
}
```

Note: this drops the "bulk reject requires a reason" UX nuance from the design spec's single-item reject flow — the bulk toolbar's `"Bulk rejected"` fixed reason is a placeholder value, **not acceptable long-term**; revisit before shipping to prompt for a shared reason (e.g. a small text input in the bulk bar itself) rather than a hardcoded string. Flagging here rather than silently shipping it — treat this as a follow-up refinement, not part of this task's Definition of Done; if you have time within this task, add a bulk-reason `Input` next to the bulk action buttons instead of the hardcoded string.

Also update `LearningTab.types.ts` (delete `LearningTabCandidatesCardProps`, `LearningCandidateStatusFilter`) and `LearningTab.helpers.ts` (delete `toLearningCandidateStatus`) since both are now dead — check first that nothing else imports them (the proposals-side equivalents `SkillProposalStatusFilter`/`toSkillProposalStatus` are still used until Task 9 lands, so don't touch those yet).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTabCandidatesCard.spec.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/LearningTabCandidatesCard.tsx apps/web/src/pages/project-workspace/LearningTabCandidatesCard.spec.tsx apps/web/src/pages/project-workspace/LearningTab.types.ts apps/web/src/pages/project-workspace/LearningTab.helpers.ts
git commit -m "feat(web): migrate LearningTabCandidatesCard onto DataTable with filters/bulk actions/timeline"
```

---

### Task 9: `LearningTabProposalsCard` — migrate onto `DataTable`

**Files:**

- Modify: `apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx`
- Modify: `apps/web/src/pages/project-workspace/LearningTab.types.ts` (drop the now-obsolete `LearningTabProposalsCardProps`, `SkillProposalStatusFilter`)
- Modify: `apps/web/src/pages/project-workspace/LearningTab.helpers.ts` (drop `toSkillProposalStatus`)
- Rewrite: a new `apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx` (none exists today)

**Interfaces:**

- Consumes: `DataTable` (Tasks 1–3), `api.getSkillImprovementProposals` (Task 5), `useApproveSkillImprovementProposal`/`useRejectSkillImprovementProposal`/`useConfirmSkillImprovementProposalScope`/`useSkillImprovementProposalPreview` (existing, unchanged), `useBulkApproveSkillImprovementProposals`/`useBulkRejectSkillImprovementProposals` (Task 6).
- Produces: `LearningTabProposalsCard` becomes a zero-prop component, absorbing `reviewerName`/`rejectionDrafts`/`selectedProposalId`/`preview` as internal state (previously threaded down from `LearningTab.tsx`). Consumed by Task 10.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SkillImprovementProposal } from "@/lib/api/types";
import { LearningTabProposalsCard } from "./LearningTabProposalsCard";

const apiMock = vi.hoisted(() => ({
  getSkillImprovementProposals: vi.fn(),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

const mutationsMock = vi.hoisted(() => ({
  approveMutateAsync: vi.fn(),
  rejectMutateAsync: vi.fn(),
  confirmScopeMutateAsync: vi.fn(),
  bulkApproveMutateAsync: vi.fn(),
  bulkRejectMutateAsync: vi.fn(),
}));
vi.mock("@/hooks/useLearningMemory", () => ({
  useApproveSkillImprovementProposal: () => ({
    mutateAsync: mutationsMock.approveMutateAsync,
    isPending: false,
  }),
  useRejectSkillImprovementProposal: () => ({
    mutateAsync: mutationsMock.rejectMutateAsync,
    isPending: false,
  }),
  useConfirmSkillImprovementProposalScope: () => ({
    mutateAsync: mutationsMock.confirmScopeMutateAsync,
    isPending: false,
  }),
  useSkillImprovementProposalPreview: () => ({ data: null, isLoading: false }),
  useBulkApproveSkillImprovementProposals: () => ({
    mutateAsync: mutationsMock.bulkApproveMutateAsync,
    isPending: false,
  }),
  useBulkRejectSkillImprovementProposals: () => ({
    mutateAsync: mutationsMock.bulkRejectMutateAsync,
    isPending: false,
  }),
}));

function makeProposal(
  overrides: Partial<SkillImprovementProposal> & { id: string },
): SkillImprovementProposal {
  return {
    learning_candidate_id: null,
    target_skill_name: "testing-unit-patterns",
    proposal_title: "Improve flaky-test debugging guidance",
    proposal_summary: "Add deterministic fixture diagnostics",
    status: "pending",
    generated_from_run_id: null,
    approved_at: null,
    approved_by: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    applied_at: null,
    scope_confirmation: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearningTabProposalsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LearningTabProposalsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getSkillImprovementProposals.mockResolvedValue({
      data: [makeProposal({ id: "p1" })],
      meta: { pagination: { total: 1, page: 1, limit: 25, totalPages: 1 } },
    });
  });

  it("fetches proposals itself and renders the result", async () => {
    renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("Improve flaky-test debugging guidance"),
      ).toBeTruthy();
    });
  });

  it("defaults the status filter to pending", async () => {
    renderCard();

    await waitFor(() => {
      expect(apiMock.getSkillImprovementProposals).toHaveBeenCalledWith(
        expect.objectContaining({ status: ["pending"] }),
      );
    });
  });

  it("approves a proposal via the inline action using the reviewer-name input", async () => {
    mutationsMock.approveMutateAsync.mockResolvedValue({ id: "p1" });
    renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("Improve flaky-test debugging guidance"),
      ).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Reviewer identity"), {
      target: { value: "qa-admin" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mutationsMock.approveMutateAsync).toHaveBeenCalledWith({
        proposalId: "p1",
        approvedBy: "qa-admin",
      });
    });
  });

  it("bulk approves selected proposals", async () => {
    mutationsMock.bulkApproveMutateAsync.mockResolvedValue([{ id: "p1" }]);
    renderCard();

    await waitFor(() => {
      expect(
        screen.getByText("Improve flaky-test debugging guidance"),
      ).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select row Improve flaky-test debugging guidance",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve selected" }));

    await waitFor(() => {
      expect(mutationsMock.bulkApproveMutateAsync).toHaveBeenCalledWith({
        proposalIds: ["p1"],
        approvedBy: undefined,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx`
Expected: FAIL — the component still requires the old prop set

- [ ] **Step 3: Implement**

```typescript
// apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import type {
  ColumnDef,
  FilterDef,
  ListQuery,
  ListResponse,
} from "@/components/ui/data-table";
import { formatDateTimeSafe, formatDistanceToNowSafe } from "@/lib/utils";
import { api } from "@/lib/api/client";
import {
  useApproveSkillImprovementProposal,
  useBulkApproveSkillImprovementProposals,
  useBulkRejectSkillImprovementProposals,
  useRejectSkillImprovementProposal,
} from "@/hooks/useLearningMemory";
import type { SkillImprovementProposal } from "@/lib/api/types";
import { proposalStatusBadgeVariant, truncateIdentifier } from "./LearningTab.helpers";

const PROPOSAL_STATUS_FILTER: FilterDef = {
  key: "status",
  label: "Status",
  type: "multiselect",
  options: [
    { label: "Pending", value: "pending" },
    { label: "Approved", value: "approved" },
    { label: "Applied", value: "applied" },
    { label: "Rejected", value: "rejected" },
    { label: "Failed", value: "failed" },
  ],
};

async function fetchProposalsPage(
  query: ListQuery & Record<string, unknown>,
): Promise<ListResponse<SkillImprovementProposal>> {
  const response = await api.getSkillImprovementProposals({
    status: typeof query.status === "string" ? query.status.split(",") : undefined,
    search: query.search,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
  });

  return {
    data: response.data,
    meta: { pagination: response.meta.pagination },
  };
}

function ProposalTimeline({
  proposal,
}: Readonly<{ proposal: SkillImprovementProposal }>) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>Proposed: {formatDateTimeSafe(proposal.created_at)}</p>
      {proposal.approved_at ? (
        <p>
          Approved: {formatDateTimeSafe(proposal.approved_at)}
          {proposal.approved_by ? ` by ${proposal.approved_by}` : ""}
        </p>
      ) : null}
      {proposal.rejected_at ? (
        <p>
          Rejected: {formatDateTimeSafe(proposal.rejected_at)}
          {proposal.rejected_by ? ` by ${proposal.rejected_by}` : ""}
          {proposal.rejection_reason ? ` — ${proposal.rejection_reason}` : ""}
        </p>
      ) : null}
      {proposal.applied_at ? (
        <p>Applied: {formatDateTimeSafe(proposal.applied_at)}</p>
      ) : null}
    </div>
  );
}

export function LearningTabProposalsCard() {
  const [reviewerName, setReviewerName] = useState("");
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const approveMutation = useApproveSkillImprovementProposal();
  const rejectMutation = useRejectSkillImprovementProposal();
  const bulkApproveMutation = useBulkApproveSkillImprovementProposals();
  const bulkRejectMutation = useBulkRejectSkillImprovementProposals();

  const columns: ColumnDef<SkillImprovementProposal>[] = [
    {
      key: "proposal_title",
      label: "Title",
      sortable: true,
      render: (proposal) => (
        <div>
          <p className="font-medium">{proposal.proposal_title}</p>
          <p className="text-xs text-muted-foreground">
            Skill {proposal.target_skill_name} · #{truncateIdentifier(proposal.id)}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (proposal) => (
        <Badge variant={proposalStatusBadgeVariant(proposal.status)}>
          {proposal.status}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Proposed",
      sortable: true,
      className: "text-xs text-muted-foreground",
      render: (proposal) => formatDistanceToNowSafe(proposal.created_at, "—"),
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (proposal) => {
        if (proposal.status !== "pending") {
          return null;
        }
        if (rejectingId === proposal.id) {
          return (
            <div className="flex items-center gap-2">
              <label htmlFor={`reject-reason-${proposal.id}`} className="sr-only">
                Rejection reason
              </label>
              <Input
                id={`reject-reason-${proposal.id}`}
                aria-label="Rejection reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="h-8 w-40"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={rejectionReason.trim().length < 2}
                onClick={() => {
                  void rejectMutation.mutateAsync({
                    proposalId: proposal.id,
                    reason: rejectionReason,
                    rejectedBy: reviewerName.trim() || undefined,
                  });
                  setRejectingId(null);
                  setRejectionReason("");
                }}
              >
                Confirm
              </Button>
            </div>
          );
        }
        return (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() =>
                void approveMutation.mutateAsync({
                  proposalId: proposal.id,
                  approvedBy: reviewerName.trim() || undefined,
                })
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRejectingId(proposal.id)}
            >
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Skill Improvement Proposals</CardTitle>
        <div className="flex flex-col gap-2 md:max-w-sm">
          <label htmlFor="learning-reviewer-name" className="text-sm text-muted-foreground">
            Reviewer identity
          </label>
          <Input
            id="learning-reviewer-name"
            placeholder="admin"
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent>
        <DataTable<SkillImprovementProposal>
          mode="server"
          urlKey="sp"
          queryKey={["skill-proposals"]}
          fetchFn={fetchProposalsPage}
          columns={columns}
          filters={[PROPOSAL_STATUS_FILTER]}
          defaultFilterValues={{ status: "pending" }}
          defaultSort="created_at"
          defaultSortDir="desc"
          enableSelection
          renderExpanded={(proposal) => <ProposalTimeline proposal={proposal} />}
          renderBulkActions={(selected) => (
            <>
              <span className="text-sm">{selected.length} selected</span>
              <Button
                size="sm"
                onClick={() =>
                  void bulkApproveMutation.mutateAsync({
                    proposalIds: selected.map((p) => p.id),
                    approvedBy: reviewerName.trim() || undefined,
                  })
                }
              >
                Approve selected
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void bulkRejectMutation.mutateAsync({
                    proposalIds: selected.map((p) => p.id),
                    reason: "Bulk rejected",
                    rejectedBy: reviewerName.trim() || undefined,
                  })
                }
              >
                Reject selected
              </Button>
            </>
          )}
          emptyMessage="No skill improvement proposals found for this filter."
        />
      </CardContent>
    </Card>
  );
}
```

Same bulk-reject-reason caveat as Task 8: `"Bulk rejected"` is a placeholder literal — flag it the same way, don't ship it silently.

This drops the existing patch-preview panel (`ProposalPreview`/`LearningTabDiffPreview`/`ScopeConfirmationCard`, and the "prevent approval when preview has warnings" guard from `LearningTab.spec.tsx`'s current tests) from this pass — that UI depended on `selectedProposalId`/`preview` state that doesn't map cleanly onto a `DataTable` row-render model without a real design decision (does "Preview Patch" open the row-expansion slot instead of a full detail panel? does it replace the timeline?). **Do not silently drop this feature** — flag it explicitly as an open question for a human before finishing this task, since it's user-facing functionality that existed before this migration and has real backend behavior (`useSkillImprovementProposalPreview`, `useConfirmSkillImprovementProposalScope`) that still needs a home in the new UI. A reasonable default if no answer arrives in time: put the existing `ProposalPreview`/`ScopeConfirmationCard` content inside `renderExpanded` alongside `ProposalTimeline`, gated behind a "Preview Patch" button that triggers `useSkillImprovementProposalPreview` for that row's id — but confirm this placement before treating the task as done.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/LearningTabProposalsCard.tsx apps/web/src/pages/project-workspace/LearningTabProposalsCard.spec.tsx apps/web/src/pages/project-workspace/LearningTab.types.ts apps/web/src/pages/project-workspace/LearningTab.helpers.ts
git commit -m "feat(web): migrate LearningTabProposalsCard onto DataTable with filters/bulk actions/timeline"
```

---

### Task 10: `LearningTab.tsx` — simplify to the now-self-contained cards

**Files:**

- Modify: `apps/web/src/pages/project-workspace/LearningTab.tsx`
- Rewrite: `apps/web/src/pages/project-workspace/LearningTab.spec.tsx`

**Interfaces:**

- Consumes: `LearningTabCandidatesCard`/`LearningTabProposalsCard` (Tasks 8/9, now zero-prop).
- Produces: `LearningTab` keeps only the sweep status card, health panel, and the two self-contained cards — all the candidate/proposal fetching, filter state, reviewer-name state, rejection-draft state, and preview-selection state that used to live here is deleted (it moved into the cards in Tasks 8/9).

- [ ] **Step 1: Write the failing test**

Replace `apps/web/src/pages/project-workspace/LearningTab.spec.tsx` entirely — it no longer mocks candidate/proposal data or approve/reject flows (that's covered by Task 8/9's own spec files now); it only verifies the sweep panel still works and that both cards render:

```typescript
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LearningTab } from "./LearningTab";

const learningHooksMock = vi.hoisted(() => ({
  useLearningMemoryStatus: vi.fn(),
  useRunLearningMemorySweep: vi.fn(),
}));
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/hooks/useLearningMemory", () => learningHooksMock);
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));
vi.mock("@/hooks/useMemoryMetrics", () => ({
  useMemoryMetrics: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

const apiMock = vi.hoisted(() => ({
  getLearningCandidates: vi.fn().mockResolvedValue({
    data: [],
    meta: { pagination: { total: 0, page: 1, limit: 25, totalPages: 1 }, suppressedCount: 0 },
  }),
  getSkillImprovementProposals: vi.fn().mockResolvedValue({
    data: [],
    meta: { pagination: { total: 0, page: 1, limit: 25, totalPages: 1 } },
  }),
}));
vi.mock("@/lib/api/client", () => ({ api: apiMock }));

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearningTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LearningTab", () => {
  const runSweepMutateAsync = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    learningHooksMock.useLearningMemoryStatus.mockReturnValue({
      data: {
        enabled: true,
        intervalSeconds: 21600,
        promotionThreshold: 0.72,
        proposalThreshold: 0.84,
        candidateTotals: { pending: 2, promoted: 1 },
        proposalTotals: { pending: 1, approved: 0, rejected: 0, failed: 0 },
        lastRun: null,
      },
      isLoading: false,
    });
    learningHooksMock.useRunLearningMemorySweep.mockReturnValue({
      mutateAsync: runSweepMutateAsync,
      isPending: false,
    });
  });

  it("renders the sweep status panel and both learning cards", async () => {
    renderTab();

    expect(screen.getByText("Learning Candidates")).toBeTruthy();
    expect(screen.getByText("Skill Improvement Proposals")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run Sweep Now" }));

    await waitFor(() => {
      expect(runSweepMutateAsync).toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTab.spec.tsx`
Expected: FAIL — `LearningTab.tsx` still calls the deleted `useLearningCandidates`/`useSkillImprovementProposals` hooks and passes props into the cards

- [ ] **Step 3: Simplify `LearningTab.tsx`**

```typescript
import { useRunLearningMemorySweep, useLearningMemoryStatus } from "@/hooks/useLearningMemory";
import { useMemoryMetrics } from "@/hooks/useMemoryMetrics";
import { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { LearningHealthPanel } from "./LearningHealthPanel";
import { LearningTabCandidatesCard } from "./LearningTabCandidatesCard";
import { LearningTabProposalsCard } from "./LearningTabProposalsCard";
import { LearningTabStatusCard } from "./LearningTabStatusCard";

async function runLearningSweep(
  runSweepMutation: ReturnType<typeof useRunLearningMemorySweep>,
  toast: ReturnType<typeof useToast>,
) {
  try {
    const result = await runSweepMutation.mutateAsync();
    toast.success(
      "Learning sweep completed",
      `Promoted ${result.promotedCandidates.toString()} candidates and generated ${result.createdSkillProposals.toString()} proposals.`,
    );
  } catch (error) {
    toast.error(
      "Learning sweep failed",
      getApiErrorMessage(error, "Unable to run memory learning sweep."),
    );
  }
}

export function LearningTab() {
  const toast = useToast();
  const statusQuery = useLearningMemoryStatus();
  const metricsQuery = useMemoryMetrics();
  const runSweepMutation = useRunLearningMemorySweep();

  return (
    <div className="space-y-4">
      <LearningTabStatusCard
        status={statusQuery.data}
        isLoading={statusQuery.isLoading}
        isRunningSweep={runSweepMutation.isPending}
        onRunSweep={() => {
          void runLearningSweep(runSweepMutation, toast);
        }}
      />

      <LearningHealthPanel
        learning={metricsQuery.data?.learning}
        isLoading={metricsQuery.isLoading}
      />

      <LearningTabCandidatesCard />

      <LearningTabProposalsCard />
    </div>
  );
}
```

This deletes: the `candidateStatusFilter`/`proposalStatusFilter`/`reviewerName`/`rejectionDrafts`/`selectedProposalId` state, `toSkillPatchDiffPayload`, `approveSkillProposal`, `rejectSkillProposal`, `handleConfirmScope`, `LEARNING_LIST_PAGE_LIMIT`, and the `LearningTabDiffPreview` render block (its preview-panel functionality is Task 9's flagged open question, not silently dropped — see Task 9's note).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/pages/project-workspace/LearningTab.spec.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/project-workspace/LearningTab.tsx apps/web/src/pages/project-workspace/LearningTab.spec.tsx
git commit -m "refactor(web): simplify LearningTab now that both cards are self-contained"
```

---

### Task 11: Full verification, dead-code sweep, and docs update

**Files:**

- Delete (if now unused): `apps/web/src/pages/project-workspace/LearningTabDiffPreview.tsx`/`.types.ts`, `LearningTabProposalPreview.tsx`, `LearningTabScopeConfirmationCard.tsx` (only if Task 9's open question resolved to _not_ reusing them — check before deleting)
- Modify: a `docs/guide` file documenting the Learning tab (mirroring the backend plan's Task 17 docs update)

**Interfaces:** none new — this task verifies Tasks 1–10 together and cleans up.

- [ ] **Step 1: Run the full web unit test suite**

Run: `npm run test:unit:web`
Expected: PASS (all tests, not just the ones touched by this plan)

- [ ] **Step 2: Run the web lint**

Run: `npm run lint:web`
Expected: no errors — pay particular attention to unused-import warnings from the deletions in Tasks 6/8/9/10

- [ ] **Step 3: Build apps/web**

Run: `npm run build --workspace=apps/web`
Expected: succeeds with no type errors

- [ ] **Step 4: Manually verify the golden path in a browser**

Per this repo's UI-change convention: start the dev server (`npm run dev:web`, with the API/DB stack up via `docker compose up -d --build` if not already running) and open a project's Learning tab. Confirm: candidates/proposals load, status filter defaults to non-terminal states, search/sort work, row expansion shows the timeline, single reject/archive/approve work, and bulk select + bulk action work end-to-end against the real backend from the backend plan. Screenshot or describe what you saw — do not claim this task done without having actually driven it in a browser (per this project's verification requirements, type/unit tests alone don't prove the feature works).

- [ ] **Step 5: Delete now-unused proposal-preview components if applicable**

If Task 9's open question was resolved by dropping the standalone preview panel entirely (rather than folding it into `renderExpanded`), delete `LearningTabDiffPreview.tsx`/`.types.ts`, `LearningTabProposalPreview.tsx`, and `LearningTabScopeConfirmationCard.tsx` outright — check each has no remaining importer first (`grep -rl` for each component name across `apps/web/src`).

- [ ] **Step 6: Update the docs**

Find the same `docs/guide` file the backend plan's Task 17 updated (search for "EPIC-212" or "Learning tab") and add a short subsection on the frontend redesign: the shared `DataTable` now has multiselect/date filters, row selection with bulk actions, and row expansion (generically available to any future consumer); the Learning tab defaults to hiding terminal states; "new since last visit" and "stale" flags are client-side only (localStorage, no backend tracking).

- [ ] **Step 7: Commit**

```bash
git add docs/guide
git commit -m "docs: document the Learning tab DataTable redesign"
```
