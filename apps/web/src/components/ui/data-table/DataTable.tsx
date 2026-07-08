import { Fragment, useState } from "react";
import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { ColumnDef, DataTableProps } from "./data-table.types";
import { useDataTable } from "./useDataTable";
import { DataTableToolbar } from "./DataTableToolbar";
import { DataTablePagination } from "./DataTablePagination";

interface DataTableRowProps<T> {
  item: T;
  rowLabel: string;
  columns: ColumnDef<T>[];
  enableSelection: boolean;
  isSelected: boolean;
  onToggleSelected: () => void;
  renderExpanded?: (item: T) => ReactNode;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onRowClick?: (item: T) => void;
  colSpan: number;
}

function DataTableRow<T>({
  item,
  rowLabel,
  columns,
  enableSelection,
  isSelected,
  onToggleSelected,
  renderExpanded,
  isExpanded,
  onToggleExpanded,
  onRowClick,
  colSpan,
}: DataTableRowProps<T>) {
  return (
    <Fragment>
      <TableRow
        className={onRowClick ? "cursor-pointer" : undefined}
        onClick={() => onRowClick?.(item)}
      >
        {renderExpanded ? (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label={
                isExpanded
                  ? `Collapse row ${rowLabel}`
                  : `Expand row ${rowLabel}`
              }
              onClick={onToggleExpanded}
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
              aria-label={`Select row ${rowLabel}`}
              checked={isSelected}
              onCheckedChange={onToggleSelected}
            />
          </TableCell>
        ) : null}
        {columns.map((col) => (
          <TableCell key={col.key} className={col.className}>
            {col.render ? col.render(item) : String(item[col.key] ?? "")}
          </TableCell>
        ))}
      </TableRow>
      {isExpanded && renderExpanded ? (
        <TableRow>
          <TableCell colSpan={colSpan}>{renderExpanded(item)}</TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

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
  getRowLabel,
  renderExpanded,
}: DataTableProps<T>) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const rowIds = data.map(
    (item, index) => item.id ?? `row-${index.toString()}`,
  );
  const selectedRows = data.filter((item, index) =>
    selectedIds.has(item.id ?? `row-${index.toString()}`),
  );
  const allOnPageSelected =
    rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const leadingColumnCount =
    (enableSelection ? 1 : 0) + (renderExpanded ? 1 : 0);
  const totalColSpan = columns.length + leadingColumnCount;

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
              {renderExpanded ? <TableHead className="w-10" /> : null}
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
                <TableCell colSpan={totalColSpan} className="text-center h-24">
                  Loading...
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColSpan} className="text-center h-24">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, index) => {
                const rowId = item.id ?? `row-${index.toString()}`;
                const rowLabel = getRowLabel
                  ? getRowLabel(item)
                  : String((item as Record<string, unknown>).title ?? rowId);
                return (
                  <DataTableRow<T>
                    key={rowId}
                    item={item}
                    rowLabel={rowLabel}
                    columns={columns}
                    enableSelection={enableSelection}
                    isSelected={selectedIds.has(rowId)}
                    onToggleSelected={() => {
                      toggleSelected(rowId);
                    }}
                    renderExpanded={renderExpanded}
                    isExpanded={expandedId === rowId}
                    onToggleExpanded={() => {
                      setExpandedId(expandedId === rowId ? null : rowId);
                    }}
                    onRowClick={onRowClick}
                    colSpan={totalColSpan}
                  />
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
