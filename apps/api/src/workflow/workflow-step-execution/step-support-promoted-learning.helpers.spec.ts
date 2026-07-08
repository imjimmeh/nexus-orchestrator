import { describe, expect, it, vi } from 'vitest';
import { resolvePromotedLessonsForInjection } from './step-support-promoted-learning.helpers';
import type { IMemorySegment } from '@nexus/core';

function lesson(id: string, createdAt: Date): IMemorySegment {
  return {
    id,
    entity_type: 'project',
    entity_id: 'scope-1',
    memory_type: 'fact',
    content: `lesson ${id}`,
    version: 1,
    metadata_json: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function makeDeps(opts: { mode: 'hybrid' | 'recency' }) {
  return {
    systemSettings: { get: vi.fn().mockResolvedValue(opts.mode) },
    memoryRetrieval: { retrieve: vi.fn().mockResolvedValue([]) },
    memoryManager: {
      searchPromotedLessonsByScope: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('resolvePromotedLessonsForInjection — Epic C identity threading', () => {
  const scope = { entityType: 'project', entityId: 'scope-1' };

  it('forwards agentProfileName and workflowName to the hybrid retrieval call', async () => {
    const deps = makeDeps({ mode: 'hybrid' });
    deps.memoryRetrieval.retrieve.mockResolvedValue([lesson('l1', new Date())]);

    await resolvePromotedLessonsForInjection(
      deps,
      scope,
      'query text',
      undefined,
      {
        agentProfileName: 'implementer-agent',
        workflowName: 'implementation_pipeline',
      },
    );

    expect(deps.memoryRetrieval.retrieve).toHaveBeenCalledWith({
      scopeId: 'scope-1',
      queryText: 'query text',
      tokenBudget: 3000,
      agentProfileName: 'implementer-agent',
      workflowName: 'implementation_pipeline',
    });
  });

  it('legacy fallback unions scope + agent + workflow searches, merged newest-first and capped', async () => {
    const deps = makeDeps({ mode: 'recency' });
    const old = lesson('project-old', new Date('2026-01-01'));
    const fresh = lesson('workflow-fresh', new Date('2026-06-01'));
    const mid = lesson('agent-mid', new Date('2026-03-01'));
    deps.memoryManager.searchPromotedLessonsByScope.mockImplementation(
      ({ entity_type }: { entity_type: string }) => {
        if (entity_type === 'project') return Promise.resolve([old]);
        if (entity_type === 'agent') return Promise.resolve([mid]);
        if (entity_type === 'workflow') return Promise.resolve([fresh]);
        return Promise.resolve([]);
      },
    );

    const result = await resolvePromotedLessonsForInjection(
      deps,
      scope,
      '',
      2,
      {
        agentProfileName: 'implementer-agent',
        workflowName: 'implementation_pipeline',
      },
    );

    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'agent',
        entity_id: 'implementer-agent',
      }),
    );
    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'workflow',
        entity_id: 'implementation_pipeline',
      }),
    );
    expect(result.map((l) => l.id)).toEqual(['workflow-fresh', 'agent-mid']);
  });

  it('legacy fallback queries only the resolved scope when no identity is supplied (no leak)', async () => {
    const deps = makeDeps({ mode: 'recency' });

    await resolvePromotedLessonsForInjection(deps, scope, '', undefined);

    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledTimes(1);
    expect(
      deps.memoryManager.searchPromotedLessonsByScope,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: 'project', entity_id: 'scope-1' }),
    );
  });
});
