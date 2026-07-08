import { describe, expect, it, vi } from 'vitest';
import {
  filterSearchSkillForMode,
  resolveSubagentSkillDiscoveryMode,
} from './subagent-orchestrator.skills.helpers';
import { buildSubagentSystemPrompt } from './subagent-orchestrator.container-config.operations';
import type { SubagentContainerConfigContext } from './subagent-orchestrator.operations.types';

const MEMORY_CAPTURE_HEADING =
  'Memory capture — call `remember` during your work';

describe('resolveSubagentSkillDiscoveryMode', () => {
  it('defaults to native when the profile has no mode', () => {
    expect(resolveSubagentSkillDiscoveryMode(null)).toBe('native');
    expect(resolveSubagentSkillDiscoveryMode(undefined)).toBe('native');
  });
  it('uses the profile mode when set', () => {
    expect(resolveSubagentSkillDiscoveryMode('search')).toBe('search');
    expect(resolveSubagentSkillDiscoveryMode('native')).toBe('native');
  });
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeMinimalSupportMock() {
  return {
    buildPromotedLearningContext: vi.fn().mockResolvedValue(''),
    assembleAgentSystemPrompt: vi
      .fn()
      .mockImplementation(
        async (ctx: { baseLayers: Array<{ id: string; content: string }> }) =>
          ctx.baseLayers
            .map((l) => l.content)
            .filter(Boolean)
            .join('\n\n'),
      ),
  };
}

function makeMinimalContext(
  overrides: Partial<SubagentContainerConfigContext> = {},
): SubagentContainerConfigContext {
  return {
    support: makeMinimalSupportMock(),
    aiConfig: {
      listSkillCategories: vi.fn(() => ['testing', 'refactoring']),
    } as never,
    jwtSecret: 'test-secret',
    runnerConfigStore: {} as never,
    toolMounting: {} as never,
    registry: {} as never,
    scopedDefaults: {} as never,
    resolver: {} as never,
    imageResolver: {} as never,
    cacheService: {} as never,
    workflowRepo: { findById: vi.fn().mockResolvedValue(null) },
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

function makeMinimalSpawnParams(overrides: Record<string, unknown> = {}) {
  return {
    agent_profile: 'test-agent',
    task_prompt: 'Do the task.',
    tools: [],
    tier: 'heavy' as const,
    workflowRunId: 'run-test-1',
    ...overrides,
  };
}

describe('buildSubagentSystemPrompt', () => {
  it('injects full skill content into subagent prompt in native mode', async () => {
    const context = makeMinimalContext();
    const prompt = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-1',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams(),
        assignedSkills: [
          {
            name: 'coding-standards',
            description: 'SOLID',
            skillMarkdown: 'Apply SOLID and DRY.',
          },
        ],
      },
      'BASE',
      'native',
      'pi',
    );
    expect(prompt).toContain('<skill name="coding-standards">');
    expect(prompt).toContain('Apply SOLID and DRY.');
  });

  it('search mode with pi harness produces no injected skill content and no skill section', async () => {
    const context = makeMinimalContext();
    const prompt = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-1',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams(),
        assignedSkills: [
          {
            name: 'coding-standards',
            description: 'SOLID',
            skillMarkdown: 'Apply SOLID and DRY.',
          },
        ],
      },
      'BASE',
      'search',
      'pi',
    );
    expect(prompt).toContain('BASE');
    expect(prompt).not.toContain('<skill');
    expect(prompt).not.toContain('search_skills');
  });
});

describe('filterSearchSkillForMode', () => {
  it('removes search_skills in native mode but keeps read_skill_manifest', () => {
    const result = filterSearchSkillForMode(
      ['read', 'search_skills', 'read_skill_manifest'],
      'native',
    );
    expect(result).not.toContain('search_skills');
    expect(result).toContain('read_skill_manifest');
    expect(result).toContain('read');
  });

  it('leaves tools untouched in search mode', () => {
    const tools = ['read', 'search_skills', 'read_skill_manifest'];
    expect(filterSearchSkillForMode(tools, 'search')).toEqual(tools);
  });
});

// ---------------------------------------------------------------------------
// Characterization tests — pin subagent-path system prompt AFTER consolidation
// ---------------------------------------------------------------------------
// These tests document the EXPECTED behavior after Phase 1 of the
// step/subagent prompt consolidation: the subagent prompt now includes the
// same universal layers as the step path (memory-capture-guidance,
// runtime/scope context, promoted-learning when available).
//
// Updated from the original "thin" characterization (Task 0.2) to assert the
// rich, post-consolidation output.  The diff between old not.toContain and
// new toContain assertions is the proof that subagents gained the universal
// layers (EPIC-212 Pillar A fix).
// ---------------------------------------------------------------------------

describe('buildSubagentSystemPrompt — golden output (characterization)', () => {
  const BASE_PROMPT =
    'You are a subagent. Complete the task assigned to you precisely.';

  const TDD_SKILL = {
    name: 'test-driven-development',
    description: 'TDD workflow for feature implementation.',
    skillMarkdown:
      '# TDD\n\nWrite failing tests first, then make them pass.\n\nAlways follow the Red-Green-Refactor cycle.',
  };

  it('native mode — output contains universal layers (memory-capture-guidance, runtime context)', async () => {
    const context = makeMinimalContext();
    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-1',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-1',
          task_prompt: 'Implement TDD feature.',
        }),
        assignedSkills: [TDD_SKILL],
        scopeNodeId: 'scope-char-1',
      },
      BASE_PROMPT,
      'native',
      'pi',
    );

    // Base prompt is present
    expect(result).toContain(BASE_PROMPT);

    // Inline skill content is injected
    expect(result).toContain('<skill name="test-driven-development">');
    expect(result).toContain('Write failing tests first, then make them pass.');
    expect(result).toContain(
      'Assigned skills — full instructions are included inline below.',
    );

    // Universal layers are NOW PRESENT (consolidated subagent path)
    expect(result).toContain(MEMORY_CAPTURE_HEADING);
    expect(result).toContain('Workflow runtime context:');
    expect(result).toContain('workflowRunId:');
    expect(result).toContain('scopeId:');
  });

  it('native mode — output contains memory-capture-guidance even when no skills assigned', async () => {
    const context = makeMinimalContext();
    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-2',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-2',
        }),
        assignedSkills: [],
      },
      BASE_PROMPT,
      'native',
      'pi',
    );

    // Base prompt is present
    expect(result).toContain(BASE_PROMPT);

    // Memory-capture-guidance is injected even without skills
    expect(result).toContain(MEMORY_CAPTURE_HEADING);
    expect(result).toContain('Workflow runtime context:');
  });

  it('search mode + pi harness — still contains universal layers (only skill section absent)', async () => {
    const context = makeMinimalContext();
    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-3',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-3',
        }),
        assignedSkills: [TDD_SKILL],
      },
      BASE_PROMPT,
      'search',
      'pi',
    );

    expect(result).toContain(BASE_PROMPT);

    // Skill content is absent (pi harness early-return in search mode)
    expect(result).not.toContain('<skill');
    expect(result).not.toContain('search_skills');

    // Universal layers are NOW PRESENT
    expect(result).toContain(MEMORY_CAPTURE_HEADING);
    expect(result).toContain('Workflow runtime context:');
  });

  it('search mode + claude-code harness — still contains universal layers', async () => {
    const context = makeMinimalContext();
    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-4',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-4',
        }),
        assignedSkills: [TDD_SKILL],
      },
      BASE_PROMPT,
      'search',
      'claude-code',
    );

    expect(result).toContain(BASE_PROMPT);

    // Skill content is absent (claude-code harness early-return in search mode)
    expect(result).not.toContain('<skill');

    // Universal layers are NOW PRESENT
    expect(result).toContain(MEMORY_CAPTURE_HEADING);
    expect(result).toContain('Workflow runtime context:');
  });

  it('memory capture is suppressed for sweep/CEO workflows', async () => {
    const context = makeMinimalContext();
    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-5',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-5',
        }),
        assignedSkills: [],
        workflowId: 'memory_learning_sweep',
      },
      BASE_PROMPT,
      'native',
      'pi',
    );

    expect(result).toContain(BASE_PROMPT);
    // Suppressed when workflowId is a sweep/CEO workflow
    expect(result).not.toContain(MEMORY_CAPTURE_HEADING);
    // Runtime context is still present
    expect(result).toContain('Workflow runtime context:');
  });

  it('search mode + non-pi harness — output contains base, skill discovery, and universal layers', async () => {
    const mockAiConfig = {
      listSkillCategories: vi.fn((_names?: string[]) => [
        'testing',
        'refactoring',
      ]),
    };
    const context = makeMinimalContext({ aiConfig: mockAiConfig as never });

    const result = await buildSubagentSystemPrompt(
      context,
      {
        executionId: 'exec-char-6',
        parentContainerId: 'parent-1',
        spawnParams: makeMinimalSpawnParams({
          workflowRunId: 'run-char-6',
        }),
        assignedSkills: [TDD_SKILL],
      },
      BASE_PROMPT,
      'search',
      'custom-harness',
    );

    // Base prompt is present
    expect(result).toContain(BASE_PROMPT);

    // Skill discovery section is emitted (not inline injection)
    expect(result).toContain('search_skills');
    expect(result).not.toContain('<skill name=');

    // Universal layers are NOW PRESENT
    expect(result).toContain(MEMORY_CAPTURE_HEADING);
    expect(result).toContain('Workflow runtime context:');
  });
});
