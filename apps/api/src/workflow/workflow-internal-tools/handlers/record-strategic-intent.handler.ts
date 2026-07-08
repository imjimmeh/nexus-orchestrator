import { Injectable } from '@nestjs/common';
import {
  strategicIntentBodySchema,
  type StrategicIntentBody,
} from '@nexus/core';
import { MemoryManagerService } from '../../../memory/memory-manager.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';
import type { RecordStrategicIntentToolParams } from '../tools/memory/strategic-intent-tools.types';

/**
 * Extracted handler for the `record_strategic_intent` runtime capability
 * (refactoring work item: split `MemoryToolsHandler` per public
 * method). Behaviour is identical to the previous aggregate's
 * `recordStrategicIntent` implementation — same entity_type / entity_id
 * validation, same single-call `strategicIntentBodySchema.parse` on
 * `params.intent`, same `updated_at` defaulting (now if absent),
 * same `upsertMemorySegment` payload ordering
 * (rendered summary string + stamped intent), same response shape
 * (`entity_type`, `entity_id`, `segment_id`, `version`,
 * `memory_type`, `updated_at`, `intent`) — so the existing
 * `strategic_intent memory segment contract` describe in
 * `apps/api/src/memory/strategic-intent.contract.spec.ts` continues to
 * exercise the write path unchanged until task 1.5 rewires the tool
 * wrapper to target this handler.
 *
 * AC-10 (single-parse invariant): `strategicIntentBodySchema.parse` is
 * called EXACTLY ONCE per invocation on `params.intent` and the parsed
 * value is stamped with `updated_at` (defaulting to `new Date().toISOString()`
 * when the caller omitted it) before being passed to
 * `upsertMemorySegment`. The returned segment is projected directly into
 * the response — the stamped intent is NOT re-parsed after the upsert.
 *
 * The constructor surface is intentionally narrow: this handler only
 * needs the single service that owns the actual write path
 * (`MemoryManagerService`). All other dependencies the aggregate
 * carries stay on the aggregate, which keeps the wiring graph here
 * honest and the handler trivially mockable.
 */
@Injectable()
export class RecordStrategicIntentHandler {
  constructor(private readonly memoryManager: MemoryManagerService) {}

  async recordStrategicIntent(
    params: RecordStrategicIntentToolParams,
  ): Promise<Record<string, unknown>> {
    const entityType = requireNonEmptyString(params.entity_type, 'entity_type');
    const entityId = requireNonEmptyString(params.entity_id, 'entity_id');
    const intent = strategicIntentBodySchema.parse(params.intent);
    const stamped: StrategicIntentBody = {
      ...intent,
      updated_at: intent.updated_at ?? new Date().toISOString(),
    };

    const segment = await this.memoryManager.upsertMemorySegment(
      entityType,
      entityId,
      'strategic_intent',
      this.renderStrategicIntentSummary(stamped),
      stamped,
    );

    return {
      entity_type: entityType,
      entity_id: entityId,
      segment_id: segment.id,
      version: segment.version,
      memory_type: segment.memory_type,
      updated_at: segment.updated_at,
      intent: stamped,
    };
  }

  private renderStrategicIntentSummary(intent: StrategicIntentBody): string {
    const themes =
      intent.priority_themes.length > 0
        ? ` themes=${intent.priority_themes.join(' | ')}`
        : '';
    const focus =
      intent.focus_areas.length > 0
        ? ` focus=${intent.focus_areas.join(' | ')}`
        : '';
    const constraints =
      intent.constraints.length > 0
        ? ` constraints=${intent.constraints.join(' | ')}`
        : '';
    return `horizon=${intent.horizon}${themes}${focus}${constraints}`;
  }
}
