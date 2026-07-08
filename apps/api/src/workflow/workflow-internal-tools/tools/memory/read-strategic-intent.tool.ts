import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { ReadStrategicIntentHandler } from '../../handlers/read-strategic-intent.handler';
import type { ReadStrategicIntentToolParams } from './strategic-intent-tools.types';

/**
 * EPIC-208 (Milestone 2) — agent-facing runtime tool that reads the
 * CEO cycle's most recent strategic intent for a scope via
 * `MemoryToolsHandler.readStrategicIntent`. Returns `intent: null`
 * when no intent has been recorded yet so callers can branch on
 * absence rather than treating the empty case as an error.
 */
@Injectable()
export class ReadStrategicIntentTool implements IInternalToolHandler<ReadStrategicIntentToolParams> {
  constructor(
    private readonly readStrategicIntentHandler: ReadStrategicIntentHandler,
  ) {}

  getName(): string {
    return 'read_strategic_intent';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return READ_STRATEGIC_INTENT_RUNTIME_CAPABILITY;
  }

  execute(
    _context: InternalToolExecutionContext,
    params: ReadStrategicIntentToolParams,
  ): Promise<Record<string, unknown>> {
    return this.readStrategicIntentHandler.readStrategicIntent(params);
  }
}
