import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentPromptContextService } from './subagent-prompt-context.service';

describe('SubagentPromptContextService.buildPromotedLearningContext (FU-8)', () => {
  const searchPromotedLessonsByScope = vi.fn();
  const retrieve = vi.fn();
  const settingsGet = vi.fn();
  const assemble = vi.fn();
  let service: SubagentPromptContextService;

  beforeEach(() => {
    vi.clearAllMocks();
    searchPromotedLessonsByScope.mockResolvedValue([]);
    retrieve.mockResolvedValue([]);
    settingsGet.mockResolvedValue('recency');

    service = new SubagentPromptContextService(
      { assemble } as any, // systemPromptAssembly
      { searchPromotedLessonsByScope } as any, // memoryManager
      { retrieve } as any, // memoryRetrieval
      { get: settingsGet } as any, // systemSettings
    );
  });

  it('returns an empty string when no scope can be resolved', async () => {
    const result = await service.buildPromotedLearningContext({
      workflowRunId: '',
    });

    expect(result).toBe('');
    expect(searchPromotedLessonsByScope).not.toHaveBeenCalled();
  });

  it('renders a "## Prior promoted lessons" section via the SAME shared helper the step path uses (parity)', async () => {
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
      '1. Cite evidence before mutating workflow behavior.  (confidence: 0.85, source: learning_candidate)',
    );
  });

  it('threads agentProfileName and workflowName into the recall identity (FU-8 — enables workflow-scoped memory for subagents)', async () => {
    settingsGet.mockResolvedValue('hybrid');
    retrieve.mockResolvedValueOnce([
      {
        id: 'seg-1',
        entity_type: 'workflow_run',
        entity_id: 'run-1',
        content: 'A workflow-scoped lesson.',
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
      agentProfileName: 'implementer-agent',
      workflowName: 'implementation_pipeline',
    });

    expect(retrieve).toHaveBeenCalledWith({
      scopeId: 'run-1',
      queryText: 'how do I connect to the dev database',
      tokenBudget: 3000,
      agentProfileName: 'implementer-agent',
      workflowName: 'implementation_pipeline',
    });
    expect(result).toContain('A workflow-scoped lesson.');
  });

  it('legacy (recency) fallback unions the workflow scope when workflowName is supplied', async () => {
    const workflowLesson = {
      id: 'workflow-lesson',
      entity_type: 'workflow',
      entity_id: 'implementation_pipeline',
      content: 'Workflow-scoped recency lesson.',
      memory_type: 'fact' as const,
      version: 1,
      metadata_json: { confidence: 0.8, source: 'learning_candidate' },
      created_at: new Date(),
      updated_at: new Date(),
    };
    searchPromotedLessonsByScope.mockImplementation(
      ({ entity_type }: { entity_type: string }) =>
        entity_type === 'workflow'
          ? Promise.resolve([workflowLesson])
          : Promise.resolve([]),
    );

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
      workflowName: 'implementation_pipeline',
    });

    expect(searchPromotedLessonsByScope).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: 'workflow',
        entity_id: 'implementation_pipeline',
      }),
    );
    expect(result).toContain('Workflow-scoped recency lesson.');
  });

  it('returns an empty string and does not throw when the memory manager errors', async () => {
    searchPromotedLessonsByScope.mockRejectedValueOnce(
      new Error('postgres unavailable'),
    );

    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
    });

    expect(result).toBe('');
  });

  it('returns an empty string when no lessons are found', async () => {
    const result = await service.buildPromotedLearningContext({
      workflowRunId: 'run-1',
    });

    expect(result).toBe('');
  });
});

describe('SubagentPromptContextService.assembleAgentSystemPrompt', () => {
  it('delegates to SystemPromptAssemblyService.assemble and returns the prompt', async () => {
    const assemble = vi.fn().mockResolvedValue({ prompt: 'ASSEMBLED PROMPT' });
    const service = new SubagentPromptContextService(
      { assemble } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.assembleAgentSystemPrompt({
      runType: 'subagent',
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'step-1',
      baseLayers: [],
    } as any);

    expect(assemble).toHaveBeenCalled();
    expect(result).toBe('ASSEMBLED PROMPT');
  });
});
