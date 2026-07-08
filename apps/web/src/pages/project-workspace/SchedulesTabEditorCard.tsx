import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { scheduleExpressionPlaceholder } from "./SchedulesTab.helpers";
import type {
  ScheduleEditorState,
  ScheduleWorkflowOption,
} from "./SchedulesTab.types";

interface SchedulesTabEditorCardProps {
  editingJobId: string | null;
  activeWorkflows: ScheduleWorkflowOption[];
  editor: ScheduleEditorState;
  isSubmitting: boolean;
  extraFields?: ReactNode;
  onEditorChange: (key: keyof ScheduleEditorState, value: string) => void;
  onScheduleTypeChange: (value: string) => void;
  onSubmit: () => void;
  onCancelEdit: () => void;
}

export function SchedulesTabEditorCard({
  editingJobId,
  activeWorkflows,
  editor,
  isSubmitting,
  extraFields,
  onEditorChange,
  onScheduleTypeChange,
  onSubmit,
  onCancelEdit,
}: Readonly<SchedulesTabEditorCardProps>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {editingJobId ? "Edit Schedule" : "Create Schedule"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeWorkflows.length === 0 ? (
          <Alert>
            <AlertDescription>
              No active workflows are available. Activate a workflow before
              creating a schedule.
            </AlertDescription>
          </Alert>
        ) : null}

        {extraFields ? (
          <div className="grid gap-4 md:grid-cols-2">{extraFields}</div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="schedule-name">Name</Label>
            <Input
              id="schedule-name"
              value={editor.name}
              onChange={(event) => onEditorChange("name", event.target.value)}
              placeholder="Nightly regression run"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-workflow">Workflow</Label>
            <select
              id="schedule-workflow"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={editor.workflow_id}
              onChange={(event) =>
                onEditorChange("workflow_id", event.target.value)
              }
            >
              <option value="">Select workflow</option>
              {activeWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-type">Schedule Type</Label>
            <select
              id="schedule-type"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={editor.schedule_type}
              onChange={(event) => onScheduleTypeChange(event.target.value)}
            >
              <option value="cron">Cron</option>
              <option value="interval">Interval</option>
              <option value="one_time">One-time</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-expression">Expression</Label>
            <Input
              id="schedule-expression"
              value={editor.schedule_expression}
              onChange={(event) =>
                onEditorChange("schedule_expression", event.target.value)
              }
              placeholder={scheduleExpressionPlaceholder(editor.schedule_type)}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="schedule-timezone">Timezone (cron only)</Label>
            <Input
              id="schedule-timezone"
              value={editor.timezone}
              onChange={(event) =>
                onEditorChange("timezone", event.target.value)
              }
              placeholder="UTC"
              disabled={editor.schedule_type !== "cron"}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="schedule-payload">Payload JSON (optional)</Label>
            <Textarea
              id="schedule-payload"
              value={editor.payload_text}
              onChange={(event) =>
                onEditorChange("payload_text", event.target.value)
              }
              placeholder='{"priority": "p1"}'
              className="min-h-[120px] font-mono text-xs"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={onSubmit}
            disabled={isSubmitting || activeWorkflows.length === 0}
          >
            {isSubmitting
              ? "Saving..."
              : editingJobId
                ? "Update Schedule"
                : "Create Schedule"}
          </Button>

          {editingJobId ? (
            <Button
              variant="outline"
              onClick={onCancelEdit}
              disabled={isSubmitting}
            >
              Cancel Edit
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
