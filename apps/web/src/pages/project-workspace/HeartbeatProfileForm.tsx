import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { HeartbeatFormSetters } from "./useSchedulesTabHeartbeatCard";
import type { HeartbeatFormState, WorkflowOption } from "./SchedulesTabHeartbeatCard.shared";

interface HeartbeatProfileFormProps {
  readonly state: HeartbeatFormState;
  readonly workflows: ReadonlyArray<WorkflowOption>;
  readonly isSaving: boolean;
  readonly setters: HeartbeatFormSetters;
  readonly onCreate: () => void;
}

function HeartbeatProfileForm({
  state,
  workflows,
  isSaving,
  setters,
  onCreate,
}: Readonly<HeartbeatProfileFormProps>) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="heartbeat-name">Name</Label>
          <Input
            id="heartbeat-name"
            value={state.name}
            onChange={(event) => setters.setName(event.target.value)}
            placeholder="Daily delivery check"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="heartbeat-workflow">Workflow</Label>
          <select
            id="heartbeat-workflow"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={state.workflowId}
            onChange={(event) => setters.setWorkflowId(event.target.value)}
          >
            <option value="">Select workflow</option>
            {workflows.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="heartbeat-interval">Interval (seconds)</Label>
          <Input
            id="heartbeat-interval"
            type="number"
            min={10}
            value={state.intervalSecondsText}
            onChange={(event) =>
              setters.setIntervalSecondsText(event.target.value)
            }
          />
        </div>

        <div className="flex items-center gap-2 self-end pb-2">
          <input
            id="heartbeat-enabled"
            type="checkbox"
            checked={state.enabled}
            onChange={(event) => setters.setEnabled(event.target.checked)}
          />
          <Label htmlFor="heartbeat-enabled">Enable profile</Label>
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="heartbeat-payload">Payload JSON (optional)</Label>
          <Textarea
            id="heartbeat-payload"
            value={state.payloadText}
            onChange={(event) => setters.setPayloadText(event.target.value)}
            placeholder='{"window":"24h"}'
            className="min-h-[90px] font-mono text-xs"
          />
        </div>
      </div>

      <Button onClick={onCreate} disabled={isSaving}>
        {isSaving ? "Saving..." : "Add Heartbeat Profile"}
      </Button>
    </div>
  );
}

export { HeartbeatProfileForm };
export type { HeartbeatProfileFormProps };
