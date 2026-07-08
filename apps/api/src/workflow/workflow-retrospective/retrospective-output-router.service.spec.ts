/**
 * Unit tests for `RetrospectiveOutputRouter` (EPIC-212 Phase-2 Task 7).
 *
 * The router is where analyst hallucination is neutralized: it IGNORES
 * `finding.confidence_self` and RE-DERIVES confidence from the evidence class
 * (struggle-backed vs pure inference), routes `memory` findings through the
 * existing `record_learning` pipeline and `skill_proposal` findings into a
 * pending `skill_create` improvement proposal (via
 * `ImprovementProposalService.submitProposal`), and enforces the credential
 * rail (a secret VALUE never reaches the persistence layer; credential
 * findings never route global).
 *
 * Collaborators are typed mocks; no NestJS module, no real DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RetrospectiveFinding } from '@nexus/core';
import {
  RetrospectiveOutputRouter,
  deriveRetrospectiveConfidence,
  deriveSkillSlug,
} from './retrospective-output-router.service';
import type { RecordLearningService } from '../../memory/learning/record-learning.service';
import type { ImprovementProposalService } from '../../improvement/improvement-proposal.service';
import type { StruggleDetectorService } from '../../memory/signals/struggle-detector.service';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import type { StruggleSpan } from '../../memory/signals/struggle-detector.types';
import type { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';
import type { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';

const ORIGINAL_RUN_ID = 'run-original-1';
const SCOPE_ID = 'scope-1';
const STRUGGLE_CAP = 0.7;
const INFERENCE_CAP = 0.45;

interface Mocks {
  recordLearning: { recordLearning: ReturnType<typeof vi.fn> };
  improvementProposals: { submitProposal: ReturnType<typeof vi.fn> };
  struggleDetector: { detect: ReturnType<typeof vi.fn> };
  settings: { get: ReturnType<typeof vi.fn> };
  agentSkills: { skillExists: ReturnType<typeof vi.fn> };
  runRepo: { findById: ReturnType<typeof vi.fn> };
  workflowRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByIdentifier: ReturnType<typeof vi.fn>;
  };
  agentProfiles: { findByName: ReturnType<typeof vi.fn> };
}

interface MockOverrides {
  runRepo?: { findById: ReturnType<typeof vi.fn> };
  workflowRepo?: {
    findById: ReturnType<typeof vi.fn>;
    findByIdentifier?: ReturnType<typeof vi.fn>;
  };
  agentProfiles?: { findByName: ReturnType<typeof vi.fn> };
}

function buildRouter(
  overrides: MockOverrides = {},
): { router: RetrospectiveOutputRouter; mocks: Mocks } & Mocks {
  const mocks: Mocks = {
    recordLearning: { recordLearning: vi.fn().mockResolvedValue({}) },
    improvementProposals: {
      submitProposal: vi
        .fn()
        .mockResolvedValue({ outcome: 'proposed', proposal: { id: 'p-1' } }),
    },
    struggleDetector: { detect: vi.fn().mockResolvedValue([]) },
    // Settings mock returns the supplied default for every key.
    settings: { get: vi.fn(async (_key: string, def: unknown) => def) },
    // Default: the recommended skill does not already exist (skill_create path).
    agentSkills: { skillExists: vi.fn().mockReturnValue(false) },
    // Default: no workflow-name resolution needed unless a test asks for it.
    runRepo: overrides.runRepo ?? { findById: vi.fn().mockResolvedValue(null) },
    workflowRepo: {
      findById: overrides.workflowRepo?.findById ?? vi.fn(),
      findByIdentifier:
        overrides.workflowRepo?.findByIdentifier ??
        vi.fn().mockResolvedValue(null),
    },
    // Default: the target agent profile does not exist unless a test asks for it.
    agentProfiles: overrides.agentProfiles ?? {
      findByName: vi.fn().mockResolvedValue(null),
    },
  };

  const router = new RetrospectiveOutputRouter(
    mocks.recordLearning as unknown as RecordLearningService,
    mocks.improvementProposals as unknown as ImprovementProposalService,
    mocks.struggleDetector as unknown as StruggleDetectorService,
    mocks.settings as unknown as SystemSettingsService,
    mocks.agentSkills as unknown as AgentSkillsService,
    mocks.runRepo as unknown as WorkflowRunRepository,
    mocks.workflowRepo as unknown as WorkflowRepository,
    mocks.agentProfiles as unknown as AgentProfileRepository,
  );

  return { router, mocks, ...mocks };
}

function profileChangeFinding(
  overrides: Partial<RetrospectiveFinding> = {},
): RetrospectiveFinding {
  return {
    kind: 'agent_profile_change',
    lesson: 'implementation-agent needs a stricter pre-commit reminder',
    confidence_self: 0.9,
    evidence_event_ids: ['evt-1'],
    profile_change: {
      profileName: 'implementation-agent',
      patch: {
        system_prompt: {
          mode: 'append',
          value: 'Always run tests before committing.',
        },
      },
      changeSummary: 'append a test-before-commit reminder',
    },
    ...overrides,
  };
}

function workflowChangeFinding(
  overrides: Partial<RetrospectiveFinding> = {},
): RetrospectiveFinding {
  return {
    kind: 'workflow_definition_change',
    lesson: 'auto_merge_default should raise its gate timeout',
    confidence_self: 0.9,
    evidence_event_ids: ['evt-1'],
    workflow_change: {
      workflowName: 'auto_merge_default',
      proposedYaml: 'name: auto_merge_default\nsteps: []\n',
      changeSummary: [
        {
          field: 'timeout_ms',
          from: '300000',
          to: '1200000',
          rationale: 'gate suite runs ~390s',
        },
      ],
    },
    ...overrides,
  };
}

function memoryFinding(
  overrides: Partial<RetrospectiveFinding> = {},
): RetrospectiveFinding {
  return {
    kind: 'memory',
    lesson: 'Always rebuild packages/core before building the api',
    root_cause: 'stale dist',
    fix: 'run the core build first',
    confidence_self: 0.95,
    evidence_event_ids: ['evt-1', 'evt-2'],
    ...overrides,
  };
}

function span(): StruggleSpan {
  return {
    tool: 'run_command',
    failedAttempts: [{ errorCode: 'E1' }, { errorCode: 'E1' }],
    recoveringCall: { payload: { command: 'npm run build' } },
    errorCodes: ['E1'],
  };
}

describe('deriveRetrospectiveConfidence (pure)', () => {
  it('caps a pure-inference finding at the inference cap (below the 0.5 floor)', () => {
    expect(
      deriveRetrospectiveConfidence(false, STRUGGLE_CAP, INFERENCE_CAP),
    ).toBeLessThanOrEqual(INFERENCE_CAP);
    expect(
      deriveRetrospectiveConfidence(false, STRUGGLE_CAP, INFERENCE_CAP),
    ).toBe(INFERENCE_CAP);
  });

  it('caps a struggle-backed finding at the struggle cap', () => {
    expect(
      deriveRetrospectiveConfidence(true, STRUGGLE_CAP, INFERENCE_CAP),
    ).toBeLessThanOrEqual(STRUGGLE_CAP);
    expect(
      deriveRetrospectiveConfidence(true, STRUGGLE_CAP, INFERENCE_CAP),
    ).toBe(STRUGGLE_CAP);
  });
});

describe('deriveSkillSlug (pure)', () => {
  it('slugs a normal source deterministically, unchanged from before', () => {
    expect(deriveSkillSlug('Recover a Stuck Merge')).toBe(
      'recover-a-stuck-merge',
    );
    expect(deriveSkillSlug('Recover a Stuck Merge')).toBe(
      deriveSkillSlug('Recover a Stuck Merge'),
    );
  });

  it('produces different fallback slugs for two different empty/non-alnum source texts (FU-17)', () => {
    const slugA = deriveSkillSlug('');
    const slugB = deriveSkillSlug('!!!???');
    expect(slugA).not.toBe(slugB);
    expect(slugA.startsWith('retrospective-skill')).toBe(true);
    expect(slugB.startsWith('retrospective-skill')).toBe(true);
  });

  it('is deterministic for the same non-alnum source text', () => {
    expect(deriveSkillSlug('###')).toBe(deriveSkillSlug('###'));
  });
});

describe('RetrospectiveOutputRouter', () => {
  let router: RetrospectiveOutputRouter;
  let mocks: Mocks;

  beforeEach(() => {
    ({ router, mocks } = buildRouter());
  });

  it('re-derives a NON-struggle finding to <= the inference cap, ignoring confidence_self:0.95', async () => {
    mocks.struggleDetector.detect.mockResolvedValue([]);

    await expect(
      router.route({
        finding: memoryFinding({ confidence_self: 0.95 }),
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({ outcome: 'routed' });

    expect(mocks.recordLearning.recordLearning).toHaveBeenCalledTimes(1);
    const [, params, options] =
      mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.confidence).toBeLessThanOrEqual(INFERENCE_CAP);
    expect(params.confidence).toBeLessThan(0.5);
    expect(options.sourceQualityConfidence).toBeLessThanOrEqual(INFERENCE_CAP);
    expect(params.tags).toContain('inference');
  });

  it('creates retrospective learning candidates through record_learning', async () => {
    await router.route({
      finding: memoryFinding(),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params, options] =
      mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.scope_id).toBe(SCOPE_ID);
    expect(params.tags).toContain('retrospective_analyst');
    expect(options.candidateType).toBe('retrospective');
    expect(options.sourceTool).toBe('retrospective_analyst');
  });

  it('re-derives a struggle-backed finding to <= the struggle cap', async () => {
    mocks.struggleDetector.detect.mockResolvedValue([span()]);

    await router.route({
      finding: memoryFinding({ confidence_self: 0.95 }),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.confidence).toBeLessThanOrEqual(STRUGGLE_CAP);
    expect(params.confidence).toBeGreaterThan(INFERENCE_CAP);
    expect(params.tags).toContain('struggle_backed');
  });

  it('passes the original run id + synthetic job id as the record_learning context', async () => {
    await router.route({
      finding: memoryFinding(),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [context] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(context.workflowRunId).toBe(ORIGINAL_RUN_ID);
    expect(typeof context.jobId).toBe('string');
    expect(context.jobId.length).toBeGreaterThan(0);
  });

  it('builds evidence entries from the finding evidence_event_ids', async () => {
    await router.route({
      finding: memoryFinding({ evidence_event_ids: ['evt-a', 'evt-b'] }),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.evidence).toHaveLength(2);
    expect(params.evidence.map((e: { id: string }) => e.id)).toEqual([
      'evt-a',
      'evt-b',
    ]);
  });

  it('maps an agent_preference scope_hint to an agent scope', async () => {
    await router.route({
      finding: memoryFinding({ scope_hint: 'agent_preference' }),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.scope_type).toBe('agent');
  });

  it('never self-elects a global scope from an analyst global hint (routes project)', async () => {
    await router.route({
      finding: memoryFinding({ scope_hint: 'global' }),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.scope_type).toBe('project');
  });

  it('submits a skill_create improvement proposal for a skill_proposal finding (not a memory)', async () => {
    const finding: RetrospectiveFinding = {
      kind: 'skill_proposal',
      lesson: 'Recover a stuck merge by aborting then rebasing',
      working_procedure: '1. git merge --abort\n2. git rebase origin/main',
      confidence_self: 0.8,
      evidence_event_ids: ['evt-1'],
    };

    await expect(
      router.route({
        finding,
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({ outcome: 'routed' });

    expect(mocks.recordLearning.recordLearning).not.toHaveBeenCalled();
    expect(mocks.improvementProposals.submitProposal).toHaveBeenCalledTimes(1);
    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('skill_create');
    expect(draft.payload.patch_markdown).toBe(finding.working_procedure);
    expect(draft.payload.assignment_targets).toEqual([]);
    expect(typeof draft.payload.target_skill_name).toBe('string');
    expect(draft.payload.target_skill_name.length).toBeGreaterThan(0);
    // evidenceClass is derived from the run-level struggle signal (none here → inference).
    expect(draft.evidence.evidenceClass).toBe('inference');
    expect(draft.evidence.runIds).toEqual([ORIGINAL_RUN_ID]);
    expect(draft.evidence.ledgerRefs).toEqual(['evt-1']);
    // Confidence is capped below the promotion floor for a pure-inference finding.
    expect(draft.confidence).toBeLessThanOrEqual(INFERENCE_CAP);
  });

  it('maps a struggle-backed skill_proposal finding to evidenceClass=struggle_backed', async () => {
    mocks.struggleDetector.detect.mockResolvedValue([span()]);
    const finding: RetrospectiveFinding = {
      kind: 'skill_proposal',
      lesson: 'Recover a stuck merge by aborting then rebasing',
      working_procedure: '1. git merge --abort\n2. git rebase origin/main',
      confidence_self: 0.8,
      evidence_event_ids: [],
    };

    await router.route({
      finding,
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.evidence.evidenceClass).toBe('struggle_backed');
    expect(draft.confidence).toBeLessThanOrEqual(STRUGGLE_CAP);
    // No cited event ids → ledgerRefs omitted entirely.
    expect(draft.evidence.ledgerRefs).toBeUndefined();
  });

  it('submits a skill_assignment proposal (not skill_create) when the recommended skill already exists', async () => {
    mocks.agentSkills.skillExists.mockReturnValue(true);
    const finding: RetrospectiveFinding = {
      kind: 'skill_proposal',
      lesson: 'Recover a stuck merge by aborting then rebasing',
      working_procedure: '1. git merge --abort\n2. git rebase origin/main',
      confidence_self: 0.8,
      evidence_event_ids: ['evt-1'],
    };

    await router.route({
      finding,
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    expect(mocks.agentSkills.skillExists).toHaveBeenCalledWith(
      expect.any(String),
    );
    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('skill_assignment');
    expect(typeof draft.payload.skillName).toBe('string');
    expect(draft.payload.skillName.length).toBeGreaterThan(0);
    expect(draft.payload.assignment_targets).toEqual([]);
    // Never a duplicate skill_create proposal for an already-existing skill.
    expect(draft.payload.target_skill_name).toBeUndefined();
  });

  it('drops malformed assignment_targets while keeping valid ones on a skill_create proposal', async () => {
    const finding: RetrospectiveFinding = {
      kind: 'skill_proposal',
      lesson: 'Recover a stuck merge by aborting then rebasing',
      working_procedure: '1. git merge --abort\n2. git rebase origin/main',
      confidence_self: 0.8,
      evidence_event_ids: ['evt-1'],
      assignment_targets: [
        { type: 'agent_profile', profileName: 'ceo-agent' },
        { type: 'agent_profile' }, // malformed: missing profileName
        { type: 'not_a_real_type' }, // malformed: unknown type
      ],
    };

    await router.route({
      finding,
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('skill_create');
    expect(draft.payload.assignment_targets).toEqual([
      { type: 'agent_profile', profileName: 'ceo-agent' },
    ]);
  });

  it('validates assignment_targets on a skill_assignment proposal too', async () => {
    mocks.agentSkills.skillExists.mockReturnValue(true);
    const finding: RetrospectiveFinding = {
      kind: 'skill_proposal',
      lesson: 'Recover a stuck merge by aborting then rebasing',
      working_procedure: '1. git merge --abort\n2. git rebase origin/main',
      confidence_self: 0.8,
      evidence_event_ids: ['evt-1'],
      assignment_targets: [
        { type: 'workflow_step', workflowName: 'implement_and_commit' },
        { type: 'workflow_step' }, // malformed: missing workflowName
      ],
    };

    await router.route({
      finding,
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('skill_assignment');
    expect(draft.payload.assignment_targets).toEqual([
      { type: 'workflow_step', workflowName: 'implement_and_commit' },
    ]);
  });

  it('redacts a secret VALUE in the lesson and forces a project scope (credential rail)', async () => {
    await router.route({
      finding: memoryFinding({
        lesson: 'The fix was to set password=hunter2 in the config',
        scope_hint: 'global',
        fix: undefined,
        root_cause: undefined,
      }),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    expect(mocks.recordLearning.recordLearning).toHaveBeenCalledTimes(1);
    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(JSON.stringify(params)).not.toContain('hunter2');
    expect(params.lesson).not.toContain('hunter2');
    expect(params.scope_type).toBe('project');
  });

  it('is a no-op for a kind:none finding', async () => {
    await expect(
      router.route({
        finding: {
          kind: 'none',
          lesson: 'nothing durable',
          confidence_self: 0.1,
          evidence_event_ids: [],
        },
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({ outcome: 'routed' });

    expect(mocks.recordLearning.recordLearning).not.toHaveBeenCalled();
    expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
  });

  it('swallows a record_learning throw (route never rejects, reports dropped/router_error)', async () => {
    mocks.recordLearning.recordLearning.mockRejectedValue(new Error('db down'));

    await expect(
      router.route({
        finding: memoryFinding(),
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({
      outcome: 'dropped',
      reasonCode: 'router_error',
      detail: 'db down',
    });
  });

  it('treats a struggle-detection throw as pure inference (lower cap, never rejects)', async () => {
    mocks.struggleDetector.detect.mockRejectedValue(new Error('ledger down'));

    await router.route({
      finding: memoryFinding(),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [, params] = mocks.recordLearning.recordLearning.mock.calls[0];
    expect(params.confidence).toBeLessThanOrEqual(INFERENCE_CAP);
  });
});

describe('agent_profile_change routing (Epic D Task 8)', () => {
  it('submits an agent_profile_change proposal when the target profile exists', async () => {
    const { router, mocks } = buildRouter({
      agentProfiles: {
        findByName: vi
          .fn()
          .mockResolvedValue({ id: 'p1', name: 'implementation-agent' }),
      },
    });

    await expect(
      router.route({
        finding: profileChangeFinding(),
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({ outcome: 'routed' });

    expect(mocks.agentProfiles.findByName).toHaveBeenCalledWith(
      'implementation-agent',
    );
    expect(mocks.improvementProposals.submitProposal).toHaveBeenCalledTimes(1);
    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('agent_profile_change');
    expect(draft.payload.profileName).toBe('implementation-agent');
    expect(draft.payload.changeSummary).toBe(
      'append a test-before-commit reminder',
    );
    expect(draft.evidence.evidenceClass).toBe('inference');
    expect(draft.evidence.runIds).toEqual([ORIGINAL_RUN_ID]);
    expect(draft.evidence.ledgerRefs).toEqual(['evt-1']);
    expect(draft.confidence).toBeLessThanOrEqual(INFERENCE_CAP);
    expect(draft.provenance).toEqual({
      source: 'retrospective_analyst',
      original_run_id: ORIGINAL_RUN_ID,
    });
  });

  it('caps confidence at the struggle cap and marks struggle_backed evidence for a struggle-backed profile change', async () => {
    const { router, mocks } = buildRouter({
      agentProfiles: {
        findByName: vi
          .fn()
          .mockResolvedValue({ id: 'p1', name: 'implementation-agent' }),
      },
    });
    mocks.struggleDetector.detect.mockResolvedValue([span()]);

    await router.route({
      finding: profileChangeFinding(),
      scopeId: SCOPE_ID,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.confidence).toBe(STRUGGLE_CAP);
    expect(draft.evidence.evidenceClass).toBe('struggle_backed');
  });

  it('drops an agent_profile_change finding for a nonexistent profile with a reason code', async () => {
    const { router, mocks } = buildRouter();

    await expect(
      router.route({
        finding: profileChangeFinding(),
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'dropped',
        reasonCode: 'target_not_found',
      }),
    );
    expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
  });

  it('drops an agent_profile_change finding with a missing/malformed profile_change payload', async () => {
    const { router, mocks } = buildRouter();

    await expect(
      router.route({
        finding: profileChangeFinding({ profile_change: undefined }),
        scopeId: SCOPE_ID,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'dropped',
        reasonCode: 'payload_invalid',
      }),
    );
    expect(mocks.agentProfiles.findByName).not.toHaveBeenCalled();
    expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
  });
});

describe('workflow_definition_change routing (Epic D Task 8)', () => {
  it('submits a workflow_definition_change proposal when the target workflow exists', async () => {
    const { router, mocks } = buildRouter({
      workflowRepo: {
        findById: vi.fn(),
        findByIdentifier: vi
          .fn()
          .mockResolvedValue({ id: 'wf-1', name: 'auto_merge_default' }),
      },
    });

    await expect(
      router.route({
        finding: workflowChangeFinding(),
        scopeId: null,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual({ outcome: 'routed' });

    expect(mocks.workflowRepo.findByIdentifier).toHaveBeenCalledWith(
      'auto_merge_default',
      { includeInactive: true },
    );
    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.kind).toBe('workflow_definition_change');
    expect(draft.payload.workflowName).toBe('auto_merge_default');
    expect(draft.evidence.runIds).toEqual([ORIGINAL_RUN_ID]);
    expect(draft.provenance).toEqual({
      source: 'retrospective_analyst',
      original_run_id: ORIGINAL_RUN_ID,
    });
  });

  it('caps inference-only workflow_definition_change proposals at the inference cap', async () => {
    const { router, mocks } = buildRouter({
      workflowRepo: {
        findById: vi.fn(),
        findByIdentifier: vi
          .fn()
          .mockResolvedValue({ id: 'wf-1', name: 'auto_merge_default' }),
      },
    });

    await router.route({
      finding: workflowChangeFinding(),
      scopeId: null,
      originalRunId: ORIGINAL_RUN_ID,
    });

    const [draft] = mocks.improvementProposals.submitProposal.mock.calls[0];
    expect(draft.confidence).toBe(INFERENCE_CAP);
    expect(draft.evidence.evidenceClass).toBe('inference');
  });

  it('drops workflow_definition_change for a nonexistent workflow with a reason code', async () => {
    const { router, mocks } = buildRouter({
      workflowRepo: {
        findById: vi.fn(),
        findByIdentifier: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      router.route({
        finding: workflowChangeFinding(),
        scopeId: null,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'dropped',
        reasonCode: 'target_not_found',
      }),
    );
    expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
  });

  it('drops a workflow_definition_change finding with a missing/malformed workflow_change payload', async () => {
    const { router, mocks } = buildRouter();

    await expect(
      router.route({
        finding: workflowChangeFinding({ workflow_change: undefined }),
        scopeId: null,
        originalRunId: ORIGINAL_RUN_ID,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: 'dropped',
        reasonCode: 'payload_invalid',
      }),
    );
    expect(mocks.workflowRepo.findByIdentifier).not.toHaveBeenCalled();
    expect(mocks.improvementProposals.submitProposal).not.toHaveBeenCalled();
  });
});

// `makeFinding` is the `memoryFinding` factory under the name used by the
// Epic C Task 6 brief; kept as a thin alias rather than renaming the
// established helper (avoids churn in every pre-existing test above).
const makeFinding = memoryFinding;

describe("scope_hint 'workflow_specific' (Epic C)", () => {
  it("routes to workflow scope keyed by the original run's workflow definition name", async () => {
    const { router, recordLearning, runRepo } = buildRouter({
      runRepo: {
        findById: vi.fn().mockResolvedValue({ workflow_id: 'wf-uuid' }),
      },
      workflowRepo: {
        findById: vi
          .fn()
          .mockResolvedValue({ id: 'wf-uuid', name: 'auto_merge_default' }),
      },
    });

    await router.route({
      finding: makeFinding({ kind: 'memory', scope_hint: 'workflow_specific' }),
      scopeId: 'proj-1',
      originalRunId: 'run-1',
    });

    expect(runRepo.findById).toHaveBeenCalledWith('run-1');
    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope_type: 'workflow',
        scope_id: 'auto_merge_default',
      }),
      expect.anything(),
    );
  });

  it('falls back to project scope when the workflow name cannot be resolved', async () => {
    const { router, recordLearning } = buildRouter({
      runRepo: { findById: vi.fn().mockResolvedValue(null) },
      workflowRepo: { findById: vi.fn() },
    });

    await router.route({
      finding: makeFinding({ kind: 'memory', scope_hint: 'workflow_specific' }),
      scopeId: 'proj-1',
      originalRunId: 'run-1',
    });

    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: 'project', scope_id: 'proj-1' }),
      expect.anything(),
    );
  });

  it('credential rail still forces project even with a workflow_specific hint', async () => {
    const { router, recordLearning } = buildRouter({
      runRepo: { findById: vi.fn() },
      workflowRepo: { findById: vi.fn() },
    });

    await router.route({
      finding: makeFinding({
        kind: 'memory',
        scope_hint: 'workflow_specific',
        lesson: 'set DB_PASSWORD=hunter2-super-secret in the gate env',
      }),
      scopeId: 'proj-1',
      originalRunId: 'run-1',
    });

    expect(recordLearning.recordLearning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope_type: 'project' }),
      expect.anything(),
    );
  });
});
