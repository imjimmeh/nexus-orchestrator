import { WorkItem } from "@/lib/api/work-items.types";

/**
 * The global work-item list endpoint serializes timestamps as camelCase
 * (`updatedAt`/`createdAt`) via `toWorkItemRecord`, whereas the canonical
 * `WorkItem` type declares the snake_case `updated_at`/`created_at`. This row
 * type augments `WorkItem` with the camelCase timestamps actually present at
 * runtime so the table can sort/render the "Updated" column with strong typing.
 */
export type WorkItemListRow = WorkItem & {
  updatedAt?: string;
  createdAt?: string;
};
