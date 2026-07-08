import { z } from "zod";
import { RegisterRequestSchema } from "../auth/register.schema";

/**
 * Schema for creating a user (admin endpoint)
 * Extends registration schema with admin-controlled fields
 */
export const CreateUserRequestSchema = RegisterRequestSchema.extend({
  role: z.enum(["admin", "user"]).default("user"),
  isActive: z.boolean().default(true),
});

/**
 * Schema for create user response
 * Returns basic user information after creation
 */
export const CreateUserResponseSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.email(),
  roles: z.array(z.enum(["admin", "user"])),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
});

export * from "./create-user.types";
