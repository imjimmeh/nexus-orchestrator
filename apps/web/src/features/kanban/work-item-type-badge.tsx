import type { WorkItemType } from "@nexus/kanban-contracts";
import { WORK_ITEM_TYPE_META } from "./work-item-type.constants";

interface WorkItemTypeBadgeProps {
  readonly type: WorkItemType;
}

export function WorkItemTypeBadge({ type }: Readonly<WorkItemTypeBadgeProps>) {
  const meta = WORK_ITEM_TYPE_META[type];

  return (
    <span
      className={`inline-block rounded px-2 py-1 text-xs font-medium ${meta.className}`}
    >
      {meta.label}
    </span>
  );
}
