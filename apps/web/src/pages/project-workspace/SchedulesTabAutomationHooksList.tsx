import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AutomationHook } from "@/lib/api/projects.types";
import { formatScheduleDate } from "./SchedulesTab.helpers";

interface AutomationHooksListProps {
  readonly hooks: AutomationHook[];
  readonly isLoading: boolean;
  readonly updatePending: boolean;
  readonly deletePending: boolean;
  readonly onToggleEnabled: (hook: AutomationHook) => void;
  readonly onDelete: (hookId: string) => void;
}

function AutomationHooksList({
  hooks,
  isLoading,
  updatePending,
  deletePending,
  onToggleEnabled,
  onDelete,
}: Readonly<AutomationHooksListProps>) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Configured Hooks</p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading hooks...</p>
      ) : hooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hooks configured for this project.
        </p>
      ) : (
        hooks.map((hook) => (
          <div key={hook.id} className="rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant={hook.enabled ? "default" : "outline"}>
                    {hook.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Badge variant="outline">{hook.trigger_type}</Badge>
                  <Badge variant="outline">{hook.action_type}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Priority {hook.priority} • Cooldown{" "}
                  {hook.cooldown_window_seconds}s
                </p>
                <p className="text-xs text-muted-foreground">
                  Last fired: {formatScheduleDate(hook.last_fired_at)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleEnabled(hook)}
                  disabled={updatePending}
                >
                  {hook.enabled ? "Disable" : "Enable"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onDelete(hook.id)}
                  disabled={deletePending}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export { AutomationHooksList };
