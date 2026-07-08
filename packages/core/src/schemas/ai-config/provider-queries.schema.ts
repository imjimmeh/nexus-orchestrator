import { z } from "zod";
import { PaginationQuerySchema } from "../common/pagination.schema";

export const PROVIDER_SORT_COLUMNS = [
  "name",
  "created_at",
  "is_active",
  "auth_type",
] as const;

export type ProviderSortColumn = (typeof PROVIDER_SORT_COLUMNS)[number];

export const ListProvidersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().min(1).max(200).optional(),
  sortBy: z.enum(PROVIDER_SORT_COLUMNS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional().default("asc"),
  isActive: z.preprocess((v) => {
    if (v === undefined) return undefined;
    if (typeof v === "string") {
      if (v.toLowerCase() === "true") return true;
      if (v.toLowerCase() === "false") return false;
    }
    return undefined;
  }, z.boolean().optional()),
  authType: z.string().optional(),
  /**
   * Confines the listing to providers owned by this scope node
   * (`owner_type === 'scope'`). Global/user-owned providers are not
   * scope-node-partitioned and remain visible regardless.
   */
  scopeNodeId: z.uuid().optional(),
});

export type { ListProvidersQuery } from "./provider-queries.types";
