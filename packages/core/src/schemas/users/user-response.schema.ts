import { z } from "zod";

/**
 * Schema for user response
 * Complete user information including audit fields
 */
export const UserResponseSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.email(),
  roles: z.array(z.enum(["admin", "user"])),
  isActive: z.boolean(),
  lastLoginAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/**
 * Schema for paginated user list response
 * Includes data array and pagination metadata
 */
export const UserListResponseSchema = z.object({
  data: z.array(UserResponseSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
    totalPages: z.number(),
  }),
});

export * from "./user-response.types";
