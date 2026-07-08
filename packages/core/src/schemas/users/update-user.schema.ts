import { z } from "zod";

/**
 * Schema for updating a user (admin endpoint)
 * All fields optional - at least one must be provided
 */
export const UpdateUserRequestSchema = z
  .object({
    username: z
      .string()
      .min(3)
      .max(50)
      .regex(/^[a-zA-Z0-9_]+$/)
      .optional(),
    email: z.email().optional(),
    role: z.enum(["admin", "user"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided",
  });

/**
 * Schema for update user response
 * Returns updated user information
 */
export const UpdateUserResponseSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.email(),
  roles: z.array(z.enum(["admin", "user"])),
  isActive: z.boolean(),
  updatedAt: z.iso.datetime(),
});

export * from "./update-user.types";
