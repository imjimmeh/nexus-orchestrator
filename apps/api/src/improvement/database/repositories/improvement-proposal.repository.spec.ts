import { describe, expect, it, vi } from 'vitest';
import { In, MoreThan } from 'typeorm';
import { ImprovementProposalRepository } from './improvement-proposal.repository';

function makeRepoStub() {
  const rows: any[] = [];
  const typeorm = {
    create: (v: any) => ({ ...v }),
    save: vi.fn(async (v: any) => {
      const row = { id: v.id ?? `id-${rows.length + 1}`, ...v };
      rows.push(row);
      return row;
    }),
    findOne: vi.fn(
      async ({ where: { id } }: any) => rows.find((r) => r.id === id) ?? null,
    ),
    find: vi.fn(async () => []),
    count: vi.fn(async () => rows.length),
    createQueryBuilder: vi.fn(),
    increment: vi.fn(async () => ({ affected: 1 })),
  };
  return { typeorm, rows };
}

/**
 * Build a chainable query-builder stub whose terminal `getOne()` resolves
 * with the given row. Mirrors the subset of TypeORM's `SelectQueryBuilder`
 * chain used by `findPendingSkillCreateByTargetName`
 * (`where`/`andWhere`/`orderBy`/`limit`/`getOne`).
 */
function makeQueryBuilderStub(result: unknown) {
  const qb: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['where', 'andWhere', 'orderBy', 'limit']) {
    qb[method] = vi.fn(() => qb);
  }
  qb.getOne = vi.fn(async () => result);
  return qb;
}

describe('ImprovementProposalRepository', () => {
  it('creates a pending proposal with occurrence_count defaulting to 1', async () => {
    const { typeorm } = makeRepoStub();
    const repo = new ImprovementProposalRepository(typeorm as any);
    const created = await repo.create({
      kind: 'skill_create',
      status: 'pending',
      payload: { target_skill_name: 'x' },
      evidence: { evidenceClass: 'inference' },
      confidence: 0.4,
      provenance: { source: 'test' },
    });
    expect(created.kind).toBe('skill_create');
    expect(created.status).toBe('pending');
    expect(created.occurrence_count).toBe(1);
  });

  describe('countByStatuses', () => {
    it('returns 0 without querying when no statuses are given', async () => {
      const { typeorm } = makeRepoStub();
      const repo = new ImprovementProposalRepository(typeorm as any);

      const total = await repo.countByStatuses([]);

      expect(total).toBe(0);
      expect(typeorm.count).not.toHaveBeenCalled();
    });

    it('counts rows matching the given statuses, optionally scoped to kinds', async () => {
      const { typeorm } = makeRepoStub();
      typeorm.count.mockResolvedValueOnce(3);
      const repo = new ImprovementProposalRepository(typeorm as any);

      const total = await repo.countByStatuses(
        ['pending', 'approved'],
        ['skill_create'],
      );

      expect(total).toBe(3);
      expect(typeorm.count).toHaveBeenCalledWith({
        where: { status: expect.anything(), kind: expect.anything() },
      });
    });
  });

  describe('findPendingSkillCreateByTargetName', () => {
    it('returns the matching pending skill_create proposal row', async () => {
      const { typeorm } = makeRepoStub();
      const row = {
        id: 'proposal-1',
        kind: 'skill_create',
        status: 'pending',
        payload: { target_skill_name: 'debugging-101' },
      };
      const qb = makeQueryBuilderStub(row);
      typeorm.createQueryBuilder.mockReturnValue(qb);
      const repo = new ImprovementProposalRepository(typeorm as any);

      const found =
        await repo.findPendingSkillCreateByTargetName('debugging-101');

      expect(found).toEqual(row);
      expect(typeorm.createQueryBuilder).toHaveBeenCalledWith('p');
      expect(qb.andWhere).toHaveBeenCalledWith(
        "p.payload ->> 'target_skill_name' = :targetSkillName",
        { targetSkillName: 'debugging-101' },
      );
    });

    it('returns null when no pending skill_create proposal matches', async () => {
      const { typeorm } = makeRepoStub();
      const qb = makeQueryBuilderStub(null);
      typeorm.createQueryBuilder.mockReturnValue(qb);
      const repo = new ImprovementProposalRepository(typeorm as any);

      const found =
        await repo.findPendingSkillCreateByTargetName('unknown-skill');

      expect(found).toBeNull();
    });
  });

  describe('findRecentByKindAndStatuses', () => {
    it('queries by exact kind, an In() status list, and a MoreThan(sinceDays-ago) cutoff', async () => {
      const fixedNow = new Date('2026-07-01T00:00:00.000Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
      try {
        const { typeorm } = makeRepoStub();
        const row = {
          id: 'proposal-2',
          kind: 'code_change',
          status: 'pending',
        };
        typeorm.find.mockResolvedValueOnce([row]);
        const repo = new ImprovementProposalRepository(typeorm as any);

        const found = await repo.findRecentByKindAndStatuses(
          'code_change',
          ['pending', 'applied'],
          30,
        );

        expect(found).toEqual([row]);
        const expectedSince = new Date(fixedNow - 30 * 24 * 60 * 60 * 1000);
        // Concrete In()/MoreThan() operators (not expect.anything()) so a
        // dropped status or a flipped comparison direction (e.g. LessThan)
        // fails this assertion: FindOperator equality includes both the
        // operator type and its value.
        expect(typeorm.find).toHaveBeenCalledWith({
          where: {
            kind: 'code_change',
            status: In(['pending', 'applied']),
            created_at: MoreThan(expectedSince),
          },
          order: { created_at: 'DESC' },
        });
      } finally {
        vi.restoreAllMocks();
      }
    });
  });

  describe('countSkillAssignmentReuseSince', () => {
    it('counts skill_assignment proposals matching skill + (workflow, stepId) in the window', async () => {
      const { typeorm } = makeRepoStub();
      const qb: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ['where', 'andWhere']) {
        qb[method] = vi.fn(() => qb);
      }
      qb.getCount = vi.fn(async () => 4);
      typeorm.createQueryBuilder.mockReturnValue(qb);
      const repo = new ImprovementProposalRepository(typeorm as any);

      const since = new Date('2026-07-01T00:00:00.000Z');
      const total = await repo.countSkillAssignmentReuseSince({
        since,
        skillName: 'fix-merge-conflicts',
        workflowName: 'repair-runner',
        stepId: 'step-alpha',
      });

      expect(total).toBe(4);
      expect(typeorm.createQueryBuilder).toHaveBeenCalledWith('p');
      expect(qb.where).toHaveBeenCalledWith('p.kind = :kind', {
        kind: 'skill_assignment',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('p.created_at >= :since', {
        since,
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        "p.payload ->> 'skillName' = :skillName",
        { skillName: 'fix-merge-conflicts' },
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        "p.payload -> 'assignment_targets' @> :assignmentTargets",
        {
          assignmentTargets: [
            {
              type: 'workflow_step',
              workflowName: 'repair-runner',
              stepId: 'step-alpha',
            },
          ],
        },
      );
    });

    it('omits the stepId key in the containment entry for workflow-scoped reuse', async () => {
      const { typeorm } = makeRepoStub();
      const qb: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ['where', 'andWhere']) {
        qb[method] = vi.fn(() => qb);
      }
      qb.getCount = vi.fn(async () => 1);
      typeorm.createQueryBuilder.mockReturnValue(qb);
      const repo = new ImprovementProposalRepository(typeorm as any);

      const total = await repo.countSkillAssignmentReuseSince({
        since: new Date('2026-07-01T00:00:00.000Z'),
        skillName: 'fix-merge-conflicts',
        workflowName: 'repair-runner',
        stepId: null,
      });

      expect(total).toBe(1);
      const containmentCall = qb.andWhere.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes("p.payload -> 'assignment_targets' @>"),
      );
      expect(containmentCall).toBeDefined();
      const params = (containmentCall?.[1] ?? {}) as {
        assignmentTargets: Array<Record<string, unknown>>;
      };
      // A typo here would silently under-count workflow-scoped reuse.
      expect(params.assignmentTargets).toEqual([
        { type: 'workflow_step', workflowName: 'repair-runner' },
      ]);
    });
  });
});
