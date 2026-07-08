import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGitOpsStatus } from "@/hooks/useGitOps";
import type { ReconcileSummary } from "@/lib/api/client.gitops.types";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { DriftTable } from "./DriftTable";
import { GitOpsBindingForm } from "./GitOpsBindingForm";
import { GitOpsBindingsPanel } from "./GitOpsBindingsPanel";
import { GitOpsPendingChangesPanel } from "./GitOpsPendingChangesPanel";
import { GitOpsSyncStatusPanel } from "./GitOpsSyncStatusPanel";

const RESULT_VARIANT_MAP: Record<
  ReconcileSummary["result"],
  "default" | "destructive"
> = {
  success: "default",
  failure: "destructive",
};

export function GitOpsStatus() {
  const { data: status, isLoading, isError } = useGitOpsStatus();
  const { activeScopeNodeId, activeScopePath } = useScopeContext();
  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading GitOps status...
      </div>
    );
  }

  if (isError || !status) {
    return (
      <p className="text-sm text-destructive">Failed to load GitOps status.</p>
    );
  }

  // Reconciliation itself is platform-wide (a single GET /gitops/status feed
  // covers every scope, with no scopeNodeId query param), so scoping happens
  // client-side: re-filter the bindings/drift the active scope actually owns
  // whenever it changes, rather than sending scopeNodeId to a query that
  // doesn't accept it.
  const scopedBindings = isGlobalScope
    ? status.bindings
    : status.bindings.filter((b) => b.scopeNodeId === activeScopeNodeId);
  const scopedDrift = isGlobalScope
    ? status.drift
    : status.drift.filter((d) => d.scopeNodeId === activeScopeNodeId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">GitOps</h2>
        <p className="text-sm text-muted-foreground">
          Configure repository bindings, review inbound drift, and sync app-side
          changes back to Git.
        </p>
      </div>

      <GitOpsBindingForm defaultScopeNodeId={activeScopeNodeId} />

      <GitOpsBindingsPanel bindings={scopedBindings} />

      <GitOpsSyncStatusPanel bindings={scopedBindings} drift={scopedDrift} />

      <GitOpsPendingChangesPanel bindings={scopedBindings} />

      <Card>
        <CardHeader>
          <CardTitle>Last Reconcile</CardTitle>
        </CardHeader>
        <CardContent>
          {status.lastReconcile === null ? (
            <p className="text-sm text-muted-foreground">
              No reconcile has run yet.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant={RESULT_VARIANT_MAP[status.lastReconcile.result]}
                >
                  {status.lastReconcile.result}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {new Date(status.lastReconcile.finishedAt).toLocaleString()}
                </span>
                <Link
                  to={`/audit?eventId=${status.lastReconcile.auditEventId}`}
                  className="text-sm underline"
                >
                  View event
                </Link>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span>{status.lastReconcile.summary.update} updated</span>
                <span>{status.lastReconcile.summary.drift} drifted</span>
                <span>{status.lastReconcile.summary.create} created</span>
                <span>{status.lastReconcile.summary.prune} pruned</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!isGlobalScope && (
        <div className="rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
          ℹ Reconciliation is platform-wide. Showing drift filtered to:{" "}
          <strong>
            {activeScopePath[activeScopePath.length - 1] ?? "selected scope"}
          </strong>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inbound Drift And Conflicts</CardTitle>
        </CardHeader>
        <CardContent>
          <DriftTable drift={scopedDrift} />
        </CardContent>
      </Card>
    </div>
  );
}
