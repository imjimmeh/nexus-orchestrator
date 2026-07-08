import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProjectGoal } from "@/lib/api/goals.types";

export function GoalWorklogsCard(
  props: Readonly<{
    selectedGoal: ProjectGoal;
    worklogNote: string;
    setWorklogNote: (value: string) => void;
    worklogItemId: string;
    setWorklogItemId: (value: string) => void;
    sortedWorkItems: Array<{ id: string; title: string }>;
    onCreateWorklog: () => void;
    worklogs: Array<{
      id: string;
      entryType: string;
      authorType: string;
      authorName?: string | null;
      created_at: string;
      workItemId?: string | null;
      note: string;
    }>;
    isLoading: boolean;
  }>,
) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Worklogs: {props.selectedGoal.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>Worklog Note</Label>
            <Textarea
              value={props.worklogNote}
              onChange={(event) => props.setWorklogNote(event.target.value)}
              placeholder="Add notes, decisions, or agent updates"
              className="min-h-[90px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Link Work Item (optional)</Label>
            <Select
              value={props.worklogItemId}
              onValueChange={(value) => props.setWorklogItemId(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select work item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No link</SelectItem>
                {props.sortedWorkItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          onClick={props.onCreateWorklog}
          disabled={!props.worklogNote.trim()}
        >
          Add Worklog Entry
        </Button>

        {props.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading worklogs...</p>
        ) : null}

        {!props.isLoading && props.worklogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No worklogs yet for this goal.
          </p>
        ) : null}

        <div className="space-y-2">
          {props.worklogs.map((entry) => (
            <div key={entry.id} className="rounded-md border p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{entry.entryType}</span>
                <span>{entry.authorType}</span>
                {entry.authorName ? <span>{entry.authorName}</span> : null}
                <span>{new Date(entry.created_at).toLocaleString()}</span>
                {entry.workItemId ? (
                  <span>Work item: {entry.workItemId}</span>
                ) : null}
              </div>
              <p className="text-sm">{entry.note}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
