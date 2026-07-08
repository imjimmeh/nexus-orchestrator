import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  BudgetSummaryParams,
  BudgetSummaryRow,
} from "@/lib/api/client.budget.types";
import { formatCentsToDollars, formatTokens } from "./budget-format-utils";

type GroupBy = NonNullable<BudgetSummaryParams["group_by"]>;

const GROUP_BY_OPTIONS = [
  { value: "provider", label: "Provider" },
  { value: "model", label: "Model" },
  { value: "scope", label: "Scope" },
  { value: "context", label: "Context" },
] as const;

interface SummaryTableProps {
  rows: BudgetSummaryRow[];
  groupBy: GroupBy;
  onGroupByChange: (value: GroupBy) => void;
  isLoading: boolean;
}

export function SummaryTable({
  rows,
  groupBy,
  onGroupByChange,
  isLoading,
}: Readonly<SummaryTableProps>) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<
    "key" | "total_cents" | "total_tokens" | "count"
  >("total_cents");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filteredRows = useMemo(() => {
    let result = [...rows];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.key.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      const aVal = sortField === "key" ? a[sortField] : Number(a[sortField]);
      const bVal = sortField === "key" ? b[sortField] : Number(b[sortField]);
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [rows, search, sortField, sortDir]);

  const totalCents = rows.reduce((sum, r) => sum + Number(r.total_cents), 0);

  function handleSort(field: "key" | "total_cents" | "total_tokens" | "count") {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between p-6 pb-0">
        <h3 className="text-sm font-medium">Summary Table</h3>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48"
          />
          <Select
            value={groupBy}
            onValueChange={(v) => onGroupByChange(v as GroupBy)}
          >
            <SelectTrigger className="h-8 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="p-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => handleSort("key")}
              >
                Key
                {sortField === "key" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort("total_cents")}
              >
                Spend
                {sortField === "total_cents"
                  ? sortDir === "asc"
                    ? " ↑"
                    : " ↓"
                  : ""}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort("total_tokens")}
              >
                Tokens
                {sortField === "total_tokens"
                  ? sortDir === "asc"
                    ? " ↑"
                    : " ↓"
                  : ""}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none text-right"
                onClick={() => handleSort("count")}
              >
                Events
                {sortField === "count" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </TableHead>
              <TableHead className="text-right">% of Total</TableHead>
            </TableRow>
          </TableHeader>
          {isLoading ? (
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-5 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="ml-auto h-5 w-12" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : filteredRows.length === 0 ? (
            <TableBody>
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No spend data available
                </TableCell>
              </TableRow>
            </TableBody>
          ) : (
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{row.key}</TableCell>
                  <TableCell className="text-right">
                    {formatCentsToDollars(row.total_cents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatTokens(row.total_tokens)}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(row.count).toLocaleString()}
                    {Number(row.unpriced_count) > 0 ? (
                      <span
                        className="ml-1 text-xs text-amber-600"
                        title="Events recorded without a resolvable model price; their cost is not included in spend."
                      >
                        ({Number(row.unpriced_count).toLocaleString()} unpriced)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {totalCents > 0
                      ? `${((Number(row.total_cents) / totalCents) * 100).toFixed(1)}%`
                      : "0%"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          )}
        </Table>
      </div>
    </div>
  );
}
