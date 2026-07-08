import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentDecayRepository } from './memory-segment.decay.repository';

// ---------------------------------------------------------------------------
// Decay-loop surface for the nightly `MemoryDecayReaper` and the
// read-path reinforcement half of the loop (work item 3d7fb798).
//
// `touchReinforcedAt(ids)` is invoked from
// `MemoryManagerService.getMemorySegments` and `searchMemory` on
// every read so frequently-consumed segments stay "fresh" in the
// nightly reaper's `effective_last_touch = max(last_accessed_at,
// last_reinforced_at)` composite.
//
// `findDecayCandidates` is the candidate query for the nightly
// decay reaper itself. The shape is intentionally distinct from
// the eviction reaper's candidate query (no `pinned = false` /
// `access_count < :minAccessCount` floors).
//
// Phase-3 Task 4 (EPIC-212) added the `treatDriftedAsEligible`
// opt-in: when set, a row whose `drift_detected_at` is stamped is
// OR-ed in so it is selected even inside its grace window. The
// regression case MUST ensure the OR clause is NOT added in the
// default (bare grace-filter) path.
// ---------------------------------------------------------------------------

describe('MemorySegmentDecayRepository', () => {
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    getOne: vi.fn(),
    getMany: vi.fn(),
    getRawMany: vi.fn(),
    getCount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------
  // touchReinforcedAt
  // -----------------------------------------------------------------

  describe('touchReinforcedAt', () => {
    it('updates last_reinforced_at on the supplied ids, skipping archived rows', async () => {
      const update = vi.fn().mockResolvedValue({ affected: 2 });
      const repository = new MemorySegmentDecayRepository({
        update,
      } as unknown as Repository<MemorySegment>);

      await repository.touchReinforcedAt(['seg-a', 'seg-b']);

      // TypeORM translates `{ id: In([...]), archived_at: IsNull() }`
      // into `WHERE id IN (...) AND archived_at IS NULL` — both
      // clauses MUST be present so a row the decay reaper has
      // archived is never re-reinforced.
      expect(update).toHaveBeenCalledTimes(1);
      const [criteria, payload] = update.mock.calls[0] ?? [];
      expect(criteria).toEqual({
        id: expect.objectContaining({
          type: 'in',
          value: ['seg-a', 'seg-b'],
        }),
        archived_at: expect.objectContaining({ type: 'isNull' }),
      });
      expect(payload).toEqual({
        last_reinforced_at: expect.any(Date),
      });
    });

    it('short-circuits on an empty id list without issuing an UPDATE', async () => {
      const update = vi.fn().mockResolvedValue({ affected: 0 });
      const repository = new MemorySegmentDecayRepository({
        update,
      } as unknown as Repository<MemorySegment>);

      await repository.touchReinforcedAt([]);

      expect(update).not.toHaveBeenCalled();
    });

    it('swallows errors from the SQL surface and resolves normally', async () => {
      // A connection blip must NEVER bubble out of a read path.
      // The repository method's contract is "always resolves
      // successfully"; the caller still attaches a defensive
      // `.catch(() => undefined)`.
      const update = vi.fn().mockRejectedValue(new Error('connection reset'));
      const repository = new MemorySegmentDecayRepository({
        update,
      } as unknown as Repository<MemorySegment>);

      await expect(
        repository.touchReinforcedAt(['seg-x']),
      ).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------
  // findDecayCandidates — drift eligibility (Phase-3 Task 4)
  // -----------------------------------------------------------------

  describe('findDecayCandidates — drift eligibility (Phase-3 Task 4)', () => {
    it('selects drifted rows even inside grace when treatDriftedAsEligible is set', async () => {
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentDecayRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findDecayCandidates({
        exemptSources: ['learning_candidate'],
        graceCutoff: new Date('2026-06-17T12:00:00.000Z'),
        treatDriftedAsEligible: true,
      });

      const andWhereClauses = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      // A drifted row bypasses the grace-window filter: the grace clause
      // is OR-ed with `drift_detected_at IS NOT NULL`.
      const graceClause = andWhereClauses.find((clause) =>
        clause.includes(':graceCutoff'),
      );
      expect(graceClause).toBeDefined();
      expect(graceClause).toContain('segment.drift_detected_at IS NOT NULL');
      // The exempt-source allowlist remains a hard floor in all modes.
      expect(
        andWhereClauses.some((clause) =>
          clause.includes('source NOT IN (:...exemptSources)'),
        ),
      ).toBe(true);
    });

    it('does NOT add the drift clause when treatDriftedAsEligible is absent (regression)', async () => {
      // Bare grace-filter path WITHOUT `treatDriftedAsEligible`.
      // The OR-with-drift clause MUST NOT appear — a row inside
      // its grace window is NOT a decay candidate unless the
      // caller has explicitly opted in.
      queryBuilder.getMany.mockResolvedValue([]);
      const repository = new MemorySegmentDecayRepository({
        createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      } as unknown as Repository<MemorySegment>);

      await repository.findDecayCandidates({
        exemptSources: ['learning_candidate'],
        graceCutoff: new Date('2026-06-17T12:00:00.000Z'),
      });

      const andWhereClauses = queryBuilder.andWhere.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(
        andWhereClauses.some((clause) => clause.includes('drift_detected_at')),
      ).toBe(false);
    });
  });
});
