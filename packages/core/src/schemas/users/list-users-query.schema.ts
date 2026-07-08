import { z } from "zod";
import { PaginationQuerySchema } from "../common/pagination.schema";

/**
 * Schema for the list-users admin query string.
 * Extends pagination with optional filtering fields.
 */
export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  search: z.string().min(1).max(200).optional(),
  role: z.enum(["admin", "user"]).optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "true" ? true : v === "false" ? false : undefined;
    }),
  /**
   * Confines the listing to users with a role assignment at this scope
   * node (the platform-plane full directory is returned when omitted).
   */
  scopeNodeId: z.uuid().optional(),
});

type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export type { ListUsersQuery };
