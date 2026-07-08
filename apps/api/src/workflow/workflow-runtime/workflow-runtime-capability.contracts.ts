import {
  queryMemoryBodySchema,
  recordLearningBodySchema,
  rememberBodySchema,
  getTodoListBodySchema,
  manageTodoListBodySchema,
  scheduleListBodySchema,
  strategicIntentBodySchema,
} from '@nexus/core';
import { z } from 'zod';
import type { RuntimeCapabilityDefinition } from '../../capability-infra/runtime-capability.types';

export {
  queryMemoryBodySchema,
  recordLearningBodySchema,
  rememberBodySchema,
  getTodoListBodySchema,
  manageTodoListBodySchema,
  scheduleListBodySchema,
};

// EPIC-208 (Milestone 2): internal-tool input shapes for the strategic
// intent memory operations. The `entity_type` is intentionally permissive
// (any non-empty trimmed string) so CEO cycles can scope intents by
// arbitrary labels such as `ceo_cycle` or `Project`, matching how
// `query_memory` accepts `User | Project | System | <learning-scope-type>`.
export const strategicIntentEntityTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120);

export const strategicIntentEntityIdSchema = z.string().trim().min(1).max(200);

export const recordStrategicIntentInputSchema = z
  .object({
    entity_type: strategicIntentEntityTypeSchema,
    entity_id: strategicIntentEntityIdSchema,
    intent: strategicIntentBodySchema,
  })
  .strip();

export const readStrategicIntentInputSchema = z
  .object({
    entity_type: strategicIntentEntityTypeSchema,
    entity_id: strategicIntentEntityIdSchema,
  })
  .strip();

export const GET_TODO_LIST_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof getTodoListBodySchema
> = {
  name: 'get_todo_list',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['read_only', 'context'],
  description: 'Fetch the full workflow run todo list state.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/get-todo-list',
    bodyMapping: {
      workflow_run_id: 'workflow_run_id',
    },
  },
  inputSchema: getTodoListBodySchema,
};

export const QUERY_MEMORY_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition = {
  name: 'query_memory',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['read_only', 'context'],
  description:
    'Retrieve persisted memory segments for an entity. When `include_learning` is true, the response also includes a `learning` block of promoted fact segments with provenance and confidence metadata. When the optional `feedback` block is supplied, the call also persists one explicit usefulness vote on the targeted segment before returning; the response envelope then carries a `feedback` acknowledgement alongside the per-segment `usefulness` rolling-window ratio.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/query-memory',
    bodyMapping: {
      entity_type: 'entity_type',
      entity_id: 'entity_id',
      query: 'query',
      memory_type: 'memory_type',
      include_learning: 'include_learning',
      include_provenance: 'include_provenance',
      feedback: 'feedback',
    },
  },
  inputSchema: queryMemoryBodySchema,
};

export const RECORD_LEARNING_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof recordLearningBodySchema
> = {
  name: 'record_learning',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['mutating', 'context'],
  description:
    'Submit governed learning input through the internal tool runtime.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/record-learning',
    bodyMapping: {
      scope_type: 'scope_type',
      scope_id: 'scope_id',
      lesson: 'lesson',
      evidence: 'evidence',
      confidence: 'confidence',
      tags: 'tags',
    },
  },
  inputSchema: recordLearningBodySchema,
};

export const MANAGE_TODO_LIST_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof manageTodoListBodySchema
> = {
  name: 'manage_todo_list',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['mutating', 'context'],
  description:
    'Replace the full workflow run todo list and keep status progress in sync.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/manage-todo-list',
    bodyMapping: {
      workflow_run_id: 'workflow_run_id',
      todoList: 'todoList',
      todo_list: 'todo_list',
    },
  },
  inputSchema: manageTodoListBodySchema,
};

export const LIST_SCHEDULES_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof scheduleListBodySchema
> = {
  name: 'list_schedules',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['read_only', 'context'],
  description:
    'List scheduled jobs (cron/interval/once) with pagination support.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/schedules/list',
    bodyMapping: {
      scope_id: 'scope_id',
      status: 'status',
      limit: 'limit',
      offset: 'offset',
    },
  },
  inputSchema: scheduleListBodySchema,
};

// EPIC-208 (Milestone 2): persist the CEO cycle's structured strategic
// intent (horizon, priority_themes, focus_areas, constraints) as a
// singleton `strategic_intent` memory segment for the scope. The segment
// is upserted, so the latest intent always replaces the previous one.
export const RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof recordStrategicIntentInputSchema
> = {
  name: 'record_strategic_intent',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['mutating', 'context'],
  description:
    'Persist the CEO cycle strategic intent (horizon, priority themes, focus areas, constraints) as a singleton memory segment for the scope.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/record-strategic-intent',
    bodyMapping: {
      entity_type: 'entity_type',
      entity_id: 'entity_id',
      intent: 'intent',
    },
  },
  inputSchema: recordStrategicIntentInputSchema,
};

// EPIC-208 (Milestone 2): read the most recent strategic intent
// previously persisted by `record_strategic_intent` for the scope so
// future CEO cycles can recall what was planned. Returns `found:false`
// when no intent has been recorded yet.
export const READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof readStrategicIntentInputSchema
> = {
  name: 'read_strategic_intent',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['read_only', 'context'],
  description:
    'Read the current CEO cycle strategic intent for a scope. Returns found:false when no intent has been recorded yet.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/read-strategic-intent',
    bodyMapping: {
      entity_type: 'entity_type',
      entity_id: 'entity_id',
    },
  },
  inputSchema: readStrategicIntentInputSchema,
};

export const REMEMBER_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition<
  typeof rememberBodySchema
> = {
  name: 'remember',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['mutating', 'context'],
  description:
    'Record a durable memory from a single agent call. scope targets project (default), global, agent (this agent profile), or workflow (this workflow definition) — scope ids are resolved from run context automatically. Writes a learning_candidate with fast-track promotion for user-approved memories.',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/remember',
    bodyMapping: {
      content: 'content',
      memory_type: 'memory_type',
      scope: 'scope',
      tags: 'tags',
      origin: 'origin',
      confidence: 'confidence',
    },
  },
  inputSchema: rememberBodySchema,
};

export const WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS = [
  QUERY_MEMORY_RUNTIME_CAPABILITY,
  RECORD_LEARNING_RUNTIME_CAPABILITY,
  REMEMBER_RUNTIME_CAPABILITY,
  RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
  READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY,
  GET_TODO_LIST_RUNTIME_CAPABILITY,
  MANAGE_TODO_LIST_RUNTIME_CAPABILITY,
  LIST_SCHEDULES_RUNTIME_CAPABILITY,
] as const;
