import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LearningRouterService } from './learning-router.service';
import { decideGovernance } from './promotion-governance-policy.service';
import {
  GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR,
  GOVERNANCE_SETTING_DEFAULTS,
} from './governance.settings.constants';
import type { ICandidateSimilarity } from '../signals/candidate-similarity.interface';
import type { TemplateNoiseClassifier } from '../signals/template-noise.classifier';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { SkillService } from '../../ai-config/services/skill.service';
import type { LearningCandidate } from '../database/entities/learning-candidate.entity';

function makeCandidate(
  overrides: Partial<LearningCandidate> = {},
): LearningCandidate {
  return {
    id: 'cand-1',
    scope_type: 'project',
    scopeId: 'scope-1',
    candidate_type: 'retrospective',
    title: 'Lesson title',
    summary: 'A useful lesson about configuring the deployment pipeline.',
    fingerprint: 'fp-1',
    signals_json: {},
    score: 0.6,
    confidence: 0.6,
    recurrence_count: 1,
    stage_diversity_count: 1,
    failure_reduction_relevance: 0,
    recency_decay: 1,
    source_quality_confidence: 0.6,
    status: 'pending',
    diagnostics_json: null,
    promoted_memory_segment_id: null,
    promoted_at: null,
    human_approved_at: null,
    routing_target: null,
    first_seen_at: new Date(),
    last_seen_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('LearningRouterService', () => {
  let similarity: {
    findNearest: ReturnType<typeof vi.fn>;
    findRawSimilarNeighbors: ReturnType<typeof vi.fn>;
  };
  let templateNoise: { classify: ReturnType<typeof vi.fn> };
  let settings: { get: ReturnType<typeof vi.fn> };
  let skills: { list: ReturnType<typeof vi.fn> };
  let service: LearningRouterService;

  beforeEach(() => {
    similarity = {
      findNearest: vi.fn().mockResolvedValue([]),
      findRawSimilarNeighbors: vi.fn().mockResolvedValue([]),
    };
    templateNoise = {
      classify: vi
        .fn()
        .mockReturnValue({ isTemplate: false, isLowSignal: false }),
    };
    // Resolve every setting to its supplied default (globalMinScopes = 3).
    settings = {
      get: vi.fn((_key: string, def: number) => Promise.resolve(def)),
    };
    skills = { list: vi.fn().mockResolvedValue([]) };
    service = new LearningRouterService(
      similarity as unknown as ICandidateSimilarity,
      templateNoise as unknown as TemplateNoiseClassifier,
      settings as unknown as SystemSettingsService,
      skills as unknown as SkillService,
    );
  });

  it('routes a lesson recurring across ≥3 scopes to global', async () => {
    const candidate = makeCandidate({
      signals_json: { distinct_scope_count: 3 },
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('global');
    expect(decision.scopeType).toBe('global');
    expect(decision.scopeId).toBeNull();
  });

  it('routes a single-scope fact to project', async () => {
    const decision = await service.route(makeCandidate());

    expect(decision.target).toBe('project');
    expect(decision.scopeType).toBe('project');
    expect(decision.scopeId).toBe('scope-1');
  });

  it('routes a credential fact to project (pinned), never global, with no secret in signals', async () => {
    const candidate = makeCandidate({
      // Even with cross-scope recurrence, the credential rail forces project.
      signals_json: { distinct_scope_count: 9 },
      title: 'DB access',
      summary: 'The production database password is hunter2-supersecret.',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('project');
    expect(decision.target).not.toBe('global');
    expect(decision.signals.pinned).toBe(true);
    expect(decision.signals.credential).toBe(true);
    // The secret VALUE must never enter the routing signals.
    expect(JSON.stringify(decision.signals)).not.toContain('hunter2');
  });

  it('routes a behavioural always/never on one profile to agent_preference', async () => {
    const candidate = makeCandidate({
      title: 'Behaviour',
      summary: 'Always call set_job_output before ending the turn.',
      signals_json: { provenance: { agentProfileName: 'junior_dev' } },
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('agent_preference');
    expect(decision.scopeType).toBe('agent');
    expect(decision.scopeId).toBe('junior_dev');
    expect(decision.signals.agentProfile).toBe('junior_dev');
  });

  it('routes a plain agent-scoped capture to agent_preference (PD-3), preserving agent identity', async () => {
    const candidate = makeCandidate({
      scope_type: 'agent',
      scopeId: 'merge-agent',
      title: 'Merge tip',
      summary: 'Rebase onto main before opening the PR.',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('agent_preference');
    expect(decision.scopeType).toBe('agent');
    expect(decision.scopeId).toBe('merge-agent');
  });

  it('still routes a behavioural agent-scoped capture to agent_preference (no regression, PD-3)', async () => {
    const candidate = makeCandidate({
      scope_type: 'agent',
      scopeId: 'junior_dev',
      title: 'Behaviour',
      summary: 'Always call set_job_output before ending the turn.',
      signals_json: { provenance: { agentProfileName: 'junior_dev' } },
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('agent_preference');
    expect(decision.scopeType).toBe('agent');
    expect(decision.scopeId).toBe('junior_dev');
  });

  it('governs a 0.6-confidence agent-scoped capture at the 0.8 agent_preference floor, not the 0.5 project floor (PD-3 regression)', async () => {
    const candidate = makeCandidate({
      scope_type: 'agent',
      scopeId: 'merge-agent',
      title: 'Merge tip',
      summary: 'Rebase onto main before opening the PR.',
      confidence: 0.6,
    });

    const decision = await service.route(candidate);
    expect(decision.target).toBe('agent_preference');

    const thresholds = {
      promotionFloor: GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR,
      agentPreferenceMinConfidence:
        GOVERNANCE_SETTING_DEFAULTS.agentPreferenceMinConfidence,
      probationDays: GOVERNANCE_SETTING_DEFAULTS.probationDays,
    };
    const nowMs = Date.now();

    // Before PD-3 this candidate would have routed to `project` and cleared
    // the lenient 0.5 floor (auto-promoted). Now it must be held for
    // governance at the stricter 0.8 `agent_preference` floor.
    const agentGovernance = decideGovernance(
      { routingTarget: decision.target, confidence: candidate.confidence },
      thresholds,
      nowMs,
    );
    expect(agentGovernance.autoPromote).toBe(false);
    expect(agentGovernance.requiresProposal).toBe(true);

    const projectGovernance = decideGovernance(
      { routingTarget: 'project', confidence: candidate.confidence },
      thresholds,
      nowMs,
    );
    expect(projectGovernance.autoPromote).toBe(true);
  });

  it('routes a reusable multi-step procedure with no near-match to skill_new', async () => {
    skills.list.mockResolvedValue([
      { id: 's1', name: 'unrelated-skill', description: 'something else' },
    ]);
    similarity.findRawSimilarNeighbors.mockResolvedValue([
      { ownerType: 'skill', ownerId: 's1', score: 0.2 },
    ]);
    const candidate = makeCandidate({
      title: 'Procedure',
      summary:
        'To recover the build: 1. run npm ci 2. run npm run build 3. run npm test',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('skill_new');
    expect(decision.scopeType).toBe('skill');
  });

  it('routes a procedure matching an existing skill to skill_patch', async () => {
    skills.list.mockResolvedValue([
      { id: 's1', name: 'build-recovery', description: 'recover the build' },
    ]);
    similarity.findRawSimilarNeighbors.mockResolvedValue([
      { ownerType: 'skill', ownerId: 's1', score: 0.92 },
    ]);
    const candidate = makeCandidate({
      title: 'Procedure',
      summary:
        'To recover the build: 1. run npm ci 2. run npm run build 3. run npm test',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('skill_patch');
    expect(decision.signals.skillMatchScore).toBeGreaterThanOrEqual(0.9);
  });

  it('routes a templated / low-signal row to drop', async () => {
    templateNoise.classify.mockReturnValue({
      isTemplate: true,
      isLowSignal: true,
    });

    const decision = await service.route(makeCandidate());

    expect(decision.target).toBe('drop');
    expect(decision.scopeType).toBe('drop');
  });

  it('breaks a low-confidence scope tie with exactly one arbitration call, defaulting safe', async () => {
    const arbitrateSpy = vi.spyOn(
      service as unknown as {
        arbitrateTie: () => Promise<string>;
      },
      'arbitrateTie',
    );
    const candidate = makeCandidate({
      signals_json: { distinct_scope_count: 2 }, // between 1 and min(3)
    });

    const decision = await service.route(candidate);

    expect(arbitrateSpy).toHaveBeenCalledTimes(1);
    expect(decision.target).toBe('project');
    expect(decision.signals.arbitrated).toBe(true);
  });

  it('falls back to project (never global) when arbitration throws', async () => {
    vi.spyOn(
      service as unknown as {
        arbitrateTie: () => Promise<string>;
      },
      'arbitrateTie',
    ).mockRejectedValue(new Error('arbitration unavailable'));
    const candidate = makeCandidate({
      signals_json: { distinct_scope_count: 2 },
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('project');
    expect(decision.target).not.toBe('global');
  });

  it('derives distinct-scope count from cluster_scopes when no explicit count', async () => {
    const candidate = makeCandidate({
      signals_json: { cluster_scopes: ['a', 'b', 'c', 'a'] }, // 3 distinct
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('global');
  });

  it('preserves a workflow-scoped candidate as target workflow (never rewritten to project)', async () => {
    const candidate = makeCandidate({
      scope_type: 'workflow',
      scopeId: 'implementation_workflow',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('workflow');
    expect(decision.scopeType).toBe('workflow');
    expect(decision.scopeId).toBe('implementation_workflow');
  });

  it('still drops templated noise even when workflow-scoped', async () => {
    templateNoise.classify.mockReturnValue({
      isTemplate: true,
      isLowSignal: true,
    });
    const candidate = makeCandidate({
      scope_type: 'workflow',
      scopeId: 'implementation_workflow',
    });

    const decision = await service.route(candidate);

    expect(decision.target).toBe('drop');
  });
});
