import { z } from "zod";
import type { LoginRequestSchema, LoginResponseSchema } from "./login.schema";

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
