import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { WorkItem } from "@/lib/api/work-items.types";
import type { WorkItemFilterState } from "./useWorkItemFilters.types";

export function filterWorkItems(
  items: WorkItem[],
  filters: WorkItemFilterState,
): WorkItem[] {
  return items.filter((item) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const haystack = `${item.title} ${item.description ?? ""}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    if (filters.priority && item.priority !== filters.priority) return false;
    if (filters.type && item.type !== filters.type) return false;
    return true;
  });
}

export function useWorkItemFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: WorkItemFilterState = useMemo(
    () => ({
      search: searchParams.get("board_q") ?? undefined,
      priority: searchParams.get("board_priority") ?? undefined,
      type: searchParams.get("board_type") ?? undefined,
    }),
    [searchParams],
  );

  const setFilter = useCallback(
    (key: keyof WorkItemFilterState, value: string) => {
      const param = `board_${key === "search" ? "q" : key}`;
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(param, value);
          else next.delete(param);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { filters, setFilter };
}
