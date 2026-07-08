import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import {
  WorkflowActivityFeed,
  type WorkflowActivityFeedFilters,
} from "@/components/workflow/WorkflowActivityFeed";

export type WorkflowRunEventsTabProps = {
  events: WorkflowTelemetryEvent[];
  isLoadingTelemetry: boolean;
  activityFilters: WorkflowActivityFeedFilters;
  onActivityFiltersChange: (filters: WorkflowActivityFeedFilters) => void;
};

export function WorkflowRunEventsTab({
  events,
  isLoadingTelemetry,
  activityFilters,
  onActivityFiltersChange,
}: WorkflowRunEventsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity Feed</CardTitle>
      </CardHeader>
      <CardContent>
        <WorkflowActivityFeed
          events={events}
          isLoading={isLoadingTelemetry}
          filters={activityFilters}
          onFiltersChange={onActivityFiltersChange}
        />
      </CardContent>
    </Card>
  );
}
