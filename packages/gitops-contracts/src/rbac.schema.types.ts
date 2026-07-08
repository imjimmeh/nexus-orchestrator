// packages/gitops-contracts/src/rbac.schema.types.ts

import { z } from "zod";
import {
  RoleDocSchema,
  AssignmentSchema,
  AssignmentDocSchema,
} from "./rbac.schema";

export type RoleDoc = z.infer<typeof RoleDocSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type AssignmentDoc = z.infer<typeof AssignmentDocSchema>;
