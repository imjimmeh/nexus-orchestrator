import { useState, useMemo, useCallback } from "react";
import { useUsageEvents } from "@/hooks/useUsageEvents";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import type {
  BudgetQueryParams,
  BudgetUsageEventResponse,
} from "@/lib/api/client.budget.types";
import type { DateRange } from "./DateRangePicker";

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function formatCentsToDollars(cents: number | null): string {
  return `$${((cents ?? 0) / 100).toFixed(4)}`;
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "-";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString();
}

function UsageEventRow({ event }: { event: BudgetUsageEventResponse }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs">
        {formatTimestamp(event.created_at)}
      </TableCell>
      <TableCell className="max-w-[120px] truncate text-xs">
        {event.scope_id ?? "-"}
      </TableCell>
      <TableCell className="max-w-[120px] truncate text-xs">
        {event.context_id}
      </TableCell>
      <TableCell className="text-xs">{event.provider_name ?? "-"}</TableCell>
      <TableCell className="max-w-[120px] truncate text-xs">
        {event.model_name ?? "-"}
      </TableCell>
      <TableCell className="text-right text-xs">
        {formatTokens(event.input_tokens)}
      </TableCell>
      <TableCell className="text-right text-xs">
        {formatTokens(event.output_tokens)}
      </TableCell>
      <TableCell className="text-right text-xs">
        {formatTokens(event.total_tokens)}
      </TableCell>
      <TableCell className="text-right text-xs">
        {formatCentsToDollars(event.estimated_cost_cents)}
      </TableCell>
      <TableCell className="text-right text-xs">
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {event.estimate_source}
        </span>
      </TableCell>
    </TableRow>
  );
}

type BudgetEventsTabProps = { dateRange: DateRange };

export function BudgetEventsTab({ dateRange }: BudgetEventsTabProps) {
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);

  const params: BudgetQueryParams = useMemo(() => {
    const p: BudgetQueryParams = { limit: pageSize, offset: page * pageSize };
    if (provider) p.provider_name = provider;
    if (model) p.model_name = model;
    if (dateRange.from) p.from = dateRange.from;
    if (dateRange.to) p.to = dateRange.to;
    return p;
  }, [provider, model, dateRange, page, pageSize]);

  const { data, isLoading } = useUsageEvents(params);

  const events = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filteredEvents = useMemo(() => {
    if (!search) return events;
    const q = search.toLowerCase();
    return events.filter(
      (e) =>
        (e.scope_id ?? "").toLowerCase().includes(q) ||
        (e.context_id ?? "").toLowerCase().includes(q) ||
        (e.provider_name ?? "").toLowerCase().includes(q) ||
        (e.model_name ?? "").toLowerCase().includes(q),
    );
  }, [events, search]);

  const handlePageSizeChange = useCallback((v: string) => {
    setPageSize(Number(v));
    setPage(0);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-64"
          />
        </div>
        <Input
          placeholder="Provider name..."
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="h-8 w-40"
        />
        <Input
          placeholder="Model name..."
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="h-8 w-40"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Page size:</span>
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="h-8 w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Timestamp</TableHead>
                <TableHead className="whitespace-nowrap">Scope</TableHead>
                <TableHead className="whitespace-nowrap">Context</TableHead>
                <TableHead className="whitespace-nowrap">Provider</TableHead>
                <TableHead className="whitespace-nowrap">Model</TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  Input Tokens
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  Output Tokens
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  Total Tokens
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  Cost
                </TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  Source
                </TableHead>
              </TableRow>
            </TableHeader>
            {isLoading ? (
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }).map((__, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            ) : filteredEvents.length === 0 ? (
              <TableBody>
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="text-center text-muted-foreground"
                  >
                    No usage events found
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {filteredEvents.map((event) => (
                  <UsageEventRow key={event.id} event={event} />
                ))}
              </TableBody>
            )}
          </Table>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {total > 0
            ? `Showing ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} of ${total}`
            : "No results"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page + 1 >= totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
