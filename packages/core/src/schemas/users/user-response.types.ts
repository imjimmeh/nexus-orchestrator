import { z } from "zod";
import {
  UserResponseSchema,
  UserListResponseSchema,
} from "./user-response.schema";

export type UserResponse = z.infer<typeof UserResponseSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
