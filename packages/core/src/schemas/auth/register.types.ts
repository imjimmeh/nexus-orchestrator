import { z } from "zod";
import type {
  RegisterRequestSchema,
  RegisterResponseSchema,
} from "./register.schema";

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;
