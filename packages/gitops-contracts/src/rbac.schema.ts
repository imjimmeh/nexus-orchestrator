import { z } from "zod";
import {
  GITOPS_API_VERSION,
  ScopePathSchema,
  SlugSchema,
} from "./common.schema";

/** `resource:action` shape only; existence-in-catalog is a Task-5 integrity check. */
export const PermissionNameSchema = z
  .string()
  .regex(/^[a-z_]+:[a-z]+$/, 'permission must be "resource:action"');

export const RoleDocSchema = z
  .object({
    apiVersion: z.literal(GITOPS_API_VERSION),
    kind: z.literal("Role"),
    name: SlugSchema,
    description: z.string().max(1024).optional(),
    /** null = global custom role; a path = org-local role owned by that subtree (204C owner_scope_node_id). */
    ownerScope: ScopePathSchema.nullable().default(null),
    permissions: z.array(PermissionNameSchema).min(1),
  })
  .strict();

export type { RoleDoc } from "./rbac.schema.types";

export const AssignmentSchema = z
  .object({
    user: z.string().min(1), // stable username, resolved to user_id on apply (204I)
    role: z.string().min(1), // role name (system or custom)
    scope: ScopePathSchema, // node the grant is bound to (inherits downward — 204C)
  })
  .strict();

export type { Assignment } from "./rbac.schema.types";

export const AssignmentDocSchema = z
  .object({
    apiVersion: z.literal(GITOPS_API_VERSION),
    kind: z.literal("AssignmentList"),
    assignments: z.array(AssignmentSchema),
  })
  .strict();

export type { AssignmentDoc } from "./rbac.schema.types";
