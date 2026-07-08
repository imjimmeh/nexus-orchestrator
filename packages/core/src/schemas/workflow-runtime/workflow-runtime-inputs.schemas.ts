import { z } from "zod";
import { ScheduledJobScope, ScheduledJobStatus } from "../../interfaces";
import { providerOwnerTypeSchema } from "../ai-config/providers.schema";
import { TodoStatusSchema } from "../tools/todo/todo.schemas.js";
export {
  browserActionSchema,
  BrowserCloseSchema as browserCloseSchema,
  BrowserArtifactsListSchema as browserArtifactListSchema,
  BrowserArtifactsGetSchema as browserArtifactGetSchema,
} from "../tools/browser/browser.schemas.js";

// ─── Shared primitives ─────────────────────────────────────────────────────

const MEMORY_ENTITY_TYPES = ["User", "Project", "System"] as const;
const MEMORY_TYPES = [
  "preference",
  "fact",
  "history",
  "strategic_intent",
] as const;
const SCHEDULE_TYPE_VALUES = ["cron", "interval", "once"] as const;
const LEARNING_SCOPE_TYPE_MAX_LENGTH = 80;
const LEARNING_SCOPE_ID_MAX_LENGTH = 160;
const LEARNING_LESSON_MAX_LENGTH = 4000;
const LEARNING_EVIDENCE_FIELD_MAX_LENGTH = 1000;
const LEARNING_TAG_MAX_LENGTH = 80;
const LEARNING_TAGS_MAX_COUNT = 20;
const STRATEGIC_INTENT_HORIZON_MAX_LENGTH = 64;
const STRATEGIC_INTENT_THEME_MAX_LENGTH = 200;
const STRATEGIC_INTENT_FOCUS_AREA_MAX_LENGTH = 200;
const STRATEGIC_INTENT_CONSTRAINT_MAX_LENGTH = 400;
const STRATEGIC_INTENT_AGENT_ID_MAX_LENGTH = 120;
const STRATEGIC_INTENT_THEMES_MAX_COUNT = 32;
const STRATEGIC_INTENT_FOCUS_AREAS_MAX_COUNT = 32;
const STRATEGIC_INTENT_CONSTRAINTS_MAX_COUNT = 32;
const WEB_SEARCH_MAX_RESULTS = 10;
const WEB_FETCH_DEFAULT_MAX_BYTES = 100_000;
const WEB_FETCH_MAX_BYTES = 1_000_000;
const WEB_FETCH_DEFAULT_TIMEOUT_MS = 10_000;
const WEB_FETCH_MAX_TIMEOUT_MS = 60_000;

const learningScopeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(LEARNING_SCOPE_TYPE_MAX_LENGTH)
  .regex(/^[a-z][a-z0-9_.-]*$/);

const learningScopeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(LEARNING_SCOPE_ID_MAX_LENGTH);

const memoryEntityTypeSchema = z.union([
  z.enum(MEMORY_ENTITY_TYPES),
  learningScopeTypeSchema,
]);

const learningEvidenceSchema = z
  .object({
    kind: z.string().trim().min(1).max(LEARNING_EVIDENCE_FIELD_MAX_LENGTH),
    id: z.string().trim().min(1).max(LEARNING_EVIDENCE_FIELD_MAX_LENGTH),
    summary: z.string().trim().min(1).max(LEARNING_EVIDENCE_FIELD_MAX_LENGTH),
  })
  .strip();

const runtimeTodoListItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  // Normalise underscore variants emitted by AI models (e.g. "in_progress" → "in-progress")
  // at the agent input boundary before strict enum validation.
  status: z.preprocess(
    (val) => (typeof val === "string" ? val.replace(/_/g, "-") : val),
    TodoStatusSchema,
  ),
  source_context_item_id: z.string().optional(),
});

const runtimePaginationSchema = z.object({
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// ─── Context schemas ───────────────────────────────────────────────────────

export const getCapabilitiesSchema = z.object({
  workflow_run_id: z.string().optional(),
  job_id: z.string().optional(),
});

export const getAgentProfilesSchema = z.object({
  include_inactive: z.boolean().optional(),
});

export const getAgentProfileSchema = z.object({
  name: z.string().min(1),
});

export const listAgentProfileNamesSchema = z.object({});

export const webSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    max_results: z
      .number()
      .int()
      .positive()
      .max(WEB_SEARCH_MAX_RESULTS)
      .optional()
      .default(5),
    site: z.string().trim().min(1).max(255).optional(),
    freshness: z
      .enum(["any", "day", "week", "month", "year"])
      .optional()
      .default("any"),
    safe_search: z
      .enum(["strict", "moderate", "off"])
      .optional()
      .default("moderate"),
  })
  .strip();

export const webFetchInputSchema = z
  .object({
    url: z.url(),
    format: z.enum(["text", "markdown"]).optional().default("text"),
    max_bytes: z
      .number()
      .int()
      .positive()
      .max(WEB_FETCH_MAX_BYTES)
      .optional()
      .default(WEB_FETCH_DEFAULT_MAX_BYTES),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(WEB_FETCH_MAX_TIMEOUT_MS)
      .optional()
      .default(WEB_FETCH_DEFAULT_TIMEOUT_MS),
  })
  .strip();

// ─── Memory schemas ────────────────────────────────────────────────────────

/**
 * Body shape for the optional `feedback` block on a `query_memory`
 * call (work item 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 3).
 *
 * Agents vote on a single retrieved segment per call — the schema
 * matches the milestone-2 service's `RecordFeedbackInput` surface
 * (segment id, vote, optional rationale). The handler
 * (`MemoryToolsHandler.queryMemory`) is responsible for resolving
 * the originating `queryId`, `agentProfileId`, and `workflowRunId`
 * from the tool context — those are injected out-of-band and
 * intentionally NOT part of the agent-supplied body so a hostile
 * or buggy caller cannot forge an audit trail.
 *
 * `reason` is capped at `2000` characters at the schema boundary
 * to match the `FEEDBACK_REASON_MAX_LENGTH` cap the service layer
 * applies before insert (see `memory-segment-feedback.service.ts`).
 * A longer rationale will fail validation rather than be silently
 * truncated — the truncation is a defensive service-layer fallback,
 * the schema-level cap is the canonical contract.
 *
 * `segment_id` must be a UUID (the `memory_segments.id` primary
 * key is `uuid`). `useful` is a plain boolean (NOT nullable) —
 * the channel is meaningless without the vote.
 */
export const queryMemoryFeedbackBodySchema = z.object({
  /** UUID of the segment being voted on. */
  segment_id: z.uuid(),
  /** `true` = useful, `false` = not useful. */
  useful: z.boolean(),
  /** Optional free-form rationale, capped at 2000 characters. */
  reason: z.string().max(2000).optional(),
});

export type QueryMemoryFeedbackBody = z.infer<
  typeof queryMemoryFeedbackBodySchema
>;

export const queryMemoryBodySchema = z.object({
  entity_type: memoryEntityTypeSchema,
  entity_id: z.string(),
  query: z.string().optional(),
  memory_type: z.enum(MEMORY_TYPES).optional(),
  include_learning: z.boolean().optional(),
  /**
   * When true (default), each returned segment carries the
   * synthesized `provenance` block plus `confidence`,
   * `entity_type`, `entity_id`, `source`, `created_at`,
   * `last_accessed_at`, and `metadata_json`. When false, the
   * handler may project a slimmer response for high-cardinality
   * reads. Defaults to `true` so agents keep their existing
   * trust signals unless they opt out explicitly.
   */
  include_provenance: z.boolean().optional().default(true),
  /**
   * Optional explicit usefulness vote on a single retrieved
   * segment. When supplied, the handler persists one
   * `memory_segment_feedback` row before returning the response
   * (awaited inline so the caller can tell the write succeeded)
   * and includes a `feedback` acknowledgement in the response
   * envelope. When omitted, no row is written — `query_memory`
   * stays a pure read tool.
   *
   * See {@link queryMemoryFeedbackBodySchema} for the per-field
   * contract.
   */
  feedback: queryMemoryFeedbackBodySchema.optional(),
});

export const recordLearningBodySchema = z
  .object({
    scope_type: learningScopeTypeSchema,
    scope_id: learningScopeIdSchema.nullable().optional(),
    lesson: z.string().trim().min(1).max(LEARNING_LESSON_MAX_LENGTH),
    evidence: z.array(learningEvidenceSchema).min(1),
    confidence: z.number().min(0).max(1),
    tags: z
      .array(z.string().trim().min(1).max(LEARNING_TAG_MAX_LENGTH))
      .max(LEARNING_TAGS_MAX_COUNT)
      .optional()
      .default([]),
  })
  .strip()
  .superRefine((body, context) => {
    if (body.scope_type !== "global" && body.scope_id == null) {
      context.addIssue({
        code: "custom",
        path: ["scope_id"],
        message: "scope_id is required unless scope_type is global",
      });
    }
  });

export const rememberBodySchema = z
  .object({
    content: z.string().trim().min(20).max(2000),
    memory_type: z.enum(["fact", "preference", "history"]).default("fact"),
    scope: z
      .enum(["project", "global", "agent", "workflow"])
      .default("project"),
    tags: z
      .array(z.string().trim().min(1).max(LEARNING_TAG_MAX_LENGTH))
      .max(LEARNING_TAGS_MAX_COUNT)
      .optional()
      .default([]),
    origin: z.enum(["discovery", "user_request"]).default("discovery"),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strip();

export type RememberBody = z.infer<typeof rememberBodySchema>;

/**
 * Structured payload for a `strategic_intent` memory segment.
 *
 * EPIC-208 (Milestone 1) defines the segment type that the CEO cycle
 * (Strategize beat) persists via
 * `MemoryManagerService.upsertMemorySegment` so long-term planning
 * intent can be carried across orchestration cycles. The segment is a
 * singleton per `(entity_type, entity_id)` scope — a fresh record
 * replaces the previous one — and is stored in
 * `memory_segments.metadata_json` (jsonb) alongside the existing
 * `content` / `version` columns.
 *
 * Field semantics:
 * - `horizon`        — free-form planning horizon label, e.g. `Q1-2026`
 *                      or `30-day`.
 * - `priority_themes` — broad strategic themes the CEO is leaning into
 *                      (e.g. `["autonomous development",
 *                      "agent self-improvement"]`).
 * - `focus_areas`    — concrete areas of focus under the themes.
 * - `constraints`    — guardrails / non-negotiables the CEO wants the
 *                      cycle to respect.
 * - `rationale`      — optional short prose explaining the intent.
 * - `updated_at`     — ISO-8601 timestamp of when this intent was
 *                      recorded; defaults to "now" when callers omit it.
 * - `updated_by`     — identifier of the agent that recorded the intent
 *                      (defaults to `ceo`).
 */
export const strategicIntentBodySchema = z
  .object({
    horizon: z
      .string()
      .trim()
      .min(1)
      .max(STRATEGIC_INTENT_HORIZON_MAX_LENGTH)
      .describe(
        "Free-form planning horizon label, e.g. 'Q1-2026' or '30-day'.",
      ),
    priority_themes: z
      .array(z.string().trim().min(1).max(STRATEGIC_INTENT_THEME_MAX_LENGTH))
      .max(STRATEGIC_INTENT_THEMES_MAX_COUNT)
      .optional()
      .default([]),
    focus_areas: z
      .array(
        z.string().trim().min(1).max(STRATEGIC_INTENT_FOCUS_AREA_MAX_LENGTH),
      )
      .max(STRATEGIC_INTENT_FOCUS_AREAS_MAX_COUNT)
      .optional()
      .default([]),
    constraints: z
      .array(
        z.string().trim().min(1).max(STRATEGIC_INTENT_CONSTRAINT_MAX_LENGTH),
      )
      .max(STRATEGIC_INTENT_CONSTRAINTS_MAX_COUNT)
      .optional()
      .default([]),
    rationale: z.string().trim().max(LEARNING_LESSON_MAX_LENGTH).optional(),
    updated_at: z.iso
      .datetime()
      .optional()
      .describe(
        "ISO-8601 timestamp the strategic intent was recorded. Defaults to now at upsert time when omitted.",
      ),
    updated_by: z
      .string()
      .trim()
      .min(1)
      .max(STRATEGIC_INTENT_AGENT_ID_MAX_LENGTH)
      .optional()
      .default("ceo")
      .describe("Identifier of the agent that recorded the intent."),
  })
  .strip();

export type StrategicIntentBody = z.infer<typeof strategicIntentBodySchema>;

// A single object root (not a union) is required: strict providers (e.g.
// DeepSeek) reject function/tool schemas whose root is not `type: "object"`,
// and a `z.union` serializes to a root `anyOf` with no `type`. Both casing
// variants are accepted as optional and the runtime coalesces them.
export const manageTodoListBodySchema = z
  .object({
    workflow_run_id: z.string().optional(),
    todoList: z.array(runtimeTodoListItemSchema).optional(),
    todo_list: z.array(runtimeTodoListItemSchema).optional(),
  })
  .superRefine((body, context) => {
    if (body.todoList === undefined && body.todo_list === undefined) {
      context.addIssue({
        code: "custom",
        path: ["todo_list"],
        message: "Either todoList or todo_list must be provided",
      });
    }
  });

export const getTodoListBodySchema = z.object({
  workflow_run_id: z.string().optional(),
});

// ─── Schedule schemas ──────────────────────────────────────────────────────

export const scheduleListBodySchema = runtimePaginationSchema.extend({
  scope_id: z.string().optional(),
  scope: z.enum(ScheduledJobScope).optional(),
  status: z.enum(ScheduledJobStatus).optional(),
});

export const scheduleIdentitySchema = z.object({
  scheduled_job_id: z.string(),
});

export const createScheduleSchema = z
  .object({
    scope_id: z.string().optional(),
    schedule_scope: z.enum(ScheduledJobScope).optional(),
    name: z.string(),
    schedule_type: z.enum(SCHEDULE_TYPE_VALUES),
    schedule_expression: z.string(),
    timezone: z.string().optional(),
    workflow_id: z.string(),
    payload_json: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, context) => {
    const scope = value.schedule_scope ?? ScheduledJobScope.SCOPE;
    if (scope === ScheduledJobScope.SCOPE && !value.scope_id) {
      context.addIssue({
        code: "custom",
        path: ["scope_id"],
        message: "scope_id is required when schedule_scope is scope",
      });
    }
  });

export const updateScheduleSchema = z.object({
  scheduled_job_id: z.string(),
  name: z.string().optional(),
  schedule_type: z.enum(SCHEDULE_TYPE_VALUES).optional(),
  schedule_expression: z.string().optional(),
  timezone: z.string().optional(),
  workflow_id: z.string().optional(),
  payload_json: z.record(z.string(), z.unknown()).optional(),
});

export const listScheduleRunsSchema = z.object({
  scheduled_job_id: z.string(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// ─── Workflow definition schemas ────────────────────────────────────────────

export const listWorkflowsSchema = z.object({
  include_inactive: z.boolean().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const searchWorkflowsSchema = listWorkflowsSchema.extend({
  query: z.string().optional(),
});

export const workflowIdentitySchema = z.object({
  workflow_id: z.string(),
});

export const readWorkflowSummarySchema = z.object({
  workflow_id: z.string().min(1),
});

export const searchSkillsSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const readSkillManifestSchema = z.object({
  skill_name: z.string().optional(),
  name: z.string().optional(),
});

export const searchPlaybooksSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
});

export const readPlaybookSchema = z.object({
  playbook_id: z.string().optional(),
  name: z.string().optional(),
});

export const workflowCreateSchema = z.object({
  yaml_definition: z.string(),
});

export const workflowUpdateSchema = z.object({
  workflow_id: z.string(),
  yaml_definition: z.string(),
});

// ─── Orchestration schemas ──────────────────────────────────────────────────

export const publishSpecsSchema = z.object({
  scope_id: z.string(),
  spec_directory: z.string().optional(),
  source_branch: z.string().optional(),
  base_branch: z.string().optional(),
  commit_message: z.string().optional(),
});

export const validateSpecsSchema = z.object({
  scope_id: z.string(),
  spec_directory: z.string().optional(),
});

export const invokeAgentWorkflowSchema = z
  .object({
    workflow_id: z.string().optional(),
    agent_profile: z.string().optional(),
    task_prompt: z.string().optional(),
    trigger_data: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    workflow_run_id: z.string().optional(),
    reasoning: z.string().optional(),
    // `reason` is accepted as an ergonomic alias for `reasoning` because
    // delegating agents commonly emit it. The runtime coalesces the two.
    reason: z.string().optional(),
  })
  .loose();

const awaitAgentWorkflowTargetSchema = z
  .object({
    workflow_id: z.string().optional(),
    agent_profile: z.string().optional(),
    objective: z.string().optional(),
    task_prompt: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

export const awaitAgentWorkflowSchema = z
  .object({
    // A single target may be supplied inline, or several via `workflows`.
    workflows: z.array(awaitAgentWorkflowTargetSchema).optional(),
    workflow_id: z.string().optional(),
    agent_profile: z.string().optional(),
    objective: z.string().optional(),
    task_prompt: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    // Attach the await to runs already started (e.g. via delegate_*) instead of
    // launching new children. The calling run is inferred from context;
    // workflow_run_id is NOT a target to await.
    awaited_run_ids: z.array(z.string()).optional(),
    awaited_run_id: z.string().optional(),
    workflow_run_id: z.string().optional(),
    reasoning: z.string().optional(),
    reason: z.string().optional(),
  })
  .loose();

export const listRunningWorkflowsSchema = z
  .object({
    scope_id: z.string().optional(),
    workflow_run_id: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .loose();

export const completeOrchestrationSchema = z.object({
  scope_id: z.string(),
  reasoning: z.string().optional(),
});

export const recordInvestigationFindingSchema = z.object({
  scope_id: z.uuid(),
  summary: z.string().min(1),
  evidence_refs: z.array(z.string().min(1)).optional(),
  workflow_run_id: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export const submitOrchestrationDecisionSchema = z.object({
  scope_id: z.string(),
  type: z.string(),
  reasoning: z.string(),
  actions: z.array(z.string()),
  workflow_run_id: z.string().optional(),
});

// ─── Agent factory schemas ──────────────────────────────────────────────────

export const createAgentProfileSchema = z.object({
  scope_id: z.string(),
  profile_name: z.string(),
  system_prompt: z.string().optional(),
  tier_preference: z.enum(["light", "heavy"]).optional(),
  allowed_tools: z.array(z.string()),
  model_name: z.string().optional(),
  provider_name: z.string().optional(),
  provider_id: z.uuid().optional(),
  provider_source: providerOwnerTypeSchema.optional(),
  factory_context: z.record(z.string(), z.unknown()).optional(),
  reasoning: z.string().optional(),
});

export const skillManifestIdentitySchema = z
  .object({
    skill_id: z.string().min(1).optional(),
    skill_name: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    skill_dir: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      Boolean(
        value.skill_id ?? value.skill_name ?? value.name ?? value.skill_dir,
      ),
    "skill_id, skill_name, name, or skill_dir is required",
  );

export const playbookIdentitySchema = z.object({
  playbook_id: z.string().min(1),
});

// ─── Browser schemas ────────────────────────────────────────────────────────

export * from "./workflow-runtime-inputs.types";
