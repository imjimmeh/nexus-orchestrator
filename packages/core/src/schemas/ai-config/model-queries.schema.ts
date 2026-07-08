import { z } from "zod";
import { PaginationQuerySchema } from "../common/pagination.schema";

export const MODEL_SORT_COLUMNS = [
  "name",
  "created_at",
  "is_active",
  "provider_name",
] as const;

export type ModelSortColumn = (typeof MODEL_SORT_COLUMNS)[number];

export const ListModelsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().min(1).max(200).optional(),
  sortBy: z.enum(MODEL_SORT_COLUMNS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional().default("asc"),
  isActive: z.preprocess((v) => {
    if (v === undefined) return undefined;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
    return undefined;
  }, z.boolean().optional()),
  providerName: z.string().optional(),
});

export type { ListModelsQuery } from "./model-queries.types";
