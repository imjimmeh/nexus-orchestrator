import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { RecordStrategicIntentHandler } from '../../handlers/record-strategic-intent.handler';
import type { RecordStrategicIntentToolParams } from './strategic-intent-tools.types';

/**
 * EPIC-208 (Milestone 2) — agent-facing runtime tool that persists
 * the CEO cycle's strategic intent as a singleton `strategic_intent`
 * memory segment via `MemoryToolsHandler.recordStrategicIntent`.
 *
 * The segment is upserted per `(entity_type, entity_id)` scope, so the
 * most recent intent always replaces the previous one and is available
 * to subsequent cycles through `read_strategic_intent`.
 */
@Injectable()
export class RecordStrategicIntentTool implements IInternalToolHandler<RecordStrategicIntentToolParams> {
  constructor(
    private readonly recordStrategicIntentHandler: RecordStrategicIntentHandler,
  ) {}

  getName(): string {
    return 'record_strategic_intent';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return RECORD_STRATEGIC_INTENT_RUNTIME_CAPABILITY;
  }

  execute(
    _context: InternalToolExecutionContext,
    params: RecordStrategicIntentToolParams,
  ): Promise<Record<string, unknown>> {
    return this.recordStrategicIntentHandler.recordStrategicIntent(params);
  }
}
