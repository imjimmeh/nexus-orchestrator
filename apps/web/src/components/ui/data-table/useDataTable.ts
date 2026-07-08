import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type {
  ColumnDef,
  FilterDef,
  ListQuery,
  ListResponse,
  DataTableMode,
} from "./data-table.types";

interface UseDataTableOptions<T> {
  mode: DataTableMode;
  columns: ColumnDef<T>[];
  filters?: FilterDef[];
  data?: T[];
  fetchFn?: (
    query: ListQuery & Record<string, unknown>,
  ) => Promise<ListResponse<T>>;
  queryKey?: unknown[];
  defaultSort?: string;
  defaultSortDir?: "asc" | "desc";
  defaultLimit?: number;
  defaultFilterValues?: Record<string, string>;
  urlKey?: string;
}

interface DataTableInitialState {
  search: string;
  sortBy: string | undefined;
  sortDir: "asc" | "desc" | undefined;
  page: number;
  filterValues: Record<string, string>;
}

const FILTER_PARAM_INFIX = "_f_";

function readInitialState(
  urlKey: string | undefined,
  params: URLSearchParams,
): DataTableInitialState | undefined {
  if (!urlKey) return undefined;
  const filterPrefix = `${urlKey}${FILTER_PARAM_INFIX}`;
  const dir = params.get(`${urlKey}_dir`);
  const pageValue = Number(params.get(`${urlKey}_page`) ?? "1");
  return {
    search: params.get(`${urlKey}_q`) ?? "",
    sortBy: params.get(`${urlKey}_sort`) ?? undefined,
    sortDir: dir === "asc" || dir === "desc" ? dir : undefined,
    page: Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1,
    filterValues: Object.fromEntries(
      [...params.entries()]
        .filter(([key]) => key.startsWith(filterPrefix))
        .map(([key, value]) => [key.slice(filterPrefix.length), value]),
    ),
  };
}

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

const EMPTY_PAGINATION = { total: 0, page: 1, limit: 20, totalPages: 0 };

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
    // Defaults are the base; the URL only overrides individual filter keys
    // it actually carries, so a fresh mount with no filter params yet still
    // picks up defaultFilterValues instead of an empty object.
    filterValues: { ...defaultFilterValues, ...initial?.filterValues },
  };
}

function useDataTableState(
  defaultSort?: string,
  defaultSortDir: "asc" | "desc" = "asc",
  defaultLimit = 20,
  defaultFilterValues?: Record<string, string>,
  initial?: DataTableInitialState,
) {
  const resolved = resolveInitialState(
    defaultSort,
    defaultSortDir,
    defaultFilterValues,
    initial,
  );
  const [page, setPage] = useState(resolved.page);
  const [limit, setLimit] = useState(defaultLimit);
  const [search, setSearch] = useState(resolved.search);
  const [searchInput, setSearchInput] = useState(resolved.search);
  const [sortBy, setSortBy] = useState<string | undefined>(resolved.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    resolved.sortDir ?? defaultSortDir,
  );
  const [filterValues, setFilterValues] = useState<Record<string, string>>(
    resolved.filterValues,
  );

  const handleSort = useCallback((key: string) => {
    setSortBy((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
    setPage(1);
  }, []);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleFilter = useCallback((key: string, value: string) => {
    setFilterValues((prev) => {
      if (value === "" || value === "__all__") {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: value };
    });
    setPage(1);
  }, []);

  return {
    page,
    setPage,
    limit,
    setLimit,
    search,
    searchInput,
    setSearchInput,
    sortBy,
    sortDir,
    filterValues,
    handleSort,
    handleSearch,
    handleFilter,
  };
}

function getMeta(
  serverMeta:
    | { total?: number; page?: number; limit?: number; totalPages?: number }
    | undefined,
  clientMeta:
    | { total?: number; page?: number; limit?: number; totalPages?: number }
    | undefined,
  page: number,
  limit: number,
) {
  const source = serverMeta ?? clientMeta ?? EMPTY_PAGINATION;
  return {
    total: source.total ?? 0,
    page,
    limit: source.limit ?? limit,
    totalPages: source.totalPages ?? 0,
  };
}

function buildQuery(
  page: number,
  limit: number,
  search: string,
  sortBy: string | undefined,
  sortDir: "asc" | "desc",
  filterValues: Record<string, string>,
): ListQuery & Record<string, unknown> {
  const query: ListQuery & Record<string, unknown> = {
    page,
    limit,
    ...filterValues,
  };
  if (search) query.search = search;
  if (sortBy) {
    query.sortBy = sortBy;
    query.sortDir = sortDir;
  }
  return query;
}

function useServerClientResult<T>(
  mode: DataTableMode,
  serverQuery: { isLoading: boolean; data?: ListResponse<T> },
  clientResult: ListResponse<T> | null,
  page: number,
  limit: number,
) {
  const isLoading = mode === "server" && serverQuery.isLoading;
  if (mode === "server") {
    return {
      isLoading,
      data: serverQuery.data?.data ?? [],
      meta: getMeta(serverQuery.data?.meta?.pagination, undefined, page, limit),
    };
  }
  return {
    isLoading,
    data: clientResult?.data ?? [],
    meta: getMeta(undefined, clientResult?.meta?.pagination, page, limit),
  };
}

interface UrlSyncState {
  urlKey: string | undefined;
  search: string;
  sortBy: string | undefined;
  sortDir: "asc" | "desc";
  page: number;
  filterValues: Record<string, string>;
}

// Only touches filter params that actually changed. Unconditionally deleting
// and re-adding every filterPrefix key on each sync (the previous approach)
// moves those keys to the end of the URLSearchParams iteration order even
// when their values are unchanged, which changes next.toString() every
// render. When two url-keyed DataTables share the same router search params,
// each one's no-op "resync" reorders the other's params too, so they keep
// re-triggering each other's sync effect forever (see useDataTable.url.spec).
function syncFilterParams(
  next: URLSearchParams,
  filterPrefix: string,
  filterValues: Record<string, string>,
): void {
  const desiredKeys = new Set(
    Object.keys(filterValues).map((key) => `${filterPrefix}${key}`),
  );

  for (const key of [...next.keys()]) {
    if (key.startsWith(filterPrefix) && !desiredKeys.has(key)) {
      next.delete(key);
    }
  }

  for (const [filterKey, filterValue] of Object.entries(filterValues)) {
    const paramKey = `${filterPrefix}${filterKey}`;
    if (filterValue && filterValue.length > 0) {
      next.set(paramKey, filterValue);
    } else {
      next.delete(paramKey);
    }
  }
}

function buildSyncedParams(
  current: URLSearchParams,
  state: UrlSyncState,
): URLSearchParams {
  const { urlKey } = state;
  if (!urlKey) return current;

  const next = new URLSearchParams(current);
  const set = (name: string, value: string | undefined) => {
    if (value && value.length > 0) next.set(name, value);
    else next.delete(name);
  };

  set(`${urlKey}_q`, state.search || undefined);
  set(`${urlKey}_sort`, state.sortBy);
  set(`${urlKey}_dir`, state.sortBy ? state.sortDir : undefined);
  set(`${urlKey}_page`, state.page > 1 ? String(state.page) : undefined);

  syncFilterParams(next, `${urlKey}${FILTER_PARAM_INFIX}`, state.filterValues);

  return next;
}

function useUrlStateSync(
  searchParams: URLSearchParams,
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  state: UrlSyncState,
) {
  const { urlKey, search, sortBy, sortDir, page } = state;
  const filterSignature = JSON.stringify(state.filterValues);

  useEffect(() => {
    if (!urlKey) return;
    const next = buildSyncedParams(searchParams, {
      urlKey,
      search,
      sortBy,
      sortDir,
      page,
      filterValues: JSON.parse(filterSignature) as Record<string, string>,
    });
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [
    searchParams,
    setSearchParams,
    urlKey,
    search,
    sortBy,
    sortDir,
    page,
    filterSignature,
  ]);
}

function useRowSelection() {
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

  return { selectedIds, toggleSelected, toggleAllSelected, clearSelection };
}

export function useDataTable<T>(options: UseDataTableOptions<T>) {
  const {
    mode,
    data: rawData,
    fetchFn,
    queryKey,
    filters,
    defaultSort,
    defaultSortDir = "asc",
    defaultLimit = 20,
    defaultFilterValues,
    urlKey,
  } = options;

  const [searchParams, setSearchParams] = useSearchParams();

  const [initialState] = useState(() => readInitialState(urlKey, searchParams));

  const {
    page,
    setPage,
    limit,
    setLimit,
    search,
    searchInput,
    setSearchInput,
    sortBy,
    sortDir,
    filterValues,
    handleSort,
    handleSearch,
    handleFilter,
  } = useDataTableState(
    defaultSort,
    defaultSortDir,
    defaultLimit,
    defaultFilterValues,
    initialState,
  );

  useUrlStateSync(searchParams, setSearchParams, {
    urlKey,
    search,
    sortBy,
    sortDir,
    page,
    filterValues,
  });

  const query = buildQuery(page, limit, search, sortBy, sortDir, filterValues);

  const serverQuery = useQuery({
    queryKey: [...(queryKey ?? []), query],
    queryFn: () => {
      if (!fetchFn) {
        return Promise.resolve({
          data: [],
          meta: { pagination: EMPTY_PAGINATION },
        } as ListResponse<T>);
      }
      return fetchFn(query);
    },
    enabled: mode === "server" && !!fetchFn,
  });

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

  const { data, isLoading, meta } = useServerClientResult(
    mode,
    serverQuery,
    clientResult,
    page,
    limit,
  );

  const { selectedIds, toggleSelected, toggleAllSelected, clearSelection } =
    useRowSelection();

  return {
    data,
    meta,
    isLoading,
    query,
    setPage,
    setLimit,
    setSort: handleSort,
    setSearch: handleSearch,
    setSearchInput,
    searchInput,
    setFilter: handleFilter,
    filterValues,
    sortBy,
    sortDir,
    selectedIds,
    toggleSelected,
    toggleAllSelected,
    clearSelection,
  };
}
