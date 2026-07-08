import type { WorkItemType } from "@nexus/kanban-contracts";

export const WORK_ITEM_TYPE_META: Record<
  WorkItemType,
  {
    label: string;
    className: string;
  }
> = {
  epic: {
    label: "Epic",
    className: "bg-purple-100 text-purple-700",
  },
  story: {
    label: "Story",
    className: "bg-blue-100 text-blue-700",
  },
  task: {
    label: "Task",
    className: "bg-green-100 text-green-700",
  },
  bug: {
    label: "Bug",
    className: "bg-red-100 text-red-700",
  },
  spike: {
    label: "Spike",
    className: "bg-amber-100 text-amber-700",
  },
};
