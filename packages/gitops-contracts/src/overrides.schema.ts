import { z } from "zod";
import {
  GITOPS_API_VERSION,
  ScopePathSchema,
  SlugSchema,
} from "./common.schema";

// Mirrors 204F OverrideStrategy. 'replace' = whole-object; 'merge' = shallow top-level patch.
export const OverrideStrategySchema = z.enum(["replace", "merge"]);
// Mirrors 204F/204G `source` values.
export const OverrideSourceSchema = z.enum([
  "seeded",
  "admin",
  "repository",
  "imported",
  "agent_factory",
]);

/** Shared override envelope; refined per object type for the replace/merge body rule. */
const baseOverride = {
  apiVersion: z.literal(GITOPS_API_VERSION),
  name: SlugSchema,
  scope: ScopePathSchema,
  source: OverrideSourceSchema,
  locked: z.boolean().default(false),
  strategy: OverrideStrategySchema,
  /** whole-object body (replace) — inline OR via bodyRef sidecar. */
  definition: z.record(z.string(), z.unknown()).nullable().default(null),
  /** field patch (merge). */
  overrides: z.record(z.string(), z.unknown()).nullable().default(null),
  /** sidecar filename for large bodies (PROMPT.md / body.yaml / SKILL.md). */
  bodyRef: z.string().min(1).optional(),
};

interface OverrideDocShape {
  strategy: "replace" | "merge";
  definition: Record<string, unknown> | null;
  overrides: Record<string, unknown> | null;
  bodyRef?: string;
}

/** replace => definition OR bodyRef present; merge => overrides present. */
const withBodyRule = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .superRefine((doc, ctx) => {
      const d = doc as unknown as OverrideDocShape;
      if (d.strategy === "replace" && d.definition === null && !d.bodyRef) {
        ctx.addIssue({
          code: "custom",
          message: "replace override requires definition or bodyRef",
        });
      }
      if (d.strategy === "merge" && d.overrides === null) {
        ctx.addIssue({
          code: "custom",
          message: "merge override requires an overrides patch",
        });
      }
    });

export const AgentOverrideDocSchema = withBodyRule({
  ...baseOverride,
  kind: z.literal("AgentOverride"),
});
export const WorkflowOverrideDocSchema = withBodyRule({
  ...baseOverride,
  kind: z.literal("WorkflowOverride"),
});
export const SkillOverrideDocSchema = withBodyRule({
  ...baseOverride,
  kind: z.literal("SkillOverride"),
});

const baseDefinition = {
  apiVersion: z.literal(GITOPS_API_VERSION),
  name: SlugSchema,
  source: OverrideSourceSchema,
  locked: z.boolean().default(false),
  definition: z.record(z.string(), z.unknown()),
};

export const AgentProfileDocSchema = z
  .object({
    ...baseDefinition,
    kind: z.literal("AgentProfile"),
  })
  .strict();

export const WorkflowDocSchema = z
  .object({
    ...baseDefinition,
    kind: z.literal("Workflow"),
  })
  .strict();

export const SkillDocSchema = z
  .object({
    ...baseDefinition,
    kind: z.literal("Skill"),
  })
  .strict();

export type {
  AgentProfileDoc,
  WorkflowDoc,
  SkillDoc,
  AgentOverrideDoc,
  WorkflowOverrideDoc,
  SkillOverrideDoc,
} from "./overrides.schema.types";
