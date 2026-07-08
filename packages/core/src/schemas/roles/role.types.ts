import { z } from "zod";
import {
  RoleSchema,
  RoleResponseSchema,
  RoleListResponseSchema,
} from "./role.schema";

export type Role = z.infer<typeof RoleSchema>;
export type RoleResponse = z.infer<typeof RoleResponseSchema>;
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
