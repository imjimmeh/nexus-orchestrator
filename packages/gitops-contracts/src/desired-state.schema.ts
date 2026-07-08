import { z } from "zod";
import { GITOPS_API_VERSION, ScopePathSchema } from "./common.schema";
import { ScopeNodeDocSchema } from "./scope.schema";
import { RoleDocSchema, AssignmentSchema } from "./rbac.schema";
import {
  AgentProfileDocSchema,
  WorkflowDocSchema,
  SkillDocSchema,
  AgentOverrideDocSchema,
  WorkflowOverrideDocSchema,
  SkillOverrideDocSchema,
} from "./overrides.schema";

/** A scope node plus the path it was loaded from (path is the addressing key). */
export const PlacedScopeNodeSchema = z
  .object({ path: ScopePathSchema, doc: ScopeNodeDocSchema })
  .strict();

/** The whole parsed repository as a single in-memory object. */
export const DesiredStateSchema = z
  .object({
    apiVersion: z.literal(GITOPS_API_VERSION),
    nodes: z.array(PlacedScopeNodeSchema),
    roles: z.array(RoleDocSchema),
    assignments: z.array(AssignmentSchema),
    agents: z.array(AgentProfileDocSchema),
    workflows: z.array(WorkflowDocSchema),
    skills: z.array(SkillDocSchema),
    agentOverrides: z.array(AgentOverrideDocSchema),
    workflowOverrides: z.array(WorkflowOverrideDocSchema),
    skillOverrides: z.array(SkillOverrideDocSchema),
  })
  .strict();

export type { DesiredState } from "./desired-state.schema.types";
