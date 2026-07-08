import { Injectable } from '@nestjs/common';
import { strategicIntentBodySchema } from '@nexus/core';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';
import type { ReadStrategicIntentToolParams } from '../tools/memory/strategic-intent-tools.types';

/**
 * Extracted handler for the `read_strategic_intent` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public
 * method). Behaviour is identical to the previous aggregate's
 * `readStrategicIntent` implementation — same entity_type / entity_id
 * validation, same `getStrategicIntentSegment` lookup, same
 * `{ found: false, intent: null }` absence projection, same
 * `{ found: true, segment_id, version, updated_at, intent }`
 * presence projection — so the existing
 * `strategic_intent memory segment contract` describe in
 * `apps/api/src/memory/strategic-intent.contract.spec.ts` continues to
 * exercise the read path unchanged until task 1.5 rewires the tool
 * wrapper to target this handler.
 *
 * AC-10 (single-parse invariant): `strategicIntentBodySchema.safeParse`
 * is called EXACTLY ONCE per invocation on `segment.metadata_json` and
 * the `success` / `data` pair is projected directly into the response
 * — the parsed payload is NOT re-parsed after extraction.
 *
 * The constructor surface is intentionally narrow: this handler only
 * needs the single service that owns the actual read path
 * (`MemoryManagerService`). All other dependencies the aggregate
 * carries stay on the aggregate, which keeps the wiring graph here
 * honest and the handler trivially mockable.
 */
@Injectable()
export class ReadStrategicIntentHandler {
  constructor(private readonly memoryManager: MemoryManagerService) {}

  async readStrategicIntent(
    params: ReadStrategicIntentToolParams,
  ): Promise<Record<string, unknown>> {
    const entityType = requireNonEmptyString(params.entity_type, 'entity_type');
    const entityId = requireNonEmptyString(params.entity_id, 'entity_id');

    const segment = await this.memoryManager.getStrategicIntentSegment(
      entityType,
      entityId,
    );

    if (!segment) {
      return {
        entity_type: entityType,
        entity_id: entityId,
        found: false,
        intent: null,
      };
    }

    const intent = strategicIntentBodySchema.safeParse(
      segment.metadata_json ?? {},
    );
    return {
      entity_type: entityType,
      entity_id: entityId,
      found: true,
      segment_id: segment.id,
      version: segment.version,
      updated_at: segment.updated_at,
      intent: intent.success ? intent.data : null,
    };
  }
}
