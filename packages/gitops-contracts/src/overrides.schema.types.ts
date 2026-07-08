// packages/gitops-contracts/src/overrides.schema.types.ts

import { z } from "zod";
import {
  AgentProfileDocSchema,
  WorkflowDocSchema,
  SkillDocSchema,
  AgentOverrideDocSchema,
  WorkflowOverrideDocSchema,
  SkillOverrideDocSchema,
} from "./overrides.schema";

export type AgentProfileDoc = z.infer<typeof AgentProfileDocSchema>;
export type WorkflowDoc = z.infer<typeof WorkflowDocSchema>;
export type SkillDoc = z.infer<typeof SkillDocSchema>;
export type AgentOverrideDoc = z.infer<typeof AgentOverrideDocSchema>;
export type WorkflowOverrideDoc = z.infer<typeof WorkflowOverrideDocSchema>;
export type SkillOverrideDoc = z.infer<typeof SkillOverrideDocSchema>;
