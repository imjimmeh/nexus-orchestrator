// apps/web/src/lib/work-items/work-item-filter-options.ts
import { WORK_ITEM_TYPES, WorkItemStatusSchema } from "@nexus/kanban-contracts";
import { WORK_ITEM_TYPE_META } from "@/features/kanban/work-item-type.constants";
import type { FilterOption } from "./work-item-filter-options.types";

function humanize(value: string): string {
  const spaced = value.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const WORK_ITEM_STATUS_OPTIONS: FilterOption[] =
  WorkItemStatusSchema.options.map((status) => ({
    value: status,
    label: humanize(status),
  }));

export const WORK_ITEM_PRIORITY_OPTIONS: FilterOption[] = [
  { value: "p1", label: "P1" },
  { value: "p2", label: "P2" },
  { value: "p3", label: "P3" },
];

export const WORK_ITEM_TYPE_OPTIONS: FilterOption[] = WORK_ITEM_TYPES.map(
  (type) => ({
    value: type,
    label: WORK_ITEM_TYPE_META[type].label,
  }),
);
