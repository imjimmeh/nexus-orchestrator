import type { MemoryType } from './memory-backend.types';

/**
 * Type contracts for the {@link HonchoClientService} transport layer.
 *
 * The `.types.ts` filename is required by the project's lint policy
 * (`apps/api/eslint.config.mjs`) — exported interfaces and type
 * aliases live in dedicated `*.types.ts` files so the public surface
 * of the client stays statically analysable. This file is PURE value
 * types (no runtime code, no DI, no NestJS decorator).
 *
 * Work item 1291ad94-a07b-4fe6-91eb-456babcadb15 milestone 1 (M1)
 * introduces these contracts so the segment-normalization helpers
 * that previously lived inline on
 * `HonchoMemoryBackendService.normalizeSegments` can be relocated
 * onto `HonchoClientService` (the transport layer) without
 * coupling the caller back to the backend. Milestone 2 (M2) will
 * delete the now-unused inline copies and the
 * `HonchoNormalizedMessage` alias that pre-dates this rename.
 */

/**
 * Wire-shape alias for one Honcho candidate row.
 *
 * This interface is a verbatim rename of the pre-existing
 * `HonchoNormalizedMessage` interface that lived inline on
 * `HonchoMemoryBackendService` (work item 1291ad94 milestone 1).
 * The new name `HonchoRawSegment` reflects the role these fields
 * actually play: they are observed on a row returned by the Honcho
 * transport (search / list) and are NOT yet normalized into an
 * `IMemorySegment` — the `HonchoClientService.normalizeHonchoResponse`
 * orchestrator performs that synthesis using the helpers
 * `extractCandidateMessages`, `mapCandidate`, `readContent`,
 * `normalizeMemoryType`, and `parseDate`.
 *
 * The fields below mirror every field on the upstream Honcho
 * response shape that the legacy normalizer consulted. Renaming
 * without reshaping keeps the relocation a pure move — the wire
 * contract stays intact.
 */
export interface HonchoRawSegment {
  id?: string;
  content?: string;
  text?: string;
  message?: string;
  body?: string;
  version?: number;
  memory_type?: MemoryType;
  created_at?: string | Date;
  updated_at?: string | Date;
  metadata?: Record<string, unknown>;
}

/**
 * Attribution context used by
 * {@link HonchoClientService.normalizeHonchoResponse} when
 * synthesising `IMemorySegment` rows from raw Honcho candidates.
 *
 * `entityType` and `entityId` form the canonical
 * `(entity_type, entity_id)` tuple that the `memory_segments` table
 * keys on. When a raw candidate has no upstream identifier (the
 * legacy normalizer falls back to `${entityType}:${entityId}:${index}`
 * for the synthesized row ID), this context is the only place
 * those tags come from — callers MUST provide non-empty values.
 */
export interface HonchoNormalizationContext {
  readonly entityType: string;
  readonly entityId: string;
}

/**
 * Behaviour matrix for `HonchoClientService.normalizeMemoryType`
 * when a raw Honcho candidate carries a `memory_type` value that
 * does not match the closed `MemoryType` union
 * (`preference | fact | history | strategic_intent`).
 *
 * The legacy normalizer silently coerced every unknown value to
 * `'history'` with no log line — convenient for tolerating
 * upstream drift, but invisible. The three policies below make
 * the silent fallback explicit:
 *
 * - `'throw'`           — strict mode. Surface the contract drift
 *                         as a {@link HonchoTransportContractError}
 *                         carrying `field: 'memory_type'` so an
 *                         operator sees the regression in the call
 *                         stack and alerts have something to
 *                         attach to.
 * - `'history'`         — quiet mode. Same silent-to-history
 *                         coercion as today, but without the log
 *                         line (mirrors the historical behaviour).
 * - `'log-then-history'`— audit mode. Today's default. Logs once
 *                         per unknown value so operator typos
 *                         become observable without breaking
 *                         reads; falls back to `'history'` after.
 *
 * The active policy is resolved from
 * `HONCHO_UNKNOWN_MEMORY_TYPE_POLICY` by
 * `HonchoClientService.unknownMemoryTypePolicy()` (added in M1 of
 * work item 1291ad94). Unknown env values and unset values both
 * resolve to `'log-then-history'`, matching the historical
 * behaviour so an operator's typo cannot turn a previously-quiet
 * read into a loud failure.
 */
export type UnknownMemoryTypePolicy = 'throw' | 'history' | 'log-then-history';
