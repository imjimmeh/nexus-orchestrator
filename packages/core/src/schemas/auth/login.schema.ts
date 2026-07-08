import { z } from "zod";

/**
 * Schema for user login request
 * Validates username and password presence, with optional remember me flag
 */
export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  rememberMe: z.boolean().default(false),
});

/**
 * Schema for user login response
 * Returns user details with access/refresh tokens and expiration time
 */
export const LoginResponseSchema = z.object({
  user: z.object({
    id: z.uuid(),
    username: z.string(),
    email: z.email(),
    roles: z.array(z.enum(["admin", "user"])),
    createdAt: z.iso.datetime(),
  }),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
});

export type { LoginRequest, LoginResponse } from "./login.types";
