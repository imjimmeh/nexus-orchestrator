import { z } from "zod";
import {
  UpdateUserRequestSchema,
  UpdateUserResponseSchema,
} from "./update-user.schema";

export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
export type UpdateUserResponse = z.infer<typeof UpdateUserResponseSchema>;
