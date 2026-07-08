import { describe, expect, it, vi } from 'vitest';
import { buildAgentSystemPrompt } from './step-agent-system-prompt.helpers';
import {
  MEMORY_CAPTURE_GUIDANCE,
  shouldSuppressMemoryCapture,
} from './step-support-memory-capture.helpers';
import type { PromptAssemblyContext } from '../../system-prompt/system-prompt-contributor.types';

type AssembleSpy = (ctx: {
  baseLayers: Array<{ id: string; content: string }>;
}) => Promise<string>;

/** Builds a minimal StepSupportService mock, optionally replacing assembleAgentSystemPrompt. */
function makeSupportMock(assembleSpy?: AssembleSpy) {
  const defaultAssemble: AssembleSpy = async (ctx) =>
    ctx.baseLayers
      .map((l) => l.content)
      .filter(Boolean)
      .join('\n');

  return {
    buildUpstreamContextForJob: vi.fn(async () => ''),
    buildRunningWorkflowsContext: vi.fn(async () => ''),
    buildPromotedLearningContext: vi.fn(async () => ''),
    assembleAgentSystemPrompt: vi.fn(assembleSpy ?? defaultAssemble),
  } as never;
}

function makeBaseParams(
  overrides?: Partial<{
    support: ReturnType<typeof makeSupportMock>;
    agentProfile: string;
    suppressMemoryCapture: boolean;
  }>,
) {
  return {
    support: overrides?.support ?? makeSupportMock(),
    data: {
      workflowRunId: 'run-normal',
      job: { id: 'job-1', inputs: {} },
    } as never,
    step: { id: 'step-1', prompt: 'Do the thing.' } as never,
    stateVariables: {},
    resolvedSystemPrompt: 'Base system prompt.',
    agentProfile: overrides?.agentProfile,
    suppressMemoryCapture: overrides?.suppressMemoryCapture,
  };
}

describe('shouldSuppressMemoryCapture', () => {
  it('returns true for the memory-learning-sweep workflow', () => {
    expect(shouldSuppressMemoryCapture('memory_learning_sweep')).toBe(true);
  });

  it('returns true for the CEO orchestration cycle workflow', () => {
    expect(shouldSuppressMemoryCapture('project_orchestration_cycle_ceo')).toBe(
      true,
    );
  });

  it('returns false for a normal implementation workflow', () => {
    expect(shouldSuppressMemoryCapture('standard_feature_flow')).toBe(false);
  });

  it('returns false when workflowId is undefined', () => {
    expect(shouldSuppressMemoryCapture(undefined)).toBe(false);
  });
});

describe('buildAgentSystemPrompt — memory-capture-guidance layer', () => {
  it('injects the memory-capture-guidance layer for a normal agent step', async () => {
    const assembleSpy = vi.fn<AssembleSpy>(async (ctx) =>
      ctx.baseLayers
        .map((l) => l.content)
        .filter(Boolean)
        .join('\n'),
    );
    const support = makeSupportMock(assembleSpy);

    await buildAgentSystemPrompt(makeBaseParams({ support }));

    const baseLayers = assembleSpy.mock.calls[0][0].baseLayers as Array<{
      id: string;
      content: string;
    }>;
    const captureLayer = baseLayers.find(
      (l) => l.id === 'memory-capture-guidance',
    );
    expect(captureLayer).toBeDefined();
    expect(captureLayer?.content).toBe(MEMORY_CAPTURE_GUIDANCE);
    // Independent literal assertion so the test fails if the const is corrupted.
    expect(captureLayer?.content).toContain('Memory capture');
    expect(captureLayer?.content).toContain('`remember`');
  });

  it('omits the memory-capture-guidance layer when suppressMemoryCapture is true', async () => {
    const assembleSpy = vi.fn<AssembleSpy>(async (ctx) =>
      ctx.baseLayers
        .map((l) => l.content)
        .filter(Boolean)
        .join('\n'),
    );
    const support = makeSupportMock(assembleSpy);

    await buildAgentSystemPrompt(
      makeBaseParams({ support, suppressMemoryCapture: true }),
    );

    const baseLayers = assembleSpy.mock.calls[0][0].baseLayers as Array<{
      id: string;
    }>;
    expect(baseLayers.map((l) => l.id)).not.toContain(
      'memory-capture-guidance',
    );
  });
});

// ---------------------------------------------------------------------------
// Characterization tests — pin step-path system prompt before consolidation
// ---------------------------------------------------------------------------
// These tests document CURRENT behavior and serve as the regression oracle for
// Phase 1 of the step/subagent prompt consolidation plan.  They must pass
// immediately — they are green baselines, not red TDD starters.
//
// Coverage:
//   1. Full assembled-string shape: layer order, skill (native, inline),
//      promoted-learning, runtime-context bullets, memory-capture-guidance,
//      and a simulated ## Todo List contributor block.
//   2. PromptAssemblyContext fields forwarded to assembleAgentSystemPrompt.
//   3. baseLayers array: IDs present, IDs absent (empty-filtered), canonical order.
// ---------------------------------------------------------------------------

describe('buildAgentSystemPrompt — golden output (characterization)', () => {
  const PROMOTED_LESSON_FIXTURE = [
    '## Prior promoted lessons',
    '',
    'The following lessons were promoted from prior workflows in this scope.',
    '',
    '1. Always validate inputs before processing. (confidence: 0.90)',
  ].join('\n');

  /** Simulates the ## Todo List block that TodoPromptContributor appends. */
  const TODO_BLOCK_FIXTURE = [
    '## Todo List',
    '',
    'Use the `manage_todo_list` tool to plan and track your work.',
    '',
    '*(No todos yet.)*',
  ].join('\n');

  it('assembles the full prompt in the canonical layer order with all key sections present', async () => {
    const assembleSpy = vi.fn(async (ctx: PromptAssemblyContext) => {
      // Simulate SystemPromptAssemblyService: join baseLayers then append
      // a contributor block (TodoPromptContributor → ## Todo List).
      const baseSection = ctx.baseLayers
        .map((l) => l.content)
        .filter(Boolean)
        .join('\n\n');
      return [baseSection, TODO_BLOCK_FIXTURE].filter(Boolean).join('\n\n');
    });

    const support = {
      buildUpstreamContextForJob: vi.fn(async () => ''),
      buildRunningWorkflowsContext: vi.fn(async () => ''),
      buildPromotedLearningContext: vi.fn(async () => PROMOTED_LESSON_FIXTURE),
      assembleAgentSystemPrompt: assembleSpy,
    } as never;

    const result = await buildAgentSystemPrompt({
      support,
      data: {
        workflowRunId: 'run-golden-01',
        job: { id: 'job-golden-01', inputs: {} },
      } as never,
      step: {
        id: 'step-golden-01',
        prompt: 'Implement the authentication feature.',
      },
      stateVariables: {
        trigger: {
          context: {
            scopeId: 'scope-abc-123',
          },
        },
      },
      resolvedSystemPrompt:
        'You are a coding agent specialising in TypeScript. Be precise.',
      assignedSkills: [
        {
          id: 'skill-tdd',
          name: 'test-driven-development',
          description: 'TDD workflow for feature implementation.',
          skillMarkdown:
            '# TDD\n\nWrite failing tests first, then make them pass.',
        } as never,
      ],
      skillDiscoveryMode: 'native',
      agentProfile: 'coder',
    });

    // Runtime context bullets
    expect(result).toContain('Workflow runtime context:');
    expect(result).toContain('- workflowRunId: run-golden-01');
    expect(result).toContain('- jobId: job-golden-01');
    expect(result).toContain('- stepId: step-golden-01');
    expect(result).toContain('- scopeId: scope-abc-123');

    // Promoted lesson
    expect(result).toContain('## Prior promoted lessons');
    expect(result).toContain('Always validate inputs before processing.');

    // Resolved system prompt (profile prompt)
    expect(result).toContain(
      'You are a coding agent specialising in TypeScript. Be precise.',
    );

    // Native mode: full skill content injected inline
    expect(result).toContain('<skill name="test-driven-development">');
    expect(result).toContain('Write failing tests first, then make them pass.');
    expect(result).not.toContain('read_skill_manifest');

    // Memory-capture guidance
    expect(result).toContain('Memory capture');
    expect(result).toContain('`remember`');
    expect(result).toContain(MEMORY_CAPTURE_GUIDANCE);

    // Contributor block (simulates TodoPromptContributor)
    expect(result).toContain('## Todo List');

    // Canonical layer order:
    //   runtime < promoted-learning < resolved < skill < memory-capture < todo-contributor
    const runtimePos = result.indexOf('Workflow runtime context:');
    const promotedPos = result.indexOf('## Prior promoted lessons');
    const resolvedPos = result.indexOf(
      'You are a coding agent specialising in TypeScript.',
    );
    const skillPos = result.indexOf('<skill name="test-driven-development">');
    const memoryCapturePos = result.indexOf('## Memory capture');
    const todoPos = result.indexOf('## Todo List');

    expect(runtimePos).toBeLessThan(promotedPos);
    expect(promotedPos).toBeLessThan(resolvedPos);
    expect(resolvedPos).toBeLessThan(skillPos);
    expect(skillPos).toBeLessThan(memoryCapturePos);
    expect(memoryCapturePos).toBeLessThan(todoPos);
  });

  it('forwards the correct PromptAssemblyContext fields to assembleAgentSystemPrompt', async () => {
    const assembleSpy = vi.fn(
      async (_ctx: PromptAssemblyContext) => 'ASSEMBLED',
    );

    const support = {
      buildUpstreamContextForJob: vi.fn(async () => ''),
      buildRunningWorkflowsContext: vi.fn(async () => ''),
      buildPromotedLearningContext: vi.fn(async () => ''),
      assembleAgentSystemPrompt: assembleSpy,
    } as never;

    await buildAgentSystemPrompt({
      support,
      data: {
        workflowRunId: 'run-ctx-01',
        job: { id: 'job-ctx-01', inputs: {} },
      } as never,
      step: { id: 'step-ctx-01', prompt: '' },
      stateVariables: {
        trigger: {
          context: {
            scopeId: 'scope-ctx',
            contextId: 'ctx-id-001',
            contextType: 'project',
          },
        },
      },
      resolvedSystemPrompt: 'Agent prompt.',
      agentProfile: 'implementer',
      harnessId: 'pi',
    });

    expect(assembleSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runType: 'workflow',
        workflowRunId: 'run-ctx-01',
        jobId: 'job-ctx-01',
        stepId: 'step-ctx-01',
        scopeId: 'scope-ctx',
        contextId: 'ctx-id-001',
        contextType: 'project',
        agentProfileId: 'implementer',
        harnessId: 'pi',
      }),
    );
  });

  it('baseLayers array has correct IDs in canonical order (empty layers filtered out)', async () => {
    const assembleSpy = vi.fn(async (ctx: PromptAssemblyContext) =>
      ctx.baseLayers
        .map((l) => l.content)
        .filter(Boolean)
        .join('\n'),
    );

    const support = {
      buildUpstreamContextForJob: vi.fn(async () => ''),
      buildRunningWorkflowsContext: vi.fn(async () => ''),
      buildPromotedLearningContext: vi.fn(async () => PROMOTED_LESSON_FIXTURE),
      assembleAgentSystemPrompt: assembleSpy,
    } as never;

    await buildAgentSystemPrompt({
      support,
      data: {
        workflowRunId: 'run-layers',
        job: { id: 'job-layers', inputs: {} },
      } as never,
      step: { id: 'step-layers', prompt: 'Do the thing.' },
      stateVariables: {
        trigger: { context: { scopeId: 'scope-layers' } },
      },
      resolvedSystemPrompt: 'Base prompt.',
      assignedSkills: [
        {
          id: 'skill-abc',
          name: 'debugging',
          description: 'Debug systematically.',
          skillMarkdown: '# Debugging\n\nIsolate the root cause.',
        } as never,
      ],
      skillDiscoveryMode: 'native',
    });

    const baseLayers = assembleSpy.mock.calls[0][0].baseLayers as Array<{
      id: string;
      content: string;
    }>;
    const layerIds = baseLayers.map((l) => l.id);

    // Empty layers are filtered out before assembly
    expect(layerIds).not.toContain('upstream');
    expect(layerIds).not.toContain('strategic-intent');
    expect(layerIds).not.toContain('running-workflows');

    // Non-empty layers are present
    expect(layerIds).toContain('runtime');
    expect(layerIds).toContain('promoted-learning');
    expect(layerIds).toContain('resolved');
    expect(layerIds).toContain('skill');
    expect(layerIds).toContain('memory-capture-guidance');
    expect(layerIds).toContain('memory-retrieval-guidance');

    // Canonical order: runtime → promoted-learning → resolved → skill → memory-capture-guidance → memory-retrieval-guidance
    const idxRuntime = layerIds.indexOf('runtime');
    const idxPromoted = layerIds.indexOf('promoted-learning');
    const idxResolved = layerIds.indexOf('resolved');
    const idxSkill = layerIds.indexOf('skill');
    const idxMemory = layerIds.indexOf('memory-capture-guidance');
    const idxRetrieval = layerIds.indexOf('memory-retrieval-guidance');

    expect(idxRuntime).toBeLessThan(idxPromoted);
    expect(idxPromoted).toBeLessThan(idxResolved);
    expect(idxResolved).toBeLessThan(idxSkill);
    expect(idxSkill).toBeLessThan(idxMemory);
    expect(idxMemory).toBeLessThan(idxRetrieval);
  });
});
