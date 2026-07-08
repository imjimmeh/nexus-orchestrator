import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { GitOpsBindingStatus } from "@/lib/api/client.gitops.types";

interface GitOpsPendingChangesPanelProps {
  bindings: GitOpsBindingStatus[];
}

export function GitOpsPendingChangesPanel({
  bindings,
}: GitOpsPendingChangesPanelProps) {
  const pendingBindings = bindings.filter(
    (binding) => binding.pendingChangeCount > 0,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbound Pending Changes</CardTitle>
      </CardHeader>
      <CardContent>
        {pendingBindings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No outbound pending changes.
          </p>
        ) : (
          <div className="space-y-2">
            {pendingBindings.map((binding) => (
              <div
                key={binding.bindingId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>{binding.name}</span>
                <span className="font-medium">
                  {binding.pendingChangeCount} outbound pending
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
