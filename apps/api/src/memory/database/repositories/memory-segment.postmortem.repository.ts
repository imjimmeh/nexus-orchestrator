import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemorySegment } from '../entities/memory-segment.entity';

/**
 * The `metadata_json.source` value that the
 * `WorkflowFailurePostmortemListener` (work item 5743ac93) stamps
 * onto every postmortem segment it writes. Pinned to this constant
 * so the listener write path and the threshold-aggregation read
 * path stay in lockstep — a typo in either would silently break
 * the duplicate-detection + occurrence-threshold features.
 *
 * Mirrors the `WORKFLOW_POSTMORTEM_SOURCE` constant on the
 * listener side. Keep both values in sync.
 */
export const POSTMORTEM_SOURCE = 'workflow_failure_postmortem';

/**
 * Read-path surface for the `workflow_failure_postmortem` source on
 * `memory_segments`. Mirrors the `findByMetadataKey` and
 * `countPostmortemsByFailureClass` methods on the original
 * `MemorySegmentRepository`.
 *
 * Both methods are query-builder-shaped (not `find({ where })`)
 * and apply the `archived_at IS NULL` filter inline rather than
 * via the `buildReadWhere` helper — the helper targets the
 * `find({ where })` shape used by the CRUD / search repos.
 *
 * The `occurred_at` window comparison is intentionally a string
 * comparison (`::text >= :sinceIso`) — `metadata_json.occurred_at`
 * is documented as an ISO-8601 string, NOT a `timestamptz`, and
 * lexicographic ISO-8601 ordering is the documented contract.
 */
@Injectable()
export class MemorySegmentPostmortemRepository {
  constructor(
    @InjectRepository(MemorySegment)
    private readonly repository: Repository<MemorySegment>,
  ) {}

  /**
   * Find the first memory segment whose `metadata_json ->> :key = :value`,
   * optionally scoped to an `entity_type` / `entity_id` pair.
   *
   * The query is intentionally narrow: a single-row lookup intended
   * for the `WorkflowFailurePostmortemListener` (work item
   * 5743ac93-456d-41b3-ae5b-0ca2554318da) dedup check, which calls
   * `findByMetadataKey('workflow_run_id', workflowRunId, { entityType:
   * 'project', entityId: scopeId })` to detect a pre-existing
   * postmortem for the same run. The lookup is the cheapest possible
   * signal of "has the listener already written a memory segment for
   * this run?" without pulling a list and inspecting it client-side.
   *
   * Defaults: `includeArchived: false`. The decay reaper archives a
   * row by setting `archived_at` (work item 3d7fb798), and the
   * listener must NOT re-write a postmortem for an archived run (it
   * would emit a duplicate
   * `memory.workflow.postmortem_recorded.v1` event and inflate the
   * `success` counter). Archived rows surface only when the caller
   * explicitly opts in (e.g. operator-side audit tooling).
   *
   * Ordering: `created_at DESC` so the most recent match wins on a
   * duplicate key. The postmortem listener only writes one row per
   * `workflow_run_id` so the ordering is a defensive tiebreak rather
   * than a correctness lever.
   */
  async findByMetadataKey(
    key: string,
    value: string,
    opts: {
      includeArchived?: boolean;
      entityType?: string;
      entityId?: string;
    } = {},
  ): Promise<MemorySegment | null> {
    const queryBuilder = this.repository
      .createQueryBuilder('segment')
      .where('segment.metadata_json ->> :key = :value', { key, value });

    if (opts.entityType !== undefined) {
      queryBuilder.andWhere('segment.entity_type = :entityType', {
        entityType: opts.entityType,
      });
    }
    if (opts.entityId !== undefined) {
      queryBuilder.andWhere('segment.entity_id = :entityId', {
        entityId: opts.entityId,
      });
    }
    if (!opts.includeArchived) {
      queryBuilder.andWhere('segment.archived_at IS NULL');
    }

    return queryBuilder.orderBy('segment.created_at', 'DESC').getOne();
  }

  /**
   * Count active memory segments that represent a recorded
   * postmortem for a given (entity, failure_class) pair, restricted
   * to a window anchored at `sinceIso` (ISO-8601 string).
   *
   * The query is the threshold-aggregation input for milestone 3 of
   * work item 5743ac93-456d-41b3-ae5b-0ca2554318da: once the
   * `WorkflowFailurePostmortemListener` has written
   * `workflow_postmortem_occurrence_threshold` (default 3)
   * postmortems sharing the same `failure_class` for the same
   * project within
   * `workflow_postmortem_occurrence_window_days` (default 30), the
   * follow-up `LearningService` integration auto-proposes a
   * `learning_candidate`.
   *
   * The filter is intentionally pinned to the
   * `workflow_failure_postmortem` source (the postmortem
   * `POSTMORTEM_SOURCE` constant) so unrelated memory segments —
   * e.g. `learning_candidate`, `strategic_intent`, or any other
   * source the listener does not own — cannot inflate the
   * threshold count.
   *
   * `archived_at IS NULL` matches the read-path default on this
   * repository: the decay reaper (work item 3d7fb798) archives a
   * row when its decayed confidence falls below the configured
   * floor, and archived rows must NOT count toward the threshold
   * (a decayed postmortem is not a "current recurring failure
   * pattern" — it is historical). The `occurred_at` metadata
   * column is set on every postmortem write by the listener and
   * is the timestamp the occurrence window is anchored to (NOT
   * `created_at`), so an operator-driven backfill that re-uses an
   * older `occurred_at` timestamp still falls out of the window
   * correctly.
   *
   * `sinceIso` is a string (e.g. `now - 30 days` produced by the
   * caller) rather than a `Date` so the call site controls the
   * timezone / clock source; the JSONB cast on the right-hand side
   * (`::text >= :sinceIso`) works on lexicographic ISO-8601
   * ordering, which is the documented contract for
   * `metadata_json.occurred_at` (ISO-8601 strings, NOT
   * `timestamptz`).
   */
  async countPostmortemsByFailureClass(
    entityType: string,
    entityId: string,
    failureClass: string,
    sinceIso: string,
  ): Promise<number> {
    return this.repository
      .createQueryBuilder('segment')
      .where('segment.entity_type = :entityType', { entityType })
      .andWhere('segment.entity_id = :entityId', { entityId })
      .andWhere("segment.metadata_json ->> 'source' = :source", {
        source: POSTMORTEM_SOURCE,
      })
      .andWhere("segment.metadata_json ->> 'failure_class' = :failureClass", {
        failureClass,
      })
      .andWhere("segment.metadata_json ->> 'occurred_at' >= :sinceIso", {
        sinceIso,
      })
      .andWhere('segment.archived_at IS NULL')
      .getCount();
  }
}
