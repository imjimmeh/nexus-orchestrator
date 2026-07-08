import { z } from "zod";

export const RoleSchema = z.object({
  id: z.uuid(),
  name: z.enum(["admin", "user"]),
  description: z.string(),
});

export const RoleResponseSchema = z.object({
  id: z.uuid(),
  name: z.enum(["admin", "user"]),
  description: z.string(),
  permissions: z.array(z.string()).optional(),
});

export const RoleListResponseSchema = z.object({
  data: z.array(RoleSchema),
});

export * from "./role.types";
