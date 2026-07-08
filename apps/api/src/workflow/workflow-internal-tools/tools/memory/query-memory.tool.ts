import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  QueryMemoryFeedbackBody,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { QUERY_MEMORY_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { QueryMemoryHandler } from '../../handlers/query-memory.handler';

/**
 * Agent-supplied parameters for `query_memory`.
 *
 * Mirrors `queryMemoryBodySchema` from `@nexus/core` plus the
 * optional `feedback` block the handler persists as an explicit
 * usefulness vote (work item 66ea23d1-59f2-451b-a090-a292fad8f21b,
 * milestone 3). The `workflow_run_id`, `job_id`, and
 * `agent_profile_id` fields are intentionally NOT part of the
 * agent-supplied shape — the handler resolves them from the
 * tool execution context (out-of-band from the agent's
 * perspective) so a hostile or buggy caller cannot forge the
 * audit trail.
 */
interface QueryMemoryParams {
  entity_type: string;
  entity_id: string;
  query?: string;
  memory_type?: 'preference' | 'fact' | 'history';
  include_learning?: boolean;
  include_provenance?: boolean;
  feedback?: QueryMemoryFeedbackBody;
}

@Injectable()
export class QueryMemoryTool implements IInternalToolHandler<QueryMemoryParams> {
  constructor(private readonly queryMemoryHandler: QueryMemoryHandler) {}

  getName(): string {
    return 'query_memory';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return QUERY_MEMORY_RUNTIME_CAPABILITY;
  }

  execute(
    context: InternalToolExecutionContext,
    params: QueryMemoryParams,
  ): Promise<Record<string, unknown>> {
    return this.queryMemoryHandler.queryMemory(context, params);
  }
}
