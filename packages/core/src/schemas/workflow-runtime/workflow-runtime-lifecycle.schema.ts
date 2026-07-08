import { z } from "zod";
import {
  queryMemoryBodySchema,
  recordLearningBodySchema,
  rememberBodySchema,
  strategicIntentBodySchema,
} from "./workflow-runtime-inputs.schemas";

const setJobOutputDataSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
        ? parsed
        : value;
    } catch {
      return value;
    }
  },
  z.record(z.string(), z.unknown()),
);

const optionalTrimmedNonBlankString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  z.string().trim().min(1).optional(),
);

export const setJobOutputBodySchema = z.object({
  workflow_run_id: z.string().trim().min(1).optional(),
  job_id: z.string().trim().min(1).optional(),
  data: setJobOutputDataSchema,
});

export const setJobOutputInputSchema = z.object({
  data: z
    .looseObject({})
    .describe(
      'Native JSON object containing the output fields for this job. MUST be a plain object literal (e.g. {"key": "value"}). Do NOT pass a JSON-encoded string — pass the object directly, not serialized.',
    ),
});

export const getCapabilitiesBodySchema = z.object({
  workflow_run_id: z.string().trim().min(1).optional(),
  job_id: z.string().trim().min(1).optional(),
  chat_session_id: z.string().trim().min(1).optional(),
});

export const runtimeQueryMemoryBodySchema = queryMemoryBodySchema.extend({
  workflow_run_id: z.string().trim().min(1).optional(),
  job_id: z.string().trim().min(1).optional(),
  entity_id: z.string().trim().min(1),
});

export const runtimeRecordLearningBodySchema = recordLearningBodySchema.and(
  z
    .object({
      workflow_run_id: z.string().trim().min(1).optional(),
      job_id: z.string().trim().min(1).optional(),
    })
    .strip(),
);

// EPIC-212 (Phase 0 Task 3): HTTP body shape for the agent-facing `remember`
// runtime tool. The agent supplies only the durable-memory fields
// (`content`/`memory_type`/`scope`/`tags`/`origin`/`confidence`); the runtime
// injects `workflow_run_id`/`job_id` from the agent token context, but the
// body may carry them explicitly for non-agent callers (tests, tooling).
export const runtimeRememberBodySchema = rememberBodySchema.extend({
  workflow_run_id: z.string().trim().min(1).optional(),
  job_id: z.string().trim().min(1).optional(),
});

// EPIC-208 (Milestone 2): HTTP body shapes for the CEO-cycle strategic
// intent memory operations. The runtime injects workflow_run_id/job_id
// from the agent token context, but the body may supply them explicitly
// for callers that invoke the endpoint outside an agent turn (tests,
// operator tooling). `entity_type` / `entity_id` identify the memory
// scope (CEO cycle / project); `intent` carries the structured payload.
export const runtimeRecordStrategicIntentBodySchema = z
  .object({
    entity_type: z.string().trim().min(1).max(120),
    entity_id: z.string().trim().min(1).max(200),
    intent: strategicIntentBodySchema,
    workflow_run_id: z.string().trim().min(1).optional(),
    job_id: z.string().trim().min(1).optional(),
  })
  .strip();

export const runtimeReadStrategicIntentBodySchema = z
  .object({
    entity_type: z.string().trim().min(1).max(120),
    entity_id: z.string().trim().min(1).max(200),
    workflow_run_id: z.string().trim().min(1).optional(),
    job_id: z.string().trim().min(1).optional(),
  })
  .strip();

export const invokeAgentWorkflowBodySchema = z
  .object({
    workflow_id: optionalTrimmedNonBlankString,
    agent_profile: z.string().trim().min(1).optional(),
    task_prompt: z.string().trim().min(1).optional(),
    trigger_data: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    workflow_run_id: optionalTrimmedNonBlankString,
    reasoning: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .loose();

const awaitAgentWorkflowTargetBodySchema = z
  .object({
    workflow_id: optionalTrimmedNonBlankString,
    agent_profile: z.string().trim().min(1).optional(),
    objective: z.string().trim().min(1).optional(),
    task_prompt: z.string().trim().min(1).optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const awaitAgentWorkflowBodySchema = z
  .object({
    workflows: z.array(awaitAgentWorkflowTargetBodySchema).optional(),
    workflow_id: optionalTrimmedNonBlankString,
    agent_profile: z.string().trim().min(1).optional(),
    objective: z.string().trim().min(1).optional(),
    task_prompt: z.string().trim().min(1).optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    // Attach the await to runs the caller already started (e.g. via delegate_*)
    // instead of launching new children. The calling run is inferred from the
    // request context; workflow_run_id is NOT a target to await.
    awaited_run_ids: z.array(z.string().trim().min(1)).optional(),
    awaited_run_id: optionalTrimmedNonBlankString,
    workflow_run_id: optionalTrimmedNonBlankString,
    reasoning: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .loose();

export const listRunningWorkflowsBodySchema = z
  .object({
    scope_id: optionalTrimmedNonBlankString,
    workflow_run_id: optionalTrimmedNonBlankString,
    limit: z.number().int().positive().max(50).optional(),
  })
  .loose();

export const yieldSessionBodySchema = z.object({
  scope_id: z.string().trim().min(1),
  workflow_run_id: z.string().trim().min(1),
  active_playbook: z.string().trim().min(1).optional(),
  status: z.enum(["completed", "blocked", "partial", "recovered", "escalated"]),
  summary: z.string().trim().min(1),
  recommended_next_playbook: z.string().trim().min(1).optional(),
  notes: z.string().optional(),
});

export const listPathBodySchema = z.object({
  scope_id: z.string().trim().min(1),
  relative_path: z.string().optional(),
});

export const updateOrchestrationStateBodySchema = z.object({
  scope_id: z.string().trim().min(1),
  patch: z.record(z.string(), z.unknown()),
});

export const getAgentProfilesBodySchema = z
  .object({
    include_inactive: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .loose();

export const getAgentProfileBodySchema = z.object({
  name: z.string().trim().min(1),
});

export const listAgentProfileNamesBodySchema = z.object({}).loose();

export const dispatchStartContextItemsBodySchema = z.object({
  scope_id: z.string().trim().min(1),
  context_ids: z.array(z.string().trim().min(1)).min(1),
  workflow_id: z.string().trim().min(1).optional(),
  max_concurrent_per_agent: z.number().int().positive().optional(),
});

export const submitImplementationPlanTaskSchema = z.object({
  id: z.string().describe("Unique task identifier, e.g. task-1"),
  title: z.string(),
  description: z.string().describe("Detailed instructions for this task"),
  depends_on: z
    .array(z.string())
    .optional()
    .describe("IDs of tasks that must complete before this one"),
  agent_profile: z
    .string()
    .optional()
    .describe("Agent profile for execution: senior_dev, qa_automation, etc."),
  delegation_strategy: z
    .enum(["self", "subagent"])
    .describe("Whether the orchestrator should do this itself or delegate"),
  files_to_modify: z
    .array(z.string())
    .optional()
    .describe("Expected file paths to create or modify"),
  acceptance_criteria: z.array(z.string()).optional(),
});

export const submitImplementationPlanInputSchema = z.object({
  summary: z.string().describe("Brief overview of the implementation approach"),
  tasks: z.array(submitImplementationPlanTaskSchema),
  execution_strategy: z
    .enum(["sequential", "parallel", "mixed"])
    .describe("Overall ordering strategy for tasks"),
});

export const createDelegationContractInputSchema = z.object({
  objective: z.string(),
  task_prompt: z.string().optional(),
  success_criteria: z.array(z.string()).optional(),
  agent_profile: z.string(),
  tools: z.array(z.string()).optional(),
  tier: z.enum(["light", "heavy"]),
  assigned_files: z.array(z.string()).optional(),
  allowed_tools: z.array(z.string()).optional(),
  denied_tools: z.array(z.string()).optional(),
  token_budget: z.number().optional(),
  time_budget_ms: z.number().optional(),
  max_retries: z.number().optional(),
  queue_priority: z.number().optional(),
  escalation_path: z.array(z.string()).optional(),
  expected_artifacts: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  parent_delegation_id: z.string().optional(),
  parent_trace_id: z.string().optional(),
  allow_privileged_tools: z.boolean().optional(),
});

export const getDelegationContractInputSchema = z.object({
  contract_id: z.string(),
});

export const cancelDelegationContractInputSchema = z.object({
  contract_id: z.string(),
  reason: z.string().optional(),
});

export const dispatchDelegationContractsInputSchema = z.object({});
export const sweepDelegationTimeoutsInputSchema = z.object({});

export const getDelegationReplayInputSchema = z.object({
  limit: z.number().optional(),
  offset: z.number().optional(),
});
