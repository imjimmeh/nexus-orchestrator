import { useMemo, useState } from "react";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type {
  ActivityItem,
  ActivityQuickType,
  WorkflowActivityFeedFilters,
} from "./workflow-activity-feed.types";
import {
  DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
  normalizeEvents,
} from "./workflow-activity-feed.helpers";

export function useActivityFilters(
  events: WorkflowTelemetryEvent[],
  externalFilters?: WorkflowActivityFeedFilters,
  onFiltersChange?: (filters: WorkflowActivityFeedFilters) => void,
): {
  currentFilters: WorkflowActivityFeedFilters;
  filteredEvents: ActivityItem[];
  normalizedCount: number;
  setSearchQuery: (value: string) => void;
  setShowWorkflowEvents: (value: boolean) => void;
  setShowToolEvents: (value: boolean) => void;
  setShowFailuresOnly: (value: boolean) => void;
  setQuickType: (value: ActivityQuickType) => void;
} {
  const [internalFilters, setInternalFilters] =
    useState<WorkflowActivityFeedFilters>(DEFAULT_WORKFLOW_ACTIVITY_FILTERS);

  const currentFilters = externalFilters ?? internalFilters;

  function setFilters(nextFilters: WorkflowActivityFeedFilters) {
    if (!externalFilters) {
      setInternalFilters(nextFilters);
    }
    onFiltersChange?.(nextFilters);
  }

  const normalizedEvents = useMemo(() => normalizeEvents(events), [events]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = currentFilters.searchQuery.trim().toLowerCase();

    return normalizedEvents.filter((item) => {
      if (item.category === "workflow" && !currentFilters.showWorkflowEvents)
        return false;
      if (item.category === "tool" && !currentFilters.showToolEvents)
        return false;
      if (currentFilters.showFailuresOnly && !item.isFailureLike) return false;
      if (
        currentFilters.quickType !== "all" &&
        item.quickType !== currentFilters.quickType
      )
        return false;
      if (
        normalizedQuery.length > 0 &&
        !item.searchText.includes(normalizedQuery)
      )
        return false;
      return true;
    });
  }, [currentFilters, normalizedEvents]);

  return {
    currentFilters,
    filteredEvents,
    normalizedCount: normalizedEvents.length,
    setSearchQuery: (value) =>
      setFilters({ ...currentFilters, searchQuery: value }),
    setShowWorkflowEvents: (value) =>
      setFilters({ ...currentFilters, showWorkflowEvents: value }),
    setShowToolEvents: (value) =>
      setFilters({ ...currentFilters, showToolEvents: value }),
    setShowFailuresOnly: (value) =>
      setFilters({ ...currentFilters, showFailuresOnly: value }),
    setQuickType: (value) =>
      setFilters({ ...currentFilters, quickType: value }),
  };
}
