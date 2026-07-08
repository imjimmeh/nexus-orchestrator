/**
 * Unit tests for RememberWriteGuardService.
 *
 * Tests budget enforcement and near-dup reinforcement in isolation.
 * ICandidateSimilarity is mocked here; the real similarity stack is
 * tested in its own specs.
 */
import { describe, expect, it, vi } from 'vitest';
import type { InternalToolExecutionContext } from '@nexus/core';
import { RememberWriteGuardService } from './remember-write-guard.service';

const BUDGET_SETTING_KEY = 'memory_capture_max_per_job';
const DEFAULT_BUDGET = 8;

function buildContext(
  overrides: Partial<InternalToolExecutionContext> = {},
): InternalToolExecutionContext {
  return {
    workflowRunId: 'run-abc',
    jobId: 'job-xyz',
    scopeId: 'scope-1',
    agentProfileName: 'senior_dev',
    userId: 'user-1',
    ...overrides,
  };
}

function buildServiceWithCandidates(opts: {
  capturedCount: number;
  budget?: number;
  similarityResult?: Array<{
    ownerType: string;
    ownerId: string;
    score: number;
  }>;
  candidateForReinforce?: { id: string; recurrence_count: number } | null;
}): {
  service: RememberWriteGuardService;
  candidates: { list: ReturnType<typeof vi.fn> };
} {
  const {
    capturedCount,
    budget = DEFAULT_BUDGET,
    similarityResult = [],
    candidateForReinforce = null,
  } = opts;

  // When similarity results are provided, the list must return at least one
  // candidate so the scope is non-empty and findNearest is reached.
  const listData =
    similarityResult.length > 0
      ? similarityResult.map((r) => ({ id: r.ownerId }))
      : [];

  const candidates = {
    countAgentCaptureByJob: vi.fn().mockResolvedValue(capturedCount),
    findById: vi.fn().mockResolvedValue(candidateForReinforce),
    updateById: vi.fn().mockResolvedValue(candidateForReinforce),
    list: vi.fn().mockResolvedValue({ data: listData, total: listData.length }),
  };

  const settings = {
    get: vi.fn((key: string, def: unknown) => {
      if (key === BUDGET_SETTING_KEY) return Promise.resolve(budget);
      return Promise.resolve(def);
    }),
  };

  const similarity = {
    findNearest: vi.fn().mockResolvedValue(similarityResult),
    findRawSimilarNeighbors: vi.fn().mockResolvedValue(similarityResult),
  };

  const service = new RememberWriteGuardService(
    candidates as never,
    settings as never,
    similarity,
  );

  return { service, candidates };
}

function buildService(
  opts: Parameters<typeof buildServiceWithCandidates>[0],
): RememberWriteGuardService {
  return buildServiceWithCandidates(opts).service;
}

describe('RememberWriteGuardService — budget enforcement', () => {
  it('returns budget_exhausted when captured count equals the budget', async () => {
    const service = buildService({ capturedCount: 8, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'Use retry on flaky tests',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    expect(result).toEqual({ action: 'budget_exhausted' });
  });

  it('returns budget_exhausted when captured count exceeds budget', async () => {
    const service = buildService({ capturedCount: 10, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'Use retry on flaky tests',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    expect(result).toEqual({ action: 'budget_exhausted' });
  });

  it('allows insert when under budget', async () => {
    const service = buildService({ capturedCount: 3, budget: 8 });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'Use retry on flaky tests, set timeout_ms on run_command',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    expect(result).toEqual({ action: 'proceed' });
  });

  it('skips budget check when workflowRunId is absent', async () => {
    const service = buildService({ capturedCount: 100, budget: 8 });
    const result = await service.checkBudgetAndNearDup(
      buildContext({ workflowRunId: undefined, jobId: undefined }),
      {
        content: 'Use retry on flaky tests, set timeout_ms on run_command',
        scopeType: 'project',
        scopeId: 'scope-1',
      },
    );
    // No context to count against — proceed
    expect(result).toEqual({ action: 'proceed' });
  });
});

describe('RememberWriteGuardService — near-dup reinforcement', () => {
  it('requests the first page of the near-dup scope (offset:0 -> page:1, Task 17)', async () => {
    const { service, candidates } = buildServiceWithCandidates({
      capturedCount: 0,
      similarityResult: [
        { ownerType: 'learning_candidate', ownerId: 'cand-x', score: 0.99 },
      ],
    });

    await service.checkBudgetAndNearDup(buildContext(), {
      content: 'A lesson used only to exercise the scope-building query',
      scopeType: 'project',
      scopeId: 'scope-1',
    });

    expect(candidates.list).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'project',
        scopeId: 'scope-1',
        page: 1,
      }),
    );
  });

  it('reinforces an existing candidate when similarity >= threshold', async () => {
    const existingCandidate = { id: 'cand-existing', recurrence_count: 2 };
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        {
          ownerType: 'learning_candidate',
          ownerId: 'cand-existing',
          score: 0.9,
        },
      ],
      candidateForReinforce: existingCandidate,
    });

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content:
        'Some lesson about retries that nearly duplicates an existing one',
      scopeType: 'project',
      scopeId: 'scope-1',
    });

    expect(result).toEqual({
      action: 'reinforced',
      candidateId: 'cand-existing',
    });
  });

  it('proceeds to insert when no similar candidate found', async () => {
    const service = buildService({ capturedCount: 0, similarityResult: [] });
    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content:
        'A completely novel lesson about build timeouts and infrastructure',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    expect(result).toEqual({ action: 'proceed' });
  });

  it('proceeds to insert when similarity is below threshold', async () => {
    const existingCandidate = { id: 'cand-other', recurrence_count: 1 };
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        { ownerType: 'learning_candidate', ownerId: 'cand-other', score: 0.5 },
      ],
      candidateForReinforce: existingCandidate,
    });

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'A lesson about a different topic entirely',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    expect(result).toEqual({ action: 'proceed' });
  });

  it('falls back to proceed when similarity service throws', async () => {
    const candidates = {
      countAgentCaptureByJob: vi.fn().mockResolvedValue(0),
      findById: vi.fn().mockResolvedValue(null),
      updateById: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    };
    const settings = {
      get: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
    };
    const brokenSimilarity = {
      findNearest: vi
        .fn()
        .mockRejectedValue(new Error('embedding service down')),
      findRawSimilarNeighbors: vi
        .fn()
        .mockRejectedValue(new Error('embedding service down')),
    };

    const service = new RememberWriteGuardService(
      candidates as never,
      settings as never,
      brokenSimilarity,
    );

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'A lesson about handling errors in embedding services',
      scopeType: 'project',
      scopeId: 'scope-1',
    });
    // Fail-soft: similarity error → fall through to insert
    expect(result).toEqual({ action: 'proceed' });
  });

  it('skips near-dup check for global scope (no scopeId to search)', async () => {
    const service = buildService({
      capturedCount: 0,
      similarityResult: [
        { ownerType: 'learning_candidate', ownerId: 'cand-x', score: 0.99 },
      ],
    });

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'A global scope lesson, very long content to pass min length',
      scopeType: 'global',
      scopeId: null,
    });
    // global scope has no candidates to reinforce against
    expect(result).toEqual({ action: 'proceed' });
  });

  it('does not treat an agent-scoped write as a near-duplicate of the project-scoped candidate pool (FU-15)', async () => {
    const candidates = {
      countAgentCaptureByJob: vi.fn().mockResolvedValue(0),
      findById: vi.fn(),
      updateById: vi.fn(),
      // Only the PROJECT scope bucket has a pending candidate; the agent
      // scope's own bucket is empty.
      list: vi
        .fn()
        .mockImplementation((params: Record<string, unknown>) =>
          Promise.resolve(
            params.scopeType === 'project' && params.scopeId === 'proj-1'
              ? { data: [{ id: 'project-candidate' }], total: 1 }
              : { data: [], total: 0 },
          ),
        ),
    };
    const settings = {
      get: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
    };
    const similarity = {
      findNearest: vi.fn(),
      findRawSimilarNeighbors: vi.fn().mockResolvedValue([
        {
          ownerType: 'learning_candidate',
          ownerId: 'project-candidate',
          score: 0.99,
        },
      ]),
    };
    const service = new RememberWriteGuardService(
      candidates as never,
      settings as never,
      similarity,
    );

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'Identical lesson text captured from two different scopes',
      scopeType: 'agent',
      scopeId: 'implementer-agent',
    });

    // The agent-scope bucket is empty — must not be conflated with the
    // project-scope bucket's pending candidate.
    expect(candidates.list).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: 'agent',
        scopeId: 'implementer-agent',
      }),
    );
    expect(result).toEqual({ action: 'proceed' });
  });

  it('still reinforces a same-scope near-duplicate for a non-project (agent) scope', async () => {
    const existingCandidate = { id: 'agent-cand', recurrence_count: 0 };
    const candidates = {
      countAgentCaptureByJob: vi.fn().mockResolvedValue(0),
      findById: vi.fn().mockResolvedValue(existingCandidate),
      updateById: vi.fn().mockResolvedValue(existingCandidate),
      list: vi
        .fn()
        .mockImplementation((params: Record<string, unknown>) =>
          Promise.resolve(
            params.scopeType === 'agent' &&
              params.scopeId === 'implementer-agent'
              ? { data: [{ id: 'agent-cand' }], total: 1 }
              : { data: [], total: 0 },
          ),
        ),
    };
    const settings = {
      get: vi.fn((_key: string, def: unknown) => Promise.resolve(def)),
    };
    const similarity = {
      findNearest: vi.fn(),
      findRawSimilarNeighbors: vi.fn().mockResolvedValue([
        {
          ownerType: 'learning_candidate',
          ownerId: 'agent-cand',
          score: 0.99,
        },
      ]),
    };
    const service = new RememberWriteGuardService(
      candidates as never,
      settings as never,
      similarity,
    );

    const result = await service.checkBudgetAndNearDup(buildContext(), {
      content: 'Identical lesson text within the same agent scope',
      scopeType: 'agent',
      scopeId: 'implementer-agent',
    });

    expect(result).toEqual({ action: 'reinforced', candidateId: 'agent-cand' });
  });
});
