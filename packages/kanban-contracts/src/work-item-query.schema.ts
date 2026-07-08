import { z } from "zod";
import { WorkItemSchema, WorkItemStatusSchema } from "./work-item.schema";

export const WORK_ITEM_SORT_FIELDS = [
  "updated_at",
  "created_at",
  "title",
  "status",
  "priority",
] as const;

export const WorkItemSortFieldSchema = z.enum(WORK_ITEM_SORT_FIELDS);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Accepts a string ("a,b"), a real array, or undefined and yields a string[] or undefined. */
function csvArray<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      const parts = Array.isArray(value) ? value : value.split(",");
      return parts.map((p) => p.trim()).filter((p) => p.length > 0);
    })
    .pipe(z.array(item).optional());
}

export const WorkItemQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  status: csvArray(WorkItemStatusSchema),
  priority: csvArray(z.string().min(1)),
  projectId: z.string().min(1).optional(),
  sortBy: WorkItemSortFieldSchema.default("updated_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMIT)
    .transform((v) => Math.min(v, MAX_LIMIT)),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PaginatedWorkItemsSchema = z.object({
  items: z.array(WorkItemSchema),
  total: z.number().int().min(0),
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
});
