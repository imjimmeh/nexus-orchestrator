import { ChevronRight, Search, Wrench } from "lucide-react";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { FilterCheckbox } from "@/components/ui/filter-checkbox";
import {
  formatEventTime,
  QUICK_TYPE_OPTIONS,
} from "./workflow-activity-feed.helpers";
import { useActivityFilters } from "./workflow-activity-feed.hooks";
import type {
  ActivityItem,
  ActivityQuickType,
  WorkflowActivityFeedFilters,
} from "./workflow-activity-feed.types";

type WorkflowActivityFeedProps = {
  events: WorkflowTelemetryEvent[];
  isLoading: boolean;
  filters?: WorkflowActivityFeedFilters;
  onFiltersChange?: (filters: WorkflowActivityFeedFilters) => void;
};

export { DEFAULT_WORKFLOW_ACTIVITY_FILTERS } from "./workflow-activity-feed.helpers";
export type {
  ActivityQuickType,
  WorkflowActivityFeedFilters,
} from "./workflow-activity-feed.types";

type ActivityFiltersProps = {
  searchQuery: string;
  showWorkflowEvents: boolean;
  showToolEvents: boolean;
  showFailuresOnly: boolean;
  quickType: ActivityQuickType;
  filteredCount: number;
  totalCount: number;
  onSearchQueryChange: (value: string) => void;
  onShowWorkflowEventsChange: (value: boolean) => void;
  onShowToolEventsChange: (value: boolean) => void;
  onShowFailuresOnlyChange: (value: boolean) => void;
  onQuickTypeChange: (value: ActivityQuickType) => void;
};

function ActivityFilters({
  searchQuery,
  showWorkflowEvents,
  showToolEvents,
  showFailuresOnly,
  quickType,
  filteredCount,
  totalCount,
  onSearchQueryChange,
  onShowWorkflowEventsChange,
  onShowToolEventsChange,
  onShowFailuresOnlyChange,
  onQuickTypeChange,
}: Readonly<ActivityFiltersProps>) {
  return (
    <Card className="border-dashed bg-gradient-to-br from-muted/40 via-card to-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Find Activity Quickly</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="pl-9"
            placeholder="Search event type, tool, step, job, message, or payload"
            aria-label="Search activity"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <FilterCheckbox
            checked={showWorkflowEvents}
            onCheckedChange={onShowWorkflowEventsChange}
            label="Workflow events"
          />
          <FilterCheckbox
            checked={showToolEvents}
            onCheckedChange={onShowToolEventsChange}
            label="Tool events"
          />
          <FilterCheckbox
            checked={showFailuresOnly}
            onCheckedChange={onShowFailuresOnlyChange}
            label="Failures only"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {QUICK_TYPE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={quickType === option.value ? "default" : "outline"}
              onClick={() => onQuickTypeChange(option.value)}
              aria-label={`Quick filter ${option.label}`}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {filteredCount} of {totalCount} events
        </p>
      </CardContent>
    </Card>
  );
}

function ActivityList({ items }: Readonly<{ items: ActivityItem[] }>) {
  return (
    <Accordion type="multiple" className="space-y-3">
      {items.map((item) => (
        <AccordionItem
          key={item.key}
          value={item.key}
          className={`overflow-hidden rounded-xl border bg-card/80 px-4 shadow-sm transition-colors ${
            item.isRateLimitRetry
              ? "border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/20"
              : item.isFailureLike
                ? "border-destructive/40"
                : "border-border"
          }`}
        >
          <AccordionTrigger className="py-3 hover:no-underline">
            <div className="flex w-full flex-col gap-2 pr-4 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={item.category === "tool" ? "secondary" : "outline"}
                  className="capitalize"
                >
                  {item.category}
                </Badge>
                {item.isFailureLike && (
                  <Badge variant="destructive">Failure</Badge>
                )}
                {item.isRateLimitRetry && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    Rate limit retry
                  </Badge>
                )}
                <span className="text-sm font-semibold leading-tight text-foreground">
                  {item.event.event_type}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatEventTime(item.event.timestamp)}</span>
                {item.toolName && (
                  <span className="inline-flex items-center gap-1">
                    <Wrench className="h-3.5 w-3.5" />
                    {item.toolName}
                  </span>
                )}
                {item.stepId && <span>Step: {item.stepId}</span>}
                {item.jobId && <span>Job: {item.jobId}</span>}
              </div>

              {item.summary && (
                <p
                  className={`line-clamp-2 text-xs ${
                    item.isFailureLike
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {item.summary}
                </p>
              )}
            </div>
          </AccordionTrigger>

          <AccordionContent className="space-y-3 pb-4">
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <span className="font-semibold text-foreground">Category:</span>{" "}
                {item.category}
              </div>
              <div>
                <span className="font-semibold text-foreground">
                  Timestamp:
                </span>{" "}
                {formatEventTime(item.event.timestamp)}
              </div>
              <div>
                <span className="font-semibold text-foreground">Step:</span>{" "}
                {item.stepId ?? "-"}
              </div>
              <div>
                <span className="font-semibold text-foreground">Job:</span>{" "}
                {item.jobId ?? "-"}
              </div>
              <div className="sm:col-span-2">
                <span className="font-semibold text-foreground">Tool:</span>{" "}
                {item.toolName ?? "-"}
              </div>
            </div>
            <pre className="max-h-[320px] overflow-auto rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              {JSON.stringify(item.event.payload, null, 2)}
            </pre>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ActivityContent({
  totalCount,
  items,
}: Readonly<{ totalCount: number; items: ActivityItem[] }>) {
  if (totalCount === 0) {
    return <p className="text-sm text-muted-foreground">No events yet.</p>;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No events match the selected filters.
      </p>
    );
  }

  return <ActivityList items={items} />;
}

export function WorkflowActivityFeed({
  events,
  isLoading,
  filters,
  onFiltersChange,
}: Readonly<WorkflowActivityFeedProps>) {
  const {
    currentFilters,
    filteredEvents,
    normalizedCount,
    setSearchQuery,
    setShowWorkflowEvents,
    setShowToolEvents,
    setShowFailuresOnly,
    setQuickType,
  } = useActivityFilters(events, filters, onFiltersChange);

  if (isLoading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <ChevronRight className="h-5 w-5 animate-pulse text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ActivityFilters
        searchQuery={currentFilters.searchQuery}
        showWorkflowEvents={currentFilters.showWorkflowEvents}
        showToolEvents={currentFilters.showToolEvents}
        showFailuresOnly={currentFilters.showFailuresOnly}
        quickType={currentFilters.quickType}
        filteredCount={filteredEvents.length}
        totalCount={normalizedCount}
        onSearchQueryChange={setSearchQuery}
        onShowWorkflowEventsChange={setShowWorkflowEvents}
        onShowToolEventsChange={setShowToolEvents}
        onShowFailuresOnlyChange={setShowFailuresOnly}
        onQuickTypeChange={setQuickType}
      />

      <ActivityContent totalCount={normalizedCount} items={filteredEvents} />
    </div>
  );
}
