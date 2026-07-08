import {
  DEFAULT_WORKFLOW_ACTIVITY_FILTERS,
  type ActivityQuickType,
  type WorkflowActivityFeedFilters,
} from "@/components/workflow/WorkflowActivityFeed";

export const ACTIVITY_FILTER_QUERY_KEYS = {
  search: "evq",
  showWorkflowEvents: "evwf",
  showToolEvents: "evtl",
  showFailuresOnly: "evf",
  quickType: "evt",
} as const;

export function parseBooleanFilterParam(
  value: string | null,
  fallback: boolean,
): boolean {
  if (value === null) {
    return fallback;
  }

  return value !== "0" && value.toLowerCase() !== "false";
}

export function toQuickType(value: string | null): ActivityQuickType {
  const options: ActivityQuickType[] = [
    "all",
    "step",
    "tool",
    "question",
    "error",
    "completion",
    "system",
  ];

  return value && options.includes(value as ActivityQuickType)
    ? (value as ActivityQuickType)
    : "all";
}

export function toActivityFilters(
  searchParams: URLSearchParams,
): WorkflowActivityFeedFilters {
  return {
    searchQuery:
      searchParams.get(ACTIVITY_FILTER_QUERY_KEYS.search) ??
      DEFAULT_WORKFLOW_ACTIVITY_FILTERS.searchQuery,
    showWorkflowEvents: parseBooleanFilterParam(
      searchParams.get(ACTIVITY_FILTER_QUERY_KEYS.showWorkflowEvents),
      DEFAULT_WORKFLOW_ACTIVITY_FILTERS.showWorkflowEvents,
    ),
    showToolEvents: parseBooleanFilterParam(
      searchParams.get(ACTIVITY_FILTER_QUERY_KEYS.showToolEvents),
      DEFAULT_WORKFLOW_ACTIVITY_FILTERS.showToolEvents,
    ),
    showFailuresOnly: parseBooleanFilterParam(
      searchParams.get(ACTIVITY_FILTER_QUERY_KEYS.showFailuresOnly),
      DEFAULT_WORKFLOW_ACTIVITY_FILTERS.showFailuresOnly,
    ),
    quickType: toQuickType(
      searchParams.get(ACTIVITY_FILTER_QUERY_KEYS.quickType),
    ),
  };
}

export function applyActivityFiltersToSearchParams(
  searchParams: URLSearchParams,
  filters: WorkflowActivityFeedFilters,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);

  if (filters.searchQuery.trim().length === 0) {
    next.delete(ACTIVITY_FILTER_QUERY_KEYS.search);
  } else {
    next.set(ACTIVITY_FILTER_QUERY_KEYS.search, filters.searchQuery);
  }

  if (filters.showWorkflowEvents) {
    next.delete(ACTIVITY_FILTER_QUERY_KEYS.showWorkflowEvents);
  } else {
    next.set(ACTIVITY_FILTER_QUERY_KEYS.showWorkflowEvents, "0");
  }

  if (filters.showToolEvents) {
    next.delete(ACTIVITY_FILTER_QUERY_KEYS.showToolEvents);
  } else {
    next.set(ACTIVITY_FILTER_QUERY_KEYS.showToolEvents, "0");
  }

  if (filters.showFailuresOnly) {
    next.set(ACTIVITY_FILTER_QUERY_KEYS.showFailuresOnly, "1");
  } else {
    next.delete(ACTIVITY_FILTER_QUERY_KEYS.showFailuresOnly);
  }

  if (filters.quickType === "all") {
    next.delete(ACTIVITY_FILTER_QUERY_KEYS.quickType);
  } else {
    next.set(ACTIVITY_FILTER_QUERY_KEYS.quickType, filters.quickType);
  }

  return next;
}
