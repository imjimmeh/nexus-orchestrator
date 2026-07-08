import { Plus, Workflow } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { WorkItemReadinessGroup } from "./kanban.utils";
import {KanbanStatusNotice} from "./types";

interface ReadinessFilterBarProps {
  readinessFilter: "all" | WorkItemReadinessGroup;
  itemsCount: number;
  filterCounts: Record<WorkItemReadinessGroup, number>;
  onReadinessFilterChange: (filter: "all" | WorkItemReadinessGroup) => void;
  onCreateClick: () => void;
}

export function ReadinessFilterBar({
  readinessFilter,
  itemsCount,
  filterCounts,
  onReadinessFilterChange,
  onCreateClick,
}: Readonly<ReadinessFilterBarProps>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={onCreateClick}>
        <Plus className="mr-1 h-4 w-4" />
        New Item
      </Button>
      <Button
        variant={readinessFilter === "all" ? "default" : "outline"}
        size="sm"
        onClick={() => {
          onReadinessFilterChange("all");
        }}
      >
        <Workflow className="mr-1 h-4 w-4" />
        All ({itemsCount})
      </Button>
      <Button
        variant={readinessFilter === "ready" ? "default" : "outline"}
        size="sm"
        onClick={() => {
          onReadinessFilterChange("ready");
        }}
      >
        Ready ({filterCounts.ready})
      </Button>
      <Button
        variant={readinessFilter === "blocked" ? "default" : "outline"}
        size="sm"
        onClick={() => {
          onReadinessFilterChange("blocked");
        }}
      >
        Blocked ({filterCounts.blocked})
      </Button>
      <Button
        variant={readinessFilter === "in-flight" ? "default" : "outline"}
        size="sm"
        onClick={() => {
          onReadinessFilterChange("in-flight");
        }}
      >
        In-flight ({filterCounts["in-flight"]})
      </Button>
      <Button
        variant={readinessFilter === "done" ? "default" : "outline"}
        size="sm"
        onClick={() => {
          onReadinessFilterChange("done");
        }}
      >
        Done ({filterCounts.done})
      </Button>
    </div>
  );
}

export function KanbanStatusAlert({
  statusNotice,
}: Readonly<{ statusNotice: KanbanStatusNotice }>) {
  return (
    <Alert variant={statusNotice.kind === "error" ? "destructive" : "default"}>
      <AlertTitle>
        {statusNotice.kind === "error"
          ? "Unable to update status"
          : "Status updated"}
      </AlertTitle>
      <AlertDescription>{statusNotice.message}</AlertDescription>
    </Alert>
  );
}
