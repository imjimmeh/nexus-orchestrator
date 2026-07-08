import type { ReactNode } from "react";

export interface ColumnDef<T> {
  key: keyof T & string;
  label: string;
  sortable?: boolean;
  render?: (item: T) => ReactNode;
  className?: string;
}

export interface FilterDef {
  key: string;
  label: string;
  type: "select" | "multiselect" | "date";
  options: { label: string; value: string }[];
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ListQuery {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export type ListResponse<T> = {
  data: T[];
  meta: {
    pagination: PaginationMeta;
  };
};

export type DataTableMode = "server" | "client";

export interface DataTableProps<T> {
  mode: DataTableMode;
  columns: ColumnDef<T>[];
  filters?: FilterDef[];
  fetchFn?: (
    query: ListQuery & Record<string, unknown>,
  ) => Promise<ListResponse<T>>;
  queryKey?: unknown[];
  data?: T[];
  defaultSort?: string;
  defaultSortDir?: "asc" | "desc";
  defaultLimit?: number;
  defaultFilterValues?: Record<string, string>;
  urlKey?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  enableSelection?: boolean;
  renderBulkActions?: (selected: T[]) => ReactNode;
  getRowLabel?: (item: T) => string;
  renderExpanded?: (item: T) => ReactNode;
}
