import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { WorkflowActivityFeedFilters } from "@/components/workflow/WorkflowActivityFeed";
import {
  applyActivityFiltersToSearchParams,
  toActivityFilters,
} from "./workflow-run-detail.activity-filters";

type UseActivityFilterResult = {
  activityFilters: WorkflowActivityFeedFilters;
  setActivityFilters: (filters: WorkflowActivityFeedFilters) => void;
};

export function useActivityFilter(): UseActivityFilterResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const activityFilters = useMemo(
    () => toActivityFilters(searchParams),
    [searchParams],
  );

  const setActivityFilters = useCallback(
    (filters: WorkflowActivityFeedFilters) => {
      setSearchParams(
        (current) => applyActivityFiltersToSearchParams(current, filters),
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { activityFilters, setActivityFilters };
}
