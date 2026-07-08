import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SKILL_DISCOVERY_MODE } from '@nexus/core';
import { buildUniversalPromptLayers } from './universal-prompt-layers.helpers';
import {
  MEMORY_CAPTURE_GUIDANCE,
  MEMORY_RETRIEVAL_GUIDANCE,
} from '../workflow-step-execution/step-support-memory-capture.helpers';
import type { UniversalPromptContext } from './universal-prompt-context.types';

const PROMOTED_LESSON_FIXTURE = [
  '## Prior promoted lessons',
  '',
  'Always validate inputs.',
].join('\n');

function makeSupportMock(opts?: {
  promotedLearningContent?: string;
}): UniversalPromptContext['support'] {
  return {
    buildPromotedLearningContext: vi.fn(
      async () => opts?.promotedLearningContent ?? '',
    ),
    assembleAgentSystemPrompt: vi.fn(async () => 'ASSEMBLED'),
  };
}

function makeCtx(
  overrides?: Partial<UniversalPromptContext>,
): UniversalPromptContext {
  return {
    support: makeSupportMock(),
    workflowRunId: 'run-test-1',
    jobId: 'job-test-1',
    stepId: 'step-test-1',
    resolvedSystemPrompt: 'You are an agent.',
    skillDiscoveryMode: DEFAULT_SKILL_DISCOVERY_MODE,
    suppressMemoryCapture: false,
    runType: 'workflow',
    ...overrides,
  };
}

describe('buildUniversalPromptLayers', () => {
  it('returns runtime, promoted-learning, resolved, skill, memory-capture-guidance, and memory-retrieval-guidance layers when all content is present', async () => {
    const support = makeSupportMock({
      promotedLearningContent: PROMOTED_LESSON_FIXTURE,
    });
    const ctx = makeCtx({
      support,
      assignedSkills: [
        {
          id: 'skill-abc',
          name: 'debugging',
          description: 'Debug systematically.',
          skillMarkdown: '# Debugging\n\nIsolate the root cause.',
        },
      ],
      skillDiscoveryMode: 'native',
      suppressMemoryCapture: false,
    });

    const layers = await buildUniversalPromptLayers(ctx);
    const ids = layers.map((l) => l.id);

    expect(ids).toContain('runtime');
    expect(ids).toContain('promoted-learning');
    expect(ids).toContain('resolved');
    expect(ids).toContain('skill');
    expect(ids).toContain('memory-capture-guidance');
    expect(ids).toContain('memory-retrieval-guidance');

    // Validate content shapes
    const memoryLayer = layers.find((l) => l.id === 'memory-capture-guidance');
    expect(memoryLayer?.content).toBe(MEMORY_CAPTURE_GUIDANCE);
    expect(memoryLayer?.content).toContain(
      'Memory capture — call `remember` during your work',
    );
    expect(memoryLayer?.content).toContain('Call `remember` immediately');

    const retrievalLayer = layers.find(
      (l) => l.id === 'memory-retrieval-guidance',
    );
    expect(retrievalLayer?.content).toBe(MEMORY_RETRIEVAL_GUIDANCE);
    expect(retrievalLayer?.content).toContain(
      'Memory retrieval — call `query_memory` before making assumptions',
    );

    const runtimeLayer = layers.find((l) => l.id === 'runtime');
    expect(runtimeLayer?.content).toContain('Workflow runtime context:');
    expect(runtimeLayer?.content).toContain('- workflowRunId: run-test-1');
  });

  it('omits memory-capture-guidance when suppressMemoryCapture is true', async () => {
    const support = makeSupportMock({
      promotedLearningContent: PROMOTED_LESSON_FIXTURE,
    });
    const ctx = makeCtx({
      support,
      assignedSkills: [
        {
          id: 'skill-abc',
          name: 'debugging',
          description: 'Debug systematically.',
          skillMarkdown: '# Debugging\n\nIsolate the root cause.',
        },
      ],
      skillDiscoveryMode: 'native',
      suppressMemoryCapture: true,
    });

    const layers = await buildUniversalPromptLayers(ctx);
    const ids = layers.map((l) => l.id);

    expect(ids).not.toContain('memory-capture-guidance');
    // Other universal layers still present
    expect(ids).toContain('runtime');
    expect(ids).toContain('resolved');
  });

  it('forwards entityType and entityId to buildPromotedLearningContext via stateVariables', async () => {
    const support = makeSupportMock({ promotedLearningContent: '' });
    const ctx = makeCtx({
      support,
      scopeId: 'scope-xyz',
      entityType: 'project',
      entityId: 'project-1',
    });

    await buildUniversalPromptLayers(ctx);

    expect(support.buildPromotedLearningContext).toHaveBeenCalledWith(
      expect.objectContaining({
        stateVariables: {
          trigger: {
            context: expect.objectContaining({
              entityType: 'project',
              entityId: 'project-1',
            }),
          },
        },
      }),
    );
  });

  it('forwards the agent profile as agentProfileName to buildPromotedLearningContext (Epic C)', async () => {
    const support = {
      buildPromotedLearningContext: vi.fn(async () => ''),
      assembleAgentSystemPrompt: vi.fn(async () => ''),
    };

    await buildUniversalPromptLayers({
      support,
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'step-1',
      resolvedSystemPrompt: 'base',
      skillDiscoveryMode: 'native',
      suppressMemoryCapture: false,
      agentProfile: 'implementer-agent',
      runType: 'workflow',
    });

    expect(support.buildPromotedLearningContext).toHaveBeenCalledWith(
      expect.objectContaining({ agentProfileName: 'implementer-agent' }),
    );
  });

  it('forwards workflowName to buildPromotedLearningContext when present on ctx (FU-8)', async () => {
    const support = {
      buildPromotedLearningContext: vi.fn(async () => ''),
      assembleAgentSystemPrompt: vi.fn(async () => ''),
    };

    await buildUniversalPromptLayers({
      support,
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'step-1',
      resolvedSystemPrompt: 'base',
      skillDiscoveryMode: 'native',
      suppressMemoryCapture: false,
      agentProfile: 'implementer-agent',
      workflowName: 'implementation_pipeline',
      runType: 'subagent',
    });

    expect(support.buildPromotedLearningContext).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: 'implementation_pipeline' }),
    );
  });

  it('omits workflowName from buildPromotedLearningContext params when absent on ctx', async () => {
    const support = {
      buildPromotedLearningContext: vi.fn(async () => ''),
      assembleAgentSystemPrompt: vi.fn(async () => ''),
    };

    await buildUniversalPromptLayers({
      support,
      workflowRunId: 'run-1',
      jobId: 'job-1',
      stepId: 'step-1',
      resolvedSystemPrompt: 'base',
      skillDiscoveryMode: 'native',
      suppressMemoryCapture: false,
      runType: 'workflow',
    });

    const callArgs = support.buildPromotedLearningContext.mock.calls[0][0] as {
      workflowName?: string;
    };
    expect(callArgs.workflowName).toBeUndefined();
  });

  it('filters out empty-content layers', async () => {
    const support = makeSupportMock({ promotedLearningContent: '' });
    const ctx = makeCtx({
      support,
      skillDiscoveryMode: 'native',
      assignedSkills: [], // no skills → empty skill section
    });

    const layers = await buildUniversalPromptLayers(ctx);
    const ids = layers.map((l) => l.id);

    // promoted-learning is absent (empty content)
    expect(ids).not.toContain('promoted-learning');
    // skill is absent (no assigned skills)
    expect(ids).not.toContain('skill');
    // runtime and resolved are present (always non-empty)
    expect(ids).toContain('runtime');
    expect(ids).toContain('resolved');
  });
});
