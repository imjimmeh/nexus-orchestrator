// apps/web/src/pages/audit/AuditLogPage.tsx
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Shield } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScopeNodePicker } from "@/components/scope/ScopeNodePicker";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { AuditLogTable } from "./AuditLogTable";
import type { AuditLogFilters } from "@/lib/api/client.audit.types";

const EVENT_TYPES = [
  "authz.denied",
  "authz.role_granted",
  "authz.role_revoked",
  "authz.scope_created",
  "authz.scope_moved",
  "authz.scope_deleted",
];

const DATE_RANGES: { label: string; hours: number }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 30 days", hours: 720 },
];

/** GLOBAL_SCOPE_NODE_ID maps to `undefined` (all accessible scopes), matching
 * the "All scopes" option in ScopeNodePicker and the backend's `!scopeNodeId`
 * unfiltered branch in AuditController#list. */
function scopeNodeIdForActiveScope(
  activeScopeNodeId: string,
): string | undefined {
  return activeScopeNodeId === GLOBAL_SCOPE_NODE_ID
    ? undefined
    : activeScopeNodeId;
}

export function AuditLogPage() {
  const [searchParams] = useSearchParams();
  const deepLinkedEventId = searchParams.get("eventId") ?? undefined;
  const { activeScopeNodeId } = useScopeContext();
  const [scopeNodeId, setScopeNodeId] = useState<string | undefined>(() =>
    scopeNodeIdForActiveScope(activeScopeNodeId),
  );
  // Follow the app-wide active scope by default; the picker above still lets
  // the user override the filter until the active scope changes again.
  useEffect(() => {
    setScopeNodeId(scopeNodeIdForActiveScope(activeScopeNodeId));
  }, [activeScopeNodeId]);
  const [eventType, setEventType] = useState<string | undefined>();
  const [rangeHours, setRangeHours] = useState(168); // default 7 days

  const fromDate = new Date(
    Date.now() - rangeHours * 3600 * 1000,
  ).toISOString();

  const filters: Omit<AuditLogFilters, "scopeNodeId" | "limit" | "offset"> = {
    eventType,
    from: fromDate,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Audit Log</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <ScopeNodePicker
            value={scopeNodeId}
            onChange={setScopeNodeId}
            placeholder="All scopes"
            includeGlobal
          />
        </div>
        <Select
          value={eventType ?? "all"}
          onValueChange={(v) => {
            setEventType(v === "all" ? undefined : v);
          }}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {EVENT_TYPES.map((et) => (
              <SelectItem key={et} value={et}>
                {et}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(rangeHours)}
          onValueChange={(v) => {
            setRangeHours(Number(v));
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.hours} value={String(r.hours)}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AuditLogTable
        lockedScopeNodeId={scopeNodeId}
        filters={filters}
        initialExpandedId={deepLinkedEventId}
      />
    </div>
  );
}
