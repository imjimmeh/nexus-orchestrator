import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolPolicyEffect, type IJob, type IToolRegistry } from '@nexus/core';
import { StepSupportService } from './step-support.service';
import { buildJobOutputToolSchema } from './step-support-output-contract.helpers';

describe('StepSupportService.resolveAssignedSkillsForProfile', () => {
  const resolveAssignedSkillsMock = vi.fn();
  const findByIdMock = vi.fn();
  const workflowFindByIdMock = vi.fn();

  let service: StepSupportService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveAssignedSkillsMock.mockResolvedValue({ skills: [] });
    findByIdMock.mockResolvedValue({ workflow_id: 'create_skill' });
    workflowFindByIdMock.mockResolvedValue({ name: 'create-skill-workflow' });

    service = new StepSupportService(
      {} as any, // aiConfig
      { findById: findByIdMock } as any, // runRepo
      { findById: workflowFindByIdMock } as any, // workflowRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      { resolveAssignedSkills: resolveAssignedSkillsMock } as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
      {} as any, // memoryManager
      {} as any, // memoryMetrics
      {} as any, // metrics
      {} as any, // systemPromptAssembly
      {} as any, // memoryRetrieval
      {} as any, // systemSettings
    );
  });

  it('derives scopeId from the trigger and workflowId/workflowName from the run', async () => {
    const result = await service.resolveAssignedSkillsForProfile(
      'software-architect',
      {
        stateVariables: { trigger: { scopeId: 'scope-123' } },
        workflowRunId: 'run-1',
      },
    );

    expect(findByIdMock).toHaveBeenCalledTimes(1);
    expect(findByIdMock).toHaveBeenCalledWith('run-1');
    expect(workflowFindByIdMock).toHaveBeenCalledWith('create_skill');
    expect(resolveAssignedSkillsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfile: 'software-architect',
        scopeId: 'scope-123',
        workflowId: 'create_skill',
      }),
    );
    // The resolved workflowId/workflowName are surfaced so callers reuse
    // them without a second lookup round-trip.
    expect(result).toEqual({
      skills: [],
      workflowId: 'create_skill',
      workflowName: 'create-skill-workflow',
    });
  });

  it('omits workflowId/workflowName when no workflowRunId is provided', async () => {
    const result = await service.resolveAssignedSkillsForProfile(
      'software-architect',
      {
        stateVariables: { trigger: { scopeId: 'scope-123' } },
      },
    );

    expect(findByIdMock).not.toHaveBeenCalled();
    expect(workflowFindByIdMock).not.toHaveBeenCalled();
    expect(resolveAssignedSkillsMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: undefined }),
    );
    expect(result).toEqual({
      skills: [],
      workflowId: undefined,
      workflowName: undefined,
    });
  });

  it('returns undefined workflowId/workflowName when runRepo.findById throws', async () => {
    findByIdMock.mockRejectedValue(new Error('DB error'));

    const result = await service.resolveAssignedSkillsForProfile(
      'software-architect',
      {
        stateVariables: { trigger: { scopeId: 'scope-123' } },
        workflowRunId: 'run-error',
      },
    );

    expect(workflowFindByIdMock).not.toHaveBeenCalled();
    expect(resolveAssignedSkillsMock).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: undefined }),
    );
    expect(result).toEqual({
      skills: [],
      workflowId: undefined,
      workflowName: undefined,
    });
  });

  it('returns undefined workflowName when workflowRepo.findById throws', async () => {
    workflowFindByIdMock.mockRejectedValue(new Error('DB error'));

    const result = await service.resolveAssignedSkillsForProfile(
      'software-architect',
      {
        stateVariables: { trigger: { scopeId: 'scope-123' } },
        workflowRunId: 'run-1',
      },
    );

    expect(result).toEqual({
      skills: [],
      workflowId: 'create_skill',
      workflowName: undefined,
    });
  });
});

describe('StepSupportService.buildRunningWorkflowsContext', () => {
  const findActiveByScopeId = vi.fn();
  const findByIds = vi.fn();
  let service: StepSupportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new StepSupportService(
      {} as any, // aiConfig
      { findActiveByScopeId } as any, // runRepo
      { findByIds } as any, // workflowRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      {} as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
      {} as any, // memoryManager
      {} as any, // memoryMetrics
      {} as any, // metrics
      {} as any, // systemPromptAssembly
      {} as any, // memoryRetrieval
      {} as any, // systemSettings
    );
  });

  it('returns an empty string when the state has no scope', async () => {
    const result = await service.buildRunningWorkflowsContext({
      stateVariables: {},
    });

    expect(result).toBe('');
    expect(findActiveByScopeId).not.toHaveBeenCalled();
  });

  it('renders a name-resolved summary excluding the calling run', async () => {
    findActiveByScopeId.mockResolvedValue([
      {
        id: 'sibling-run',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        wait_reason: null,
        state_variables: {},
        created_at: new Date(Date.now() - 120_000),
      },
      {
        id: 'self-run',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        wait_reason: null,
        state_variables: {},
        created_at: new Date(),
      },
    ]);
    findByIds.mockResolvedValue([
      { id: 'wf-1', name: 'Project Backlog Generation (CEO)' },
    ]);

    const result = await service.buildRunningWorkflowsContext({
      stateVariables: { trigger: { scopeId: 'scope-1' } },
      excludeRunId: 'self-run',
    });

    expect(findActiveByScopeId).toHaveBeenCalledWith('scope-1');
    expect(result).toContain('Workflows already running for this scope (1):');
    expect(result).toContain('Project Backlog Generation (CEO)');
    expect(result).toContain('run sibling-run');
    expect(result).not.toContain('self-run');
  });

  it('never throws — returns an empty string when the lookup fails', async () => {
    findActiveByScopeId.mockRejectedValue(new Error('DB down'));

    const result = await service.buildRunningWorkflowsContext({
      stateVariables: { trigger: { scopeId: 'scope-1' } },
    });

    expect(result).toBe('');
  });
});

describe('StepSupportService.buildPromotedLearningContext', () => {
  const searchPromotedLessonsByScope = vi.fn();
  const retrieve = vi.fn();
  const settingsGet = vi.fn();
  const memoryMetrics = {
    recordLearningLessonInjected: vi.fn(),
  };
  const metrics = {
    recordLearningLessonInjected: vi.fn(),
  };
  let service: StepSupportService;

  beforeEach(() => {
    vi.clearAllMocks();
    searchPromotedLessonsByScope.mockResolvedValue([]);
    retrieve.mockResolvedValue([]);
    // Default these tests to the recency path; hybrid is covered explicitly below.
    settingsGet.mockResolvedValue('recency');
    service = new StepSupportService(
      {} as any, // aiConfig
      {} as any, // runRepo
      {} as any, // workflowRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      {} as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
      { searchPromotedLessonsByScope } as any, // memoryManager
      memoryMetrics as any, // memoryMetrics
      metrics as any, // metrics
      {} as any, // systemPromptAssembly
      { retrieve } as any, // memoryRetrieval
      { get: settingsGet } as any, // systemSettings
    );
  });

  it('returns an empty string when no scope and no workflowRunId can be resolved', async () => {
    const result = await service.buildPromotedLearningContext({
      workflowRunId: '',
    });
    expect(result).toBe('');
    expect(searchPromotedLessonsByScope).not.toHaveBeenCalled();
  });

  it('hybrid mode retrieves via MemoryRetrievalService and skips the recency search', async () => {
    settingsGet.mockResolvedValue('hybrid');
    retrieve.mockResolvedValueOnce([
      {
        id: 'seg-1',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'The dev DB only accepts the nexus_dev role on port 5433.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.9, source: 'agent_capture' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      query: 'how do I connect to the dev database',
    });

    expect(retrieve).toHaveBeenCalledWith({
      scopeId: 'run-1',
      queryText: 'how do I connect to the dev database',
      tokenBudget: 3000,
    });
    expect(searchPromotedLessonsByScope).not.toHaveBeenCalled();
    expect(result).toContain('## Prior promoted lessons');
    expect(result).toContain('The dev DB only accepts the nexus_dev role');
  });

  it('hybrid mode falls back to the recency search when retrieval is empty', async () => {
    settingsGet.mockResolvedValue('hybrid');
    retrieve.mockResolvedValueOnce([]);
    searchPromotedLessonsByScope.mockResolvedValueOnce([
      {
        id: 'lesson-x',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'Recency fallback lesson.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.5, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      query: 'anything',
    });

    expect(retrieve).toHaveBeenCalled();
    expect(searchPromotedLessonsByScope).toHaveBeenCalled();
    expect(result).toContain('Recency fallback lesson.');
  });

  it('hybrid mode with no query uses the recency search (nothing to embed)', async () => {
    settingsGet.mockResolvedValue('hybrid');

    await service.buildPromotedLearningContext({ workflowRunId: 'run-1' });

    expect(retrieve).not.toHaveBeenCalled();
    expect(searchPromotedLessonsByScope).toHaveBeenCalled();
  });

  it('renders a "## Prior promoted lessons" section when the memory manager returns segments', async () => {
    searchPromotedLessonsByScope.mockResolvedValueOnce([
      {
        id: 'lesson-1',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'Cite evidence before mutating workflow behavior.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: {
          confidence: 0.85,
          source: 'learning_candidate',
          tags: ['repair', 'evidence'],
        },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'lesson-2',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'Prefer concise plans over verbose ones.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.7, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      query: 'evidence',
    });

    expect(searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      query: 'evidence',
      limit: 25,
    });
    expect(result).toContain('## Prior promoted lessons');
    expect(result).toContain(
      '1. Cite evidence before mutating workflow behavior.  (confidence: 0.85, source: learning_candidate)  tags: repair, evidence',
    );
    expect(result).toContain(
      '2. Prefer concise plans over verbose ones.  (confidence: 0.70, source: learning_candidate)',
    );
  });

  it('falls back to the trigger context entityType/entityId when available', async () => {
    searchPromotedLessonsByScope.mockResolvedValueOnce([
      {
        id: 'lesson-3',
        entity_type: 'project',
        entity_id: 'project-1',
        content: 'Use the project worktree when applicable.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.6, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-99',
      stateVariables: {
        trigger: {
          context: { entityType: 'project', entityId: 'project-1' },
        },
      },
    });

    expect(searchPromotedLessonsByScope).toHaveBeenCalledWith({
      entity_type: 'project',
      entity_id: 'project-1',
      limit: 25,
    });
    expect(result).toContain('## Prior promoted lessons');
    expect(result).toContain('1. Use the project worktree when applicable.');
  });

  it('returns an empty string and does not throw when the memory manager throws', async () => {
    searchPromotedLessonsByScope.mockRejectedValueOnce(
      new Error('postgres unavailable'),
    );

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
    });

    expect(result).toBe('');
  });

  it('truncates output when there are many lessons and emits an omitted-count footer', async () => {
    const lessons = Array.from({ length: 80 }, (_, index) => ({
      id: `lesson-${index}`,
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      content: `Lesson number ${index} with a fairly long body. `.repeat(20),
      memory_type: 'fact' as const,
      version: 1,
      metadata_json: { confidence: 0.5, source: 'learning_candidate' },
      created_at: new Date(),
      updated_at: new Date(),
    }));
    searchPromotedLessonsByScope.mockResolvedValueOnce(lessons);

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
    });

    expect(result.length).toBeLessThanOrEqual(6000);
    expect(result).toContain('… (truncated');
  });

  // ---------------------------------------------------------------------
  // Learning-lesson injection metric wiring (work item 88d7654e)
  // ---------------------------------------------------------------------
  //
  // `buildPromotedLearningContext` is the natural seam where the
  // "did a downstream agent use this promoted lesson" signal
  // fires. The metric must:
  //   * increment ONCE per lesson that actually enters the
  //     planning context (so the counter is a faithful "used"
  //     rate, not a "queried" rate);
  //   * NOT fire when the search returns no rows;
  //   * NOT fire when the memory backend errors out;
  //   * tag each increment with the lesson's UUID and the
  //     resolved scope id so per-(lesson, scope) breakdowns are
  //     queryable in Prometheus.

  it('records a learning-lesson injection per lesson in the rendered context', async () => {
    searchPromotedLessonsByScope.mockResolvedValueOnce([
      {
        id: 'lesson-1',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'Cite evidence before mutating workflow behavior.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.85, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'lesson-2',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'Prefer concise plans over verbose ones.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.7, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await service.buildPromotedLearningContext({ workflowRunId: 'run-1' });

    expect(metrics.recordLearningLessonInjected).toHaveBeenCalledTimes(2);
    expect(metrics.recordLearningLessonInjected).toHaveBeenNthCalledWith(
      1,
      'lesson-1',
      'run-1',
    );
    expect(metrics.recordLearningLessonInjected).toHaveBeenNthCalledWith(
      2,
      'lesson-2',
      'run-1',
    );
    expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenCalledTimes(2);
    expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenNthCalledWith(
      1,
      { lesson_id: 'lesson-1', scope: 'run-1' },
      { workflowRunId: 'run-1' },
    );
    expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenNthCalledWith(
      2,
      { lesson_id: 'lesson-2', scope: 'run-1' },
      { workflowRunId: 'run-1' },
    );
  });

  it('uses the trigger-context scope id when available instead of the run id', async () => {
    searchPromotedLessonsByScope.mockResolvedValueOnce([
      {
        id: 'lesson-3',
        entity_type: 'project',
        entity_id: 'project-1',
        content: 'Use the project worktree when applicable.',
        memory_type: 'fact' as const,
        version: 1,
        metadata_json: { confidence: 0.6, source: 'learning_candidate' },
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await service.buildPromotedLearningContext({
      workflowRunId: 'run-99',
      stateVariables: {
        trigger: {
          context: { entityType: 'project', entityId: 'project-1' },
        },
      },
    });

    expect(metrics.recordLearningLessonInjected).toHaveBeenCalledWith(
      'lesson-3',
      'project-1',
    );
    expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenCalledWith(
      { lesson_id: 'lesson-3', scope: 'project-1' },
      { workflowRunId: 'run-99' },
    );
  });

  it('does not record any injection when the search returns no lessons', async () => {
    searchPromotedLessonsByScope.mockResolvedValueOnce([]);

    await service.buildPromotedLearningContext({ workflowRunId: 'run-1' });

    expect(metrics.recordLearningLessonInjected).not.toHaveBeenCalled();
    expect(memoryMetrics.recordLearningLessonInjected).not.toHaveBeenCalled();
  });

  describe('A/B holdout (EPIC-212 Phase 3 Task 6)', () => {
    const lesson = {
      id: 'lesson-h',
      entity_type: 'project',
      entity_id: 'project-h',
      content: 'A holdout lesson.',
      memory_type: 'fact' as const,
      version: 1,
      metadata_json: { confidence: 0.8, source: 'learning_candidate' },
      created_at: new Date(),
      updated_at: new Date(),
    };

    function settingsWithHoldout(fraction: number) {
      settingsGet.mockImplementation(async (key: string, fallback: unknown) => {
        if (key === 'learning_holdout_fraction') {
          return fraction;
        }
        if (key === 'memory_retrieval_mode') {
          return 'recency';
        }
        return fallback ?? 'recency';
      });
    }

    const projectScope = {
      trigger: { context: { entityType: 'project', entityId: 'project-h' } },
    };

    it('fraction = 0 leaves injection unchanged and stamps no arm (default-inert)', async () => {
      settingsWithHoldout(0);
      searchPromotedLessonsByScope.mockResolvedValueOnce([lesson]);

      const result = await service.buildPromotedLearningContext({
        workflowRunId: 'run-h',
        stateVariables: projectScope,
      });

      expect(result).toContain('## Prior promoted lessons');
      expect(metrics.recordLearningLessonInjected).toHaveBeenCalledTimes(1);
      expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenCalledWith(
        { lesson_id: 'lesson-h', scope: 'project-h' },
        { workflowRunId: 'run-h' },
      );
    });

    it('a bucketed (holdout) scope gets NO injected section and records the holdout arm', async () => {
      settingsWithHoldout(1); // fraction = 1 → every scope is holdout
      searchPromotedLessonsByScope.mockResolvedValueOnce([lesson]);

      const result = await service.buildPromotedLearningContext({
        workflowRunId: 'run-h',
        stateVariables: projectScope,
      });

      // Causal suppression: the section is empty (the lesson was NOT injected).
      expect(result).toBe('');
      // The prom "injected" counter must NOT fire for a suppressed lesson.
      expect(metrics.recordLearningLessonInjected).not.toHaveBeenCalled();
      // But the inject record IS stamped with the holdout arm for measurement.
      expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenCalledWith(
        { lesson_id: 'lesson-h', scope: 'project-h', holdout_arm: 'holdout' },
        { workflowRunId: 'run-h' },
      );
    });
  });

  it('does not record any injection when the memory manager throws', async () => {
    searchPromotedLessonsByScope.mockRejectedValueOnce(
      new Error('postgres unavailable'),
    );

    await service.buildPromotedLearningContext({ workflowRunId: 'run-1' });

    expect(metrics.recordLearningLessonInjected).not.toHaveBeenCalled();
    expect(memoryMetrics.recordLearningLessonInjected).not.toHaveBeenCalled();
  });

  it('records an injection for every lesson, even when truncation drops some from the rendered output', async () => {
    // The metric counts "lessons used by the planning step"
    // — not "lessons visible in the rendered section". The
    // search returned N rows, all N are sent downstream, and the
    // formatter truncates the textual rendering to keep the
    // section under the 6000-char cap. Both increments must
    // fire for the metric to remain a faithful "used" signal.
    const lessons = Array.from({ length: 80 }, (_, index) => ({
      id: `lesson-${index}`,
      entity_type: 'workflow_run',
      entity_id: 'run-1',
      content: `Lesson number ${index} with a fairly long body. `.repeat(20),
      memory_type: 'fact' as const,
      version: 1,
      metadata_json: { confidence: 0.5, source: 'learning_candidate' },
      created_at: new Date(),
      updated_at: new Date(),
    }));
    searchPromotedLessonsByScope.mockResolvedValueOnce(lessons);

    await service.buildPromotedLearningContext({ workflowRunId: 'run-1' });

    expect(metrics.recordLearningLessonInjected).toHaveBeenCalledTimes(80);
    expect(memoryMetrics.recordLearningLessonInjected).toHaveBeenCalledTimes(
      80,
    );
  });

  it('threads agentProfileName and the run-resolved workflow name into hybrid retrieval (Epic C)', async () => {
    settingsGet.mockResolvedValue('hybrid');
    retrieve.mockResolvedValueOnce([]);
    const scopedService = new StepSupportService(
      {} as any, // aiConfig
      {
        findById: vi.fn().mockResolvedValue({ workflow_id: 'wf-uuid' }),
      } as any, // runRepo
      {
        findById: vi.fn().mockResolvedValue({
          id: 'wf-uuid',
          name: 'default_execution_workflow',
        }),
      } as any, // workflowRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      {} as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
      { searchPromotedLessonsByScope } as any, // memoryManager
      memoryMetrics as any, // memoryMetrics
      metrics as any, // metrics
      {} as any, // systemPromptAssembly
      { retrieve } as any, // memoryRetrieval
      { get: settingsGet } as any, // systemSettings
    );

    await scopedService.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      query: 'how do I connect to the dev database',
      agentProfileName: 'implementer-agent',
    });

    expect(retrieve).toHaveBeenCalledWith({
      scopeId: 'run-1',
      queryText: 'how do I connect to the dev database',
      tokenBudget: 3000,
      agentProfileName: 'implementer-agent',
      workflowName: 'default_execution_workflow',
    });
  });

  it('uses a caller-supplied workflowName directly, skipping the run/workflow lookup (FU-8 parity with subagent path)', async () => {
    settingsGet.mockResolvedValue('hybrid');
    retrieve.mockResolvedValueOnce([]);
    const runFindById = vi.fn();
    const workflowFindById = vi.fn();
    const scopedService = new StepSupportService(
      {} as any, // aiConfig
      { findById: runFindById } as any, // runRepo
      { findById: workflowFindById } as any, // workflowRepo
      {} as any, // toolMounting
      {} as any, // stateManager
      {} as any, // gitWorktreeService
      {} as any, // stageSkillPolicy
      {} as any, // toolPolicyEvaluator
      { searchPromotedLessonsByScope } as any, // memoryManager
      memoryMetrics as any, // memoryMetrics
      metrics as any, // metrics
      {} as any, // systemPromptAssembly
      { retrieve } as any, // memoryRetrieval
      { get: settingsGet } as any, // systemSettings
    );

    await scopedService.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      query: 'how do I connect to the dev database',
      agentProfileName: 'implementer-agent',
      workflowName: 'caller-supplied-workflow',
    });

    // The run→workflowId→name lookup is skipped entirely — the same
    // PromptContextSupportLike#buildPromotedLearningContext contract the
    // subagent path uses (which has no such internal fallback) resolves
    // identically when the caller already supplies workflowName.
    expect(runFindById).not.toHaveBeenCalled();
    expect(workflowFindById).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledWith({
      scopeId: 'run-1',
      queryText: 'how do I connect to the dev database',
      tokenBudget: 3000,
      agentProfileName: 'implementer-agent',
      workflowName: 'caller-supplied-workflow',
    });
  });
});

describe('StepSupportService', () => {
  let service: StepSupportService;

  const mockGitWorktreeService = {
    getExistingWorktreePath: vi.fn(),
    resolveProjectBasePath: vi.fn(),
  };

  const mockAiConfig = {
    getAgentProfileByName: vi.fn(),
  };
  const mockRunRepo = {} as never;
  const mockToolMounting = {} as never;
  const mockStateManager = {} as never;
  const mockStageSkillPolicy = {} as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAiConfig.getAgentProfileByName.mockResolvedValue(null);

    service = new StepSupportService(
      mockAiConfig as never,
      mockRunRepo,
      {} as never, // workflowRepo
      mockToolMounting,
      mockStateManager,
      mockGitWorktreeService as never,
      mockStageSkillPolicy,
      {} as any,
      {} as any, // memoryManager
      {} as any, // memoryMetrics
      {} as any, // metrics
      {} as any, // systemPromptAssembly
      {} as any, // memoryRetrieval
      {} as any, // systemSettings
    );
  });

  describe('resolveAgentToolPolicy', () => {
    it('returns a valid persisted agent tool policy', async () => {
      const toolPolicy = {
        default: ToolPolicyEffect.DENY,
        rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
      };
      mockAiConfig.getAgentProfileByName.mockResolvedValueOnce({
        tool_policy: toolPolicy,
      });

      await expect(service.resolveAgentToolPolicy('ceo-agent')).resolves.toBe(
        toolPolicy,
      );
    });

    it('returns a deny-all policy for malformed persisted agent tool policy', async () => {
      mockAiConfig.getAgentProfileByName.mockResolvedValueOnce({
        tool_policy: { default: ToolPolicyEffect.DENY },
      });

      await expect(
        service.resolveAgentToolPolicy('ceo-agent'),
      ).resolves.toEqual({
        default: ToolPolicyEffect.DENY,
        rules: [],
      });
    });
  });

  describe('buildJobOutputToolSchema', () => {
    it('returns undefined when the contract is undefined', () => {
      const tool = makeSetJobOutputTool();

      const result = buildJobOutputToolSchema(tool, undefined);

      expect(result).toBeUndefined();
    });

    it('builds a schema with required fields from the output contract', () => {
      const tool = makeSetJobOutputTool();
      const contract = {
        required: ['decision', 'confidence', 'rationale'],
      };

      const result = buildJobOutputToolSchema(tool, contract);

      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected result to be defined');
      }
      const dataSchema = getDataSchema(result.schema);
      expect(dataSchema?.type).toBe('object');
      expect(dataSchema?.required).toEqual([
        'decision',
        'confidence',
        'rationale',
      ]);
      expect(dataSchema?.properties).toMatchObject({
        decision: {},
        confidence: {},
        rationale: {},
      });
    });

    it('includes optional fields without marking them required', () => {
      const tool = makeSetJobOutputTool();
      const contract = {
        required: ['decision'],
        optional: ['notes'],
      };

      const result = buildJobOutputToolSchema(tool, contract);

      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected result to be defined');
      }
      const dataSchema = getDataSchema(result.schema);
      expect(dataSchema?.required).toEqual(['decision']);
      expect(dataSchema?.properties).toMatchObject({
        decision: {},
        notes: {},
      });
    });

    it('allows additional properties beyond required and optional fields', () => {
      const tool = makeSetJobOutputTool();
      const contract = { required: ['decision'] };

      const result = buildJobOutputToolSchema(tool, contract);

      if (!result) {
        throw new Error('Expected result to be defined');
      }
      const dataSchema = getDataSchema(result.schema);
      expect(dataSchema?.additionalProperties).not.toBe(false);
    });

    it('leaves untyped output contract properties as any so arrays and objects can pass through', () => {
      const tool = makeSetJobOutputTool();
      const contract = {
        required: ['candidate_items', 'planning_summary'],
      };

      const result = buildJobOutputToolSchema(tool, contract);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected result to be defined');
      const dataSchema = getDataSchema(result.schema);
      expect(getProperty(dataSchema, 'candidate_items')).not.toHaveProperty(
        'type',
      );
      expect(getProperty(dataSchema, 'planning_summary')).not.toHaveProperty(
        'type',
      );
    });

    it('enforces declared types on output contract properties', () => {
      const tool = makeSetJobOutputTool();
      const contract = {
        required: ['candidate_items', 'planning_summary'],
        types: {
          candidate_items: 'array' as const,
          planning_summary: 'string' as const,
        },
      };

      const result = buildJobOutputToolSchema(tool, contract);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected result to be defined');
      const dataSchema = getDataSchema(result.schema);
      expect(getProperty(dataSchema, 'candidate_items')).toEqual({
        type: 'array',
      });
      expect(getProperty(dataSchema, 'planning_summary')).toEqual({
        type: 'string',
      });
    });

    it('emits nested JSON Schema for object and array types', () => {
      const tool = makeSetJobOutputTool();
      const contract = {
        required: ['entries'],
        types: {
          entries: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                name: 'string' as const,
                tags: {
                  type: 'array' as const,
                  items: 'string' as const,
                },
              },
            },
          },
        },
      };

      const result = buildJobOutputToolSchema(tool, contract);

      expect(result).toBeDefined();
      if (!result) throw new Error('Expected result to be defined');
      const dataSchema = getDataSchema(result.schema);
      expect(getProperty(dataSchema, 'entries')).toEqual({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      });
    });
  });

  describe('StepSupportService.selectToolsForJob', () => {
    let service: StepSupportService;

    beforeEach(() => {
      service = new StepSupportService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never, // memoryManager
        {} as never, // memoryMetrics
        {} as never, // metrics
        {} as never, // systemPromptAssembly
        {} as never, // memoryRetrieval
        {} as never, // systemSettings
      );
    });

    it('returns all tools when the job lists no tools', () => {
      const tools: IToolRegistry[] = [
        makeTool({ name: 'read' }),
        makeSetJobOutputTool(),
      ];
      const job = makeJob({ tools: [] });

      const result = service.selectToolsForJob(tools, job);

      expect(result.map((t) => t.name)).toEqual(['read', 'set_job_output']);
    });

    it('enriches set_job_output schema when job has an output contract', () => {
      const tools: IToolRegistry[] = [
        makeTool({ name: 'read' }),
        makeSetJobOutputTool(),
      ];
      const job = makeJob({
        tools: ['read', 'set_job_output'],
        output_contract: { required: ['decision'] },
      });

      const result = service.selectToolsForJob(tools, job);

      const outputTool = result.find((t) => t.name === 'set_job_output');
      expect(outputTool).toBeDefined();
      if (!outputTool) {
        throw new Error('Expected set_job_output tool to be present');
      }
      const dataSchema = getDataSchema(outputTool.schema);
      expect(dataSchema?.required).toEqual(['decision']);
    });

    it('leaves set_job_output schema unchanged when no output contract exists', () => {
      const tools: IToolRegistry[] = [makeSetJobOutputTool()];
      const job = makeJob({
        tools: ['set_job_output'],
        output_contract: undefined,
      });

      const result = service.selectToolsForJob(tools, job);

      const dataSchema = getDataSchema(result[0].schema);
      expect(dataSchema?.additionalProperties).toEqual({});
    });
  });

  function makeJob(overrides: Partial<IJob> = {}): IJob {
    return {
      id: 'job-1',
      type: 'execution',
      tier: 'heavy',
      steps: [],
      ...overrides,
    };
  }

  function makeTool(overrides: Partial<IToolRegistry> = {}): IToolRegistry {
    return {
      id: 'tool-1',
      name: 'read',
      schema: { type: 'object', properties: {} },
      typescript_code: '',
      tier_restriction: 1,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    };
  }

  function makeSetJobOutputTool(): IToolRegistry {
    return makeTool({
      name: 'set_job_output',
      schema: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            additionalProperties: {},
            description:
              'Native JSON object containing the output fields for this job.',
          },
        },
      },
    });
  }

  function getDataSchema(
    schema: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const properties = schema.properties as Record<string, unknown> | undefined;
    return properties?.data as Record<string, unknown> | undefined;
  }

  function getProperty(
    dataSchema: Record<string, unknown> | undefined,
    key: string,
  ): unknown {
    const properties = dataSchema?.properties as
      | Record<string, unknown>
      | undefined;
    return properties?.[key];
  }

  describe('resolveWorktreePathFromTrigger', () => {
    beforeEach(() => {
      mockGitWorktreeService.resolveProjectBasePath.mockResolvedValue(
        '/data/repos/project-1',
      );
    });

    it('returns worktree path when managed worktree exists for context', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(
        '/data/worktrees/project-1/item-1',
      );

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: { scopeId: 'project-1', contextId: 'item-1' },
      });

      expect(result).toBe('/data/worktrees/project-1/item-1');
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenCalledWith('project-1', 'item-1');
    });

    it('prefers an explicit per-run worktree path persisted in run state', async () => {
      const result = await service.resolveWorktreePathFromTrigger({
        trigger: { scopeId: 'project-1' },
        _internal: {
          workspace_worktree_path: '/data/worktrees/project-1/run-123',
        },
      });

      expect(result).toBe('/data/worktrees/project-1/run-123');
      // The persisted path short-circuits the (scopeId, contextId) lookup.
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).not.toHaveBeenCalled();
    });

    it('falls back to basePath from trigger when no explicit contextId is present', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-1',
          basePath: '/data/repos/project-1',
        },
      });

      expect(result).toBe('/data/repos/project-1');
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenCalledWith('project-1', 'project-1');
    });

    it('falls back to basePath from trigger when worktree lookup returns null', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-1',
          contextId: 'item-1',
          basePath: '/data/repos/project-1',
        },
      });

      expect(result).toBe('/data/repos/project-1');
    });

    it('falls back to basePath from trigger when worktree lookup throws', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockRejectedValue(
        new Error('git error'),
      );

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-1',
          contextId: 'item-1',
          basePath: '/data/repos/project-1',
        },
      });

      expect(result).toBe('/data/repos/project-1');
    });

    it('uses trigger.resolvedRepoPath when no basePath exists', async () => {
      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-scope-1',
          resolvedRepoPath: '/data/nexus-workspaces/clones/project-scope-1',
        },
      });

      expect(result).toBe('/data/nexus-workspaces/clones/project-scope-1');
      expect(
        mockGitWorktreeService.resolveProjectBasePath,
      ).not.toHaveBeenCalled();
    });

    it('uses trigger.resolved_repo_path when no camelCase repo path exists', async () => {
      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scope_id: 'project-scope-1',
          resolved_repo_path: '/data/nexus-workspaces/clones/project-scope-1',
        },
      });

      expect(result).toBe('/data/nexus-workspaces/clones/project-scope-1');
      expect(
        mockGitWorktreeService.resolveProjectBasePath,
      ).not.toHaveBeenCalled();
    });

    it('returns undefined when no scope id in trigger', async () => {
      const result = await service.resolveWorktreePathFromTrigger({
        trigger: { contextId: 'item-1' },
      });

      expect(result).toBeUndefined();
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).not.toHaveBeenCalled();
    });

    it('falls back to project repository path when no contextId and no basePath', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: { scopeId: 'project-1' },
      });

      expect(result).toBe('/data/repos/project-1');
      expect(
        mockGitWorktreeService.resolveProjectBasePath,
      ).toHaveBeenCalledWith('project-1');
    });

    it('returns undefined when repository base-path fallback throws', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);
      mockGitWorktreeService.resolveProjectBasePath.mockRejectedValue(
        new Error('repo missing'),
      );

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: { scopeId: 'project-1' },
      });

      expect(result).toBeUndefined();
    });

    it('throws for repo-backed triggers when project base path resolution fails', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);
      mockGitWorktreeService.resolveProjectBasePath.mockRejectedValue(
        new Error('Project base path is not a git repository'),
      );

      await expect(
        service.resolveWorktreePathFromTrigger({
          trigger: {
            scopeId: 'project-scope-1',
            repositoryUrl: 'https://github.com/imjimmeh/nexus-orchestator',
          },
        }),
      ).rejects.toThrow(
        "Unable to resolve workspace mount path for workflow scope 'project-scope-1'",
      );
    });

    it('falls back to project-scoped worktree for orchestration lifecycle context', async () => {
      mockGitWorktreeService.getExistingWorktreePath
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('/data/worktrees/project-1/project-1');

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-1',
          contextId: '__orchestration_lifecycle__',
        },
      });

      expect(result).toBe('/data/worktrees/project-1/project-1');
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenNthCalledWith(1, 'project-1', '__orchestration_lifecycle__');
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenNthCalledWith(2, 'project-1', 'project-1');
    });

    it('uses basePath instead of project-scoped fallback when provided for orchestration lifecycle context', async () => {
      mockGitWorktreeService.getExistingWorktreePath.mockResolvedValue(null);

      const result = await service.resolveWorktreePathFromTrigger({
        trigger: {
          scopeId: 'project-1',
          contextId: '__orchestration_lifecycle__',
          basePath: '/data/repos/project-1',
        },
      });

      expect(result).toBe('/data/repos/project-1');
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockGitWorktreeService.getExistingWorktreePath,
      ).toHaveBeenCalledWith('project-1', '__orchestration_lifecycle__');
    });
  });
});
