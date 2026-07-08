// apps/web/src/pages/audit/AuditLogTable.tsx
import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuditLog } from "@/hooks/useAuditLog";
import { AuditEventDetail } from "./AuditEventDetail";
import type { AuditLogFilters } from "@/lib/api/client.audit.types";

const PAGE_SIZE = 20;

const EVENT_BADGE_VARIANT: Record<
  string,
  "default" | "destructive" | "secondary" | "outline"
> = {
  "authz.denied": "destructive",
  "authz.role_granted": "default",
  "authz.role_revoked": "secondary",
  "authz.scope_created": "outline",
  "authz.scope_moved": "outline",
  "authz.scope_deleted": "destructive",
};

interface AuditLogTableProps {
  /** When set, the scope filter is locked to this value (used from Scope Detail page) */
  lockedScopeNodeId?: string;
  filters?: Omit<AuditLogFilters, "scopeNodeId" | "limit" | "offset">;
  /** When set (e.g. from a /audit?eventId= deep link), expands that row initially */
  initialExpandedId?: string;
}

export function AuditLogTable({
  lockedScopeNodeId,
  filters = {},
  initialExpandedId,
}: AuditLogTableProps) {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(
    initialExpandedId ?? null,
  );

  const { data, isLoading, isError } = useAuditLog({
    ...filters,
    scopeNodeId: lockedScopeNodeId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (isLoading)
    return <p className="py-4 text-muted-foreground">Loading audit log...</p>;
  if (isError)
    return <p className="py-4 text-destructive">Failed to load audit log.</p>;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Scope</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground"
              >
                No audit events found.
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => (
            <React.Fragment key={entry.id}>
              <TableRow
                className="cursor-pointer hover:bg-accent/40"
                onClick={() => {
                  setExpandedId(expandedId === entry.id ? null : entry.id);
                }}
              >
                <TableCell>
                  {expandedId === entry.id ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={EVENT_BADGE_VARIANT[entry.eventType] ?? "outline"}
                    className="font-mono text-xs"
                  >
                    {entry.eventType}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{entry.userEmail}</TableCell>
                <TableCell className="text-sm">{entry.scopeNodeName}</TableCell>
              </TableRow>
              {expandedId === entry.id && (
                <TableRow>
                  <TableCell colSpan={5} className="p-2">
                    <AuditEventDetail entry={entry} />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => {
              setPage((p) => p - 1);
            }}
          >
            ← Prev
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => {
              setPage((p) => p + 1);
            }}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
