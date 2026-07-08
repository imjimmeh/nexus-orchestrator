import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useApplyGitOpsBinding,
  useOutboundSyncGitOpsBinding,
  usePlanGitOpsBinding,
} from "@/hooks/useGitOps";
import type { GitOpsBindingStatus } from "@/lib/api/client.gitops.types";
import { GitOpsBindingEditDialog } from "./GitOpsBindingEditDialog";

interface GitOpsBindingsPanelProps {
  bindings: GitOpsBindingStatus[];
}

export function GitOpsBindingsPanel({ bindings }: GitOpsBindingsPanelProps) {
  const [editing, setEditing] = useState<{
    scopeNodeId: string;
    bindingId: string;
  } | null>(null);
  const plan = usePlanGitOpsBinding();
  const apply = useApplyGitOpsBinding();
  const outboundSync = useOutboundSyncGitOpsBinding();

  if (bindings.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Add a repository binding to start syncing workflows, agents, skills,
            roles, and scope configuration.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Repository Bindings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {bindings.map((binding) => (
            <div
              key={binding.bindingId}
              className="rounded-lg border p-4 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{binding.name}</h3>
                    <Badge variant={binding.enabled ? "default" : "secondary"}>
                      {binding.enabled ? "enabled" : "disabled"}
                    </Badge>
                    <Badge variant="outline">{binding.syncMode}</Badge>
                  </div>
                  <p className="font-mono text-xs text-muted-foreground">
                    {binding.scopeNodeId}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEditing({
                        scopeNodeId: binding.scopeNodeId,
                        bindingId: binding.bindingId,
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      plan.mutate({
                        scopeNodeId: binding.scopeNodeId,
                        bindingId: binding.bindingId,
                      })
                    }
                  >
                    Plan
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      apply.mutate({
                        scopeNodeId: binding.scopeNodeId,
                        bindingId: binding.bindingId,
                      })
                    }
                  >
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      outboundSync.mutate({
                        scopeNodeId: binding.scopeNodeId,
                        bindingId: binding.bindingId,
                      })
                    }
                  >
                    {outboundSync.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Sync to Git
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                <span>{binding.driftCount} inbound drift</span>
                <span>{binding.pendingChangeCount} outbound pending</span>
                <span>
                  Last revision: {binding.lastAppliedRevision ?? "never"}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      {editing && (
        <GitOpsBindingEditDialog
          scopeNodeId={editing.scopeNodeId}
          bindingId={editing.bindingId}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
        />
      )}
    </>
  );
}
