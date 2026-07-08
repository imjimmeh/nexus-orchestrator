import { z } from "zod";

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
export const RESERVED_SPECIAL_STEP_TYPES = [
  "execution",
  "register_tool",
  "invoke_workflow",
  "run_command",
  "web_automation",
  "emit_event",
  "http_webhook",
  "mcp_tool_call",
  "git_operation",
  "manage_tool_candidate",
  "record_metadata",
  "manage_execution",
  "check_orchestration_status",
  "hydrate_work_items_from_specs",
  "transition_status",
  "attempt_merge",
  "manage_worktree",
] as const;

export function isReservedSpecialStepType(value: string): boolean {
  return (RESERVED_SPECIAL_STEP_TYPES as readonly string[]).includes(value);
}

export const specialStepPluginPermissionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("network"),
      hosts: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filesystem"),
      access: z.enum(["read", "write"]),
      paths: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("environment"),
      variables: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("secrets"),
      names: z.array(nonEmptyTrimmedStringSchema).min(1),
    })
    .strict(),
]);

export const specialStepPluginHandlerManifestSchema = z
  .object({
    type: nonEmptyTrimmedStringSchema,
    displayName: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema.optional(),
    inputContract: nonEmptyTrimmedStringSchema,
  })
  .strict();

export const specialStepPluginManifestSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    name: nonEmptyTrimmedStringSchema,
    version: nonEmptyTrimmedStringSchema,
    entrypoint: nonEmptyTrimmedStringSchema,
    specialSteps: z.array(specialStepPluginHandlerManifestSchema).min(1),
    permissions: z.array(specialStepPluginPermissionSchema).optional(),
  })
  .strict()
  .superRefine(({ specialSteps }, context) => {
    const seenTypes = new Set<string>();

    for (const [index, specialStep] of specialSteps.entries()) {
      if (isReservedSpecialStepType(specialStep.type)) {
        context.addIssue({
          code: "custom",
          message: `Reserved special step type: ${specialStep.type}`,
          path: ["specialSteps", index, "type"],
        });
        continue;
      }

      if (seenTypes.has(specialStep.type)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate special step type: ${specialStep.type}`,
          path: ["specialSteps", index, "type"],
        });
        continue;
      }

      seenTypes.add(specialStep.type);
    }
  });
