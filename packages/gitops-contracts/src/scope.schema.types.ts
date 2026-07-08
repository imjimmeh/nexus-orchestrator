// packages/gitops-contracts/src/scope.schema.types.ts

import { z } from "zod";
import { ScopeNodeTypeSchema, ScopeNodeDocSchema } from "./scope.schema";

export type ScopeNodeType = z.infer<typeof ScopeNodeTypeSchema>;
export type ScopeNodeDoc = z.infer<typeof ScopeNodeDocSchema>;
