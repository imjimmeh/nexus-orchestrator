import type { WORK_ITEM_STATUS_GROUPS } from "./work-item.schema";

export type WorkItemStatusGroup = keyof typeof WORK_ITEM_STATUS_GROUPS;
