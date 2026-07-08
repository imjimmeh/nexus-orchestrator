import type { z } from "zod";

import type {
  PaginatedWorkItemsSchema,
  WorkItemQuerySchema,
} from "./work-item-query.schema";

export type WorkItemQuery = z.infer<typeof WorkItemQuerySchema>;
export type PaginatedWorkItems = z.infer<typeof PaginatedWorkItemsSchema>;
