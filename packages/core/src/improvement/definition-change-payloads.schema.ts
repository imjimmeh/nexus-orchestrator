/**
 * Payload schemas for the `agent_profile_change` and
 * `workflow_definition_change` improvement proposal kinds (EPIC-D). These
 * kinds already exist on {@link ImprovementProposalKind}
 * (`./improvement-proposal.types`); this module only defines the shape of
 * their `payload` column so the apply/rollback path (EPIC-D, later tasks)
 * has a single validated contract to consume.
 */
import { z } from "zod";
import { AgentProfileToolPolicySchema } from "../schemas/ai-config/profiles.schema";
import { RunnerThinkingLevelSchema } from "../schemas/ai-config/thinking-level.schema";

/** The two supported ways a proposal may change an agent profile's system prompt. */
export const SYSTEM_PROMPT_CHANGE_MODES = ["append", "replace"] as const;

const SystemPromptChangeSchema = z.object({
  mode: z.enum(SYSTEM_PROMPT_CHANGE_MODES),
  value: z.string().trim().min(1),
});

const AssignedSkillsChangeSchema = z
  .object({
    add: z.array(z.string().trim().min(1)).optional(),
    remove: z.array(z.string().trim().min(1)).optional(),
  })
  .refine(
    (change) => (change.add?.length ?? 0) + (change.remove?.length ?? 0) > 0,
    {
      message: "assigned_skills change must add or remove at least one skill",
    },
  );

/**
 * A partial agent-profile mutation. `model_name`/`provider_name` are
 * deliberately NOT nullable: `UpdateAgentProfileSchema` (the apply path) has
 * no way to clear either field to null, so the patch contract must not
 * promise a capability the applier cannot deliver.
 */
export const AgentProfilePatchSchema = z
  .object({
    system_prompt: SystemPromptChangeSchema.optional(),
    model_name: z.string().trim().min(1).optional(),
    provider_name: z.string().trim().min(1).optional(),
    thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
    tool_policy: AgentProfileToolPolicySchema.optional(),
    assigned_skills: AssignedSkillsChangeSchema.optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    {
      message: "patch must change at least one field",
    },
  );

export const AgentProfileChangePayloadSchema = z.object({
  profileName: z.string().trim().min(1),
  patch: AgentProfilePatchSchema,
  changeSummary: z.string().trim().min(1),
});

export const WorkflowChangeSummaryEntrySchema = z.object({
  stepId: z.string().trim().min(1).optional(),
  field: z.string().trim().min(1),
  from: z.string(),
  to: z.string(),
  rationale: z.string().trim().min(1),
});

export const WorkflowDefinitionChangePayloadSchema = z
  .object({
    workflowName: z.string().trim().min(1).optional(),
    workflowId: z.uuid().optional(),
    proposedYaml: z.string().trim().min(1),
    changeSummary: z.array(WorkflowChangeSummaryEntrySchema).min(1),
  })
  .refine(
    (payload) =>
      payload.workflowName !== undefined || payload.workflowId !== undefined,
    {
      message: "workflowName or workflowId is required",
    },
  );
