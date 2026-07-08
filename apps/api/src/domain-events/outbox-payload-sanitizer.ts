/**
 * The outbox is the single choke point through which every domain event is
 * persisted, so stripping NUL bytes here guarantees that no upstream payload —
 * however it was assembled (e.g. an execution `error_message` embedding raw
 * Docker log bytes) — can wedge the delivery pipeline and strand a workflow run.
 *
 * The NUL-stripping logic itself is shared with the workflow-run state-variable
 * write (the other jsonb persistence choke point) via the common
 * {@link stripNullBytesDeep} util, so both paths stay in lockstep.
 */

import { stripNullBytesDeep } from '../common/utils/strip-null-bytes.util';

/** Recursively removes NUL bytes from every string within a JSON-like value. */
export function sanitizeOutboxValue(value: unknown): unknown {
  return stripNullBytesDeep(value);
}

/**
 * Returns a NUL-free deep copy of a domain-event payload, safe to persist to a
 * PostgreSQL `jsonb` column.
 */
export function sanitizeOutboxPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return stripNullBytesDeep(payload) as Record<string, unknown>;
}
