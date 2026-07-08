import { z } from "zod";

/**
 * Schema for user registration request
 * Validates username (3-50 chars, alphanumeric + underscore), email, and strong password requirements
 */
export const RegisterRequestSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_]+$/),
  email: z.email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, "Must contain uppercase")
    .regex(/[a-z]/, "Must contain lowercase")
    .regex(/[0-9]/, "Must contain number")
    .regex(/[^A-Za-z0-9]/, "Must contain special char"),
});

/**
 * Schema for user registration response
 * Returns user details with tokens for authentication
 */
export const RegisterResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    username: z.string(),
    email: z.email(),
    roles: z.array(z.enum(["admin", "user"])),
    createdAt: z.iso.datetime(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
});

export type { RegisterRequest, RegisterResponse } from "./register.types";
