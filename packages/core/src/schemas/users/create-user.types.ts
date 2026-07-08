import { z } from "zod";
import {
  CreateUserRequestSchema,
  CreateUserResponseSchema,
} from "./create-user.schema";

export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
