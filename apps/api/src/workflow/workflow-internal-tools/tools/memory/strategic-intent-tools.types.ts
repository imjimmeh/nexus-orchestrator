import type { StrategicIntentBody } from '@nexus/core';

/**
 * Shared param shapes for the `record_strategic_intent` and
 * `read_strategic_intent` memory tools.
 *
 * EPIC-208 (Milestone 2) — both tools wrap
 * `MemoryToolsHandler.{recordStrategicIntent,readStrategicIntent}` and
 * are wired through the internal tool runtime so an agent turn can
 * persist a strategic intent via `record_strategic_intent` in one
 * cycle and have it available as context in subsequent cycles via
 * `read_strategic_intent`.
 */
export interface RecordStrategicIntentToolParams {
  entity_type: string;
  entity_id: string;
  intent: StrategicIntentBody;
}

export interface ReadStrategicIntentToolParams {
  entity_type: string;
  entity_id: string;
}
