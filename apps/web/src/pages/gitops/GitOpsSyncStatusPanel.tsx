import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  DriftSummary,
  GitOpsBindingStatus,
} from "@/lib/api/client.gitops.types";

interface GitOpsSyncStatusPanelProps {
  bindings: GitOpsBindingStatus[];
  drift: DriftSummary[];
}

export function GitOpsSyncStatusPanel({
  bindings,
  drift,
}: GitOpsSyncStatusPanelProps) {
  const inboundDriftCount = bindings.reduce(
    (total, binding) => total + binding.driftCount,
    0,
  );
  const outboundPendingCount = bindings.reduce(
    (total, binding) => total + binding.pendingChangeCount,
    0,
  );
  const conflictCount = drift.filter(
    (item) => item.category === "conflict",
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync Status</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        <StatusMetric
          title="Inbound drift"
          value={`${inboundDriftCount} inbound drift`}
        />
        <StatusMetric
          title="Outbound pending"
          value={`${outboundPendingCount} outbound pending`}
        />
        <StatusMetric title="Conflicts" value={`${conflictCount} conflict`} />
      </CardContent>
    </Card>
  );
}

function StatusMetric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
