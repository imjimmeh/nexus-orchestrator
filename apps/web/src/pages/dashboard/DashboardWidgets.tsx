import { Link } from "react-router-dom";
import { Activity, AlertTriangle, PauseCircle, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { formatDistanceToNowSafe } from "@/lib/utils";

export function QuickActions({
  hasActiveRuns,
}: Readonly<{ hasActiveRuns: boolean }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Actions</CardTitle>
        <CardDescription>
          Jump into common workflows and operations
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <Button asChild className="justify-start gap-2">
          <Link to="/projects/new">
            <Plus className="h-4 w-4" />
            Create Project
          </Link>
        </Button>
        <Button variant="outline" asChild className="justify-start gap-2">
          <Link to="/work-items">
            <Plus className="h-4 w-4" />
            Create Work Item
          </Link>
        </Button>
        <Button variant="outline" asChild className="justify-start gap-2">
          <Link to="/workflows">
            <Play className="h-4 w-4" />
            Start Workflow
          </Link>
        </Button>
        <Button variant="outline" asChild className="justify-start gap-2">
          <Link to="/work-items?filter=blocked">
            <AlertTriangle className="h-4 w-4" />
            View Blocked Items
          </Link>
        </Button>
        {hasActiveRuns ? (
          <Button variant="outline" asChild className="justify-start gap-2">
            <Link to="/sessions">
              <PauseCircle className="h-4 w-4" />
              Resume Last Session
            </Link>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ActivityFeed({
  activeRuns,
}: Readonly<{ activeRuns: WorkflowRun[] }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Feed</CardTitle>
        <CardDescription>
          Recent executions and platform activity
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activeRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
            <Activity className="mb-4 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">No recent activity</p>
            <p className="text-xs text-muted-foreground">
              Start a workflow to populate the timeline.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeRuns.slice(0, 10).map((run) => (
              <div key={run.id} className="relative pl-6">
                <div className="absolute left-0 top-1 h-3 w-3 rounded-full bg-info" />
                <div className="absolute left-[5px] top-5 h-[calc(100%-12px)] w-px bg-border" />
                <Link
                  to={`/workflows/${run.workflow_id}/runs/${run.id}`}
                  className="block transition-colors hover:text-foreground"
                >
                  <p className="text-sm font-medium">
                    Workflow run {run.id.slice(0, 8)} started
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {run.current_step_id
                      ? `Step ${run.current_step_id}`
                      : "Pending start"}{" "}
                    ·{" "}
                    {formatDistanceToNowSafe(
                      run.started_at ?? run.created_at,
                      "moments ago",
                    )}
                  </p>
                </Link>
              </div>
            ))}
            <div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/events">View all events</Link>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
