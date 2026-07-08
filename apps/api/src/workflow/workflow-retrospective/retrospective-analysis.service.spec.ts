/**
 * Unit tests for `RetrospectiveAnalysisService` (EPIC-212 Phase-2 Task 6).
 *
 * Two halves:
 *   A. `analyze` — builds the digest + launches `run_retrospective`, threading
 *      the original run id in the launch trigger payload; returns
 *      `{status:'analyzed'}`; a launch throw → `{status:'failed'}` (no throw).
 *   B. `processFindings` — validates, verifies evidence ids, dedups against
 *      known memory, routes the novel survivors; fail-soft throughout.
 *
 * Collaborators are typed mocks; no NestJS module, no real DB / engine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RetrospectiveAnalysisService } from './retrospective-analysis.service';
import type { RunTranscriptDigestService } from './run-transcript-digest.service';
import type { ChatTranscriptDigestService } from './chat-transcript-digest.service';
import type {
  IChatSessionMemoryPort,
  IChatSessionRepositoryPort,
} from '../domain-ports';
import type { RunDigest } from './run-transcript-digest.types';
import type { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import type { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import type { ICandidateSimilarity } from '../../memory/signals/candidate-similarity.interface';
import type { SystemSettingsService } from '../../settings/system-settings.service';
import type { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import type { RetrospectiveRouterPort } from './retrospective-router.port';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import type { WorkflowRepository } from '../database/repositories/workflow.repository';
import type { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import type { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING } from './retrospective-dedup-scope.settings.constants';

// ── Mock builders ──────────────────────────────────────────────────────────────

function createDigest(): RunDigest {
  return {
    runId: 'run-1',
    scopeId: 'scope-1',
    struggleSpans: [],
    toolTimeline: [],
    errorClusters: [],
    evidenceEventIds: ['evt-real'],
    truncated: false,
  };
}

interface Mocks {
  digestService: { buildDigest: ReturnType<typeof vi.fn> };
  chatDigestService: { buildDigest: ReturnType<typeof vi.fn> };
  chatSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByWorkflowRunId: ReturnType<typeof vi.fn>;
  };
  sessionMemory: { findRecentBySession: ReturnType<typeof vi.fn> };
  engine: { startWorkflow: ReturnType<typeof vi.fn> };
  eventLedger: { query: ReturnType<typeof vi.fn> };
  eventLedgerService: { emitBestEffort: ReturnType<typeof vi.fn> };
  retrieval: { retrieve: ReturnType<typeof vi.fn> };
  settings: { get: ReturnType<typeof vi.fn> };
  queue: {
    findByRunId: ReturnType<typeof vi.fn>;
    markStatus: ReturnType<typeof vi.fn>;
  };
  similarity: {
    findNearest: ReturnType<typeof vi.fn>;
    findRawSimilarNeighbors: ReturnType<typeof vi.fn>;
  };
  router: { route: ReturnType<typeof vi.fn> };
  runs: { findById: ReturnType<typeof vi.fn> };
  workflows: { findById: ReturnType<typeof vi.fn> };
  agentProfiles: { findByName: ReturnType<typeof vi.fn> };
  executions: { findByWorkflowRun: ReturnType<typeof vi.fn> };
}

function createMocks(overrides: Partial<Mocks> = {}): Mocks {
  return {
    digestService: { buildDigest: vi.fn().mockResolvedValue(createDigest()) },
    chatDigestService: {
      buildDigest: vi.fn().mockResolvedValue(createDigest()),
    },
    chatSessionRepo: {
      findById: vi.fn().mockResolvedValue(null),
      findByWorkflowRunId: vi.fn().mockResolvedValue([]),
    },
    sessionMemory: { findRecentBySession: vi.fn().mockResolvedValue([]) },
    engine: { startWorkflow: vi.fn().mockResolvedValue('analyst-run-1') },
    eventLedger: {
      query: vi.fn().mockResolvedValue([[{ id: 'evt-real' }], 1]),
    },
    eventLedgerService: {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    },
    retrieval: { retrieve: vi.fn().mockResolvedValue([]) },
    settings: {
      get: vi.fn(async (_key: string, fallback: unknown) => fallback),
    },
    queue: {
      findByRunId: vi.fn().mockResolvedValue(null),
      markStatus: vi.fn().mockResolvedValue(undefined),
    },
    similarity: {
      findNearest: vi.fn().mockResolvedValue([]),
      findRawSimilarNeighbors: vi.fn().mockResolvedValue([]),
    },
    router: { route: vi.fn().mockResolvedValue({ outcome: 'routed' }) },
    runs: {
      findById: vi.fn().mockResolvedValue({ workflow_id: 'workflow-1' }),
    },
    workflows: {
      findById: vi.fn().mockResolvedValue({
        yaml_definition: 'workflow_id: original\n',
        name: 'original-workflow',
      }),
    },
    agentProfiles: { findByName: vi.fn().mockResolvedValue(null) },
    executions: { findByWorkflowRun: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function createService(
  mocks: Mocks,
  options: { withRouter?: boolean; withSimilarity?: boolean } = {},
): RetrospectiveAnalysisService {
  const withRouter = options.withRouter ?? true;
  const withSimilarity = options.withSimilarity ?? true;
  return new RetrospectiveAnalysisService(
    mocks.digestService as unknown as RunTranscriptDigestService,
    mocks.chatDigestService as unknown as ChatTranscriptDigestService,
    mocks.chatSessionRepo as unknown as IChatSessionRepositoryPort,
    mocks.sessionMemory as unknown as IChatSessionMemoryPort,
    mocks.engine as unknown as IWorkflowEngineService,
    mocks.eventLedger as unknown as EventLedgerRepository,
    mocks.retrieval as unknown as MemoryRetrievalService,
    mocks.settings as unknown as SystemSettingsService,
    mocks.queue as unknown as RetrospectiveQueueRepository,
    mocks.eventLedgerService as unknown as EventLedgerService,
    withSimilarity
      ? (mocks.similarity as unknown as ICandidateSimilarity)
      : null,
    withRouter ? (mocks.router as unknown as RetrospectiveRouterPort) : null,
    mocks.runs as unknown as WorkflowRunRepository,
    mocks.workflows as unknown as WorkflowRepository,
    mocks.agentProfiles as unknown as AgentProfileRepository,
    mocks.executions as unknown as ExecutionRepository,
  );
}

function queueRow(): RetrospectiveQueue {
  return {
    workflow_run_id: 'run-1',
    scope_id: 'scope-1',
  } as unknown as RetrospectiveQueue;
}

const MEMORY_FINDING = {
  kind: 'memory',
  lesson: 'Pin the lockfile before building in CI.',
  root_cause: 'stale node_modules',
  fix: 'rebuild image',
  confidence_self: 0.95,
  evidence_event_ids: ['evt-real'],
};

// ── A. analyze (dispatch) ───────────────────────────────────────────────────────

describe('RetrospectiveAnalysisService.analyze', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  it('builds the digest and launches run_retrospective with the original run id', async () => {
    const service = createService(mocks);

    const outcome = await service.analyze(queueRow());

    expect(outcome).toEqual({ status: 'analyzed' });
    expect(mocks.digestService.buildDigest).toHaveBeenCalledWith(
      'run-1',
      'scope-1',
    );
    expect(mocks.engine.startWorkflow).toHaveBeenCalledTimes(1);
    const [workflowId, triggerData] = mocks.engine.startWorkflow.mock.calls[0];
    expect(workflowId).toBe('run_retrospective');
    expect(triggerData).toMatchObject({
      workflow_run_id: 'run-1',
      scope_id: 'scope-1',
      agent_profile: 'retrospective-analyst',
    });
    expect(triggerData).not.toHaveProperty('trigger');

    const digest = (triggerData as { digest?: unknown }).digest;
    expect(typeof digest).toBe('string');
    if (typeof digest !== 'string') {
      throw new Error('Expected retrospective trigger digest to be a string');
    }
    expect(JSON.parse(digest).runId).toBe('run-1');
  });

  it('returns {status:failed} without throwing when the launch throws', async () => {
    mocks.engine.startWorkflow.mockRejectedValueOnce(new Error('engine down'));
    const service = createService(mocks);

    const outcome = await service.analyze(queueRow());

    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toContain('engine down');
  });

  it('threads the original workflow YAML into the launch when the run/workflow lookups resolve', async () => {
    const service = createService(mocks);

    await service.analyze(queueRow());

    expect(mocks.runs.findById).toHaveBeenCalledWith('run-1');
    expect(mocks.workflows.findById).toHaveBeenCalledWith('workflow-1');
    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0];
    expect(triggerData).toMatchObject({
      workflow_yaml: 'workflow_id: original\n',
    });
  });

  it('omits workflow_yaml from the launch when the run/workflow lookup throws', async () => {
    mocks.runs.findById.mockRejectedValueOnce(new Error('db unavailable'));
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.workflow_yaml).toBeUndefined();
  });

  // ── FU-16 Task A2: thread identity for the later dedup-widen call ─────────

  it('threads the resolved workflow name into the launch alongside its YAML (FU-16 identity for the completion-side dedup check)', async () => {
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.workflow_name).toBe('original-workflow');
  });

  it('omits workflow_name from the launch when the run/workflow lookup throws (fail-soft, same path as workflow_yaml)', async () => {
    mocks.runs.findById.mockRejectedValueOnce(new Error('db unavailable'));
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.workflow_name).toBeUndefined();
  });

  it('threads the first resolved acting agent profile name into the launch (FU-16 identity for the completion-side dedup check)', async () => {
    mocks.chatSessionRepo.findByWorkflowRunId.mockResolvedValueOnce([
      { agent_profile_name: 'implementer-agent' },
    ]);
    mocks.agentProfiles.findByName.mockResolvedValueOnce({
      name: 'implementer-agent',
      system_prompt: 'You implement things.',
      model_name: 'claude-opus',
      provider_name: 'anthropic',
      thinking_level: 'high',
      tool_policy: { default: 'deny', rules: [] },
      assigned_skills: null,
    });
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profile_name).toBe('implementer-agent');
  });

  it('omits acting_agent_profile_name from the launch when no acting profile resolves', async () => {
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profile_name).toBeUndefined();
  });

  it('threads the acting agent profile(s) into the launch when chat sessions resolve one', async () => {
    mocks.chatSessionRepo.findByWorkflowRunId.mockResolvedValueOnce([
      { agent_profile_name: 'implementer-agent' },
    ]);
    mocks.agentProfiles.findByName.mockResolvedValueOnce({
      name: 'implementer-agent',
      system_prompt: 'You implement things.',
      model_name: 'claude-opus',
      provider_name: 'anthropic',
      thinking_level: 'high',
      tool_policy: { default: 'deny', rules: [] },
      assigned_skills: ['testing-unit-patterns'],
    });
    const service = createService(mocks);

    await service.analyze(queueRow());

    expect(mocks.chatSessionRepo.findByWorkflowRunId).toHaveBeenCalledWith(
      'run-1',
    );
    expect(mocks.agentProfiles.findByName).toHaveBeenCalledWith(
      'implementer-agent',
    );
    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const actingAgentProfiles = triggerData.acting_agent_profiles;
    expect(typeof actingAgentProfiles).toBe('string');
    if (typeof actingAgentProfiles !== 'string') {
      throw new Error('Expected acting_agent_profiles to be a string');
    }
    expect(JSON.parse(actingAgentProfiles)).toEqual([
      {
        profileName: 'implementer-agent',
        systemPrompt: 'You implement things.',
        modelName: 'claude-opus',
        providerName: 'anthropic',
        thinkingLevel: 'high',
        toolPolicy: { default: 'deny', rules: [] },
        assignedSkills: ['testing-unit-patterns'],
      },
    ]);
  });

  it('omits acting_agent_profiles from the launch when no chat session names a profile', async () => {
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profiles).toBeUndefined();
  });

  it('falls back to the run executions when chat_sessions names no profile (single-agent-per-step run)', async () => {
    mocks.executions.findByWorkflowRun.mockResolvedValueOnce([
      { agent_profile_name: null },
      { agent_profile_name: 'implementer-agent' },
    ]);
    mocks.agentProfiles.findByName.mockResolvedValueOnce({
      name: 'implementer-agent',
      system_prompt: 'You implement things.',
      model_name: 'claude-opus',
      provider_name: 'anthropic',
      thinking_level: 'high',
      tool_policy: { default: 'deny', rules: [] },
      assigned_skills: ['testing-unit-patterns'],
    });
    const service = createService(mocks);

    await service.analyze(queueRow());

    expect(mocks.chatSessionRepo.findByWorkflowRunId).toHaveBeenCalledWith(
      'run-1',
    );
    expect(mocks.executions.findByWorkflowRun).toHaveBeenCalledWith('run-1');
    expect(mocks.agentProfiles.findByName).toHaveBeenCalledWith(
      'implementer-agent',
    );
    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    const actingAgentProfiles = triggerData.acting_agent_profiles;
    expect(typeof actingAgentProfiles).toBe('string');
    if (typeof actingAgentProfiles !== 'string') {
      throw new Error('Expected acting_agent_profiles to be a string');
    }
    expect(JSON.parse(actingAgentProfiles)).toEqual([
      {
        profileName: 'implementer-agent',
        systemPrompt: 'You implement things.',
        modelName: 'claude-opus',
        providerName: 'anthropic',
        thinkingLevel: 'high',
        toolPolicy: { default: 'deny', rules: [] },
        assignedSkills: ['testing-unit-patterns'],
      },
    ]);
  });

  it('does not consult executions when a chat session already names a profile', async () => {
    mocks.chatSessionRepo.findByWorkflowRunId.mockResolvedValueOnce([
      { agent_profile_name: 'implementer-agent' },
    ]);
    mocks.agentProfiles.findByName.mockResolvedValueOnce({
      name: 'implementer-agent',
      system_prompt: 'You implement things.',
      model_name: 'claude-opus',
      provider_name: 'anthropic',
      thinking_level: 'high',
      tool_policy: { default: 'deny', rules: [] },
      assigned_skills: null,
    });
    const service = createService(mocks);

    await service.analyze(queueRow());

    expect(mocks.executions.findByWorkflowRun).not.toHaveBeenCalled();
  });

  it('omits acting_agent_profiles from the launch when chat_sessions AND executions both name no profile (fail-soft)', async () => {
    mocks.executions.findByWorkflowRun.mockResolvedValueOnce([
      { agent_profile_name: null },
    ]);
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profiles).toBeUndefined();
  });

  it('omits acting_agent_profiles from the launch when the executions fallback lookup throws (fail-soft)', async () => {
    mocks.executions.findByWorkflowRun.mockRejectedValueOnce(
      new Error('db unavailable'),
    );
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profiles).toBeUndefined();
  });

  it('omits acting_agent_profiles from the launch when the chat-session lookup throws (fail-soft)', async () => {
    mocks.chatSessionRepo.findByWorkflowRunId.mockRejectedValueOnce(
      new Error('db unavailable'),
    );
    const service = createService(mocks);

    await service.analyze(queueRow());

    const [, triggerData] = mocks.engine.startWorkflow.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(triggerData.acting_agent_profiles).toBeUndefined();
  });
});

// ── B. processFindings (completion) ──────────────────────────────────────────────

describe('RetrospectiveAnalysisService.processFindings', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = createMocks();
  });

  const baseInput = (rawFindings: unknown) => ({
    originalRunId: 'run-1',
    scopeId: 'scope-1' as string | null,
    rawFindings,
  });

  it('routes a valid, evidence-backed, novel finding exactly once', async () => {
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    expect(mocks.router.route).toHaveBeenCalledTimes(1);
    const arg = mocks.router.route.mock.calls[0][0];
    expect(arg.finding.lesson).toBe(MEMORY_FINDING.lesson);
    expect(arg.originalRunId).toBe('run-1');
    expect(arg.scopeId).toBe('scope-1');
  });

  it('emits received and routed finding events for a routed finding', async () => {
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    expect(mocks.eventLedgerService.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: 'retrospective.finding.received',
        outcome: 'success',
        workflowRunId: 'run-1',
        context: expect.objectContaining({ scopeId: 'scope-1' }),
        payload: expect.objectContaining({
          original_run_id: 'run-1',
          finding_index: 0,
        }),
      }),
    );
    expect(mocks.eventLedgerService.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: 'retrospective.finding.routed',
        outcome: 'success',
        workflowRunId: 'run-1',
        context: expect.objectContaining({ scopeId: 'scope-1' }),
        payload: expect.objectContaining({
          original_run_id: 'run-1',
          finding_index: 0,
          terminal_outcome: 'routed',
        }),
      }),
    );
  });

  it('drops a finding citing a non-existent event id (router not called)', async () => {
    mocks.eventLedger.query.mockResolvedValue([[{ id: 'evt-real' }], 1]);
    const fabricated = { ...MEMORY_FINDING, evidence_event_ids: ['evt-fake'] };
    const service = createService(mocks);

    await service.processFindings(baseInput([fabricated]));

    expect(mocks.router.route).not.toHaveBeenCalled();
  });

  it('records a rejected_evidence outcome count when evidence is missing', async () => {
    mocks.queue.findByRunId.mockResolvedValue({
      id: 'queue-1',
      status: 'analyzed',
      signals_json: {},
    });
    const fabricated = { ...MEMORY_FINDING, evidence_event_ids: ['evt-fake'] };
    const service = createService(mocks);

    await service.processFindings(baseInput([fabricated]));

    const [, , patch] = mocks.queue.markStatus.mock.calls[0];
    expect(patch.signals_json.analysis.outcomes.rejected_evidence).toBe(1);
  });

  it('produces no routing for a kind:none finding', async () => {
    const none = {
      kind: 'none',
      lesson: 'clean run, no transferable lesson',
      confidence_self: 0,
      evidence_event_ids: [],
    };
    const service = createService(mocks);

    await service.processFindings(baseInput([none]));

    expect(mocks.router.route).not.toHaveBeenCalled();
  });

  it('dedups a finding that matches an existing memory above threshold (raw cosine ≥ 0.85)', async () => {
    mocks.retrieval.retrieve.mockResolvedValue([
      { id: 'seg-1', content: 'pin the lockfile' },
    ]);
    // Raw cosine near-duplicate — must be treated as already-known. A fused
    // ~0.03 score could never cross the 0.85 threshold, which is the bug.
    mocks.similarity.findRawSimilarNeighbors.mockResolvedValue([
      { ownerType: 'memory_segment', ownerId: 'seg-1', score: 0.92 },
    ]);
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    expect(mocks.router.route).not.toHaveBeenCalled();
  });

  it('records a rejected_known_memory outcome count for near-duplicate memory', async () => {
    mocks.queue.findByRunId.mockResolvedValue({
      id: 'queue-1',
      status: 'analyzed',
      signals_json: {},
    });
    mocks.retrieval.retrieve.mockResolvedValue([
      { id: 'seg-1', content: 'pin the lockfile' },
    ]);
    mocks.similarity.findRawSimilarNeighbors.mockResolvedValue([
      { ownerType: 'memory_segment', ownerId: 'seg-1', score: 0.92 },
    ]);
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    const [, , patch] = mocks.queue.markStatus.mock.calls[0];
    expect(patch.signals_json.analysis.outcomes.rejected_known_memory).toBe(1);
  });

  it('routes when the nearest existing memory is below threshold (raw cosine < 0.85)', async () => {
    mocks.retrieval.retrieve.mockResolvedValue([
      { id: 'seg-1', content: 'unrelated note' },
    ]);
    mocks.similarity.findRawSimilarNeighbors.mockResolvedValue([
      { ownerType: 'memory_segment', ownerId: 'seg-1', score: 0.2 },
    ]);
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    expect(mocks.router.route).toHaveBeenCalledTimes(1);
  });

  it('drops a Zod-invalid finding without throwing', async () => {
    const invalid = { kind: 'memory', confidence_self: 0.5 }; // missing lesson + evidence
    const service = createService(mocks);

    await expect(
      service.processFindings(baseInput([invalid])),
    ).resolves.toBeUndefined();
    expect(mocks.router.route).not.toHaveBeenCalled();
  });

  it('emits a rejected event for a schema-invalid finding', async () => {
    const invalid = { kind: 'memory', confidence_self: 0.5 };
    const service = createService(mocks);

    await service.processFindings(baseInput([invalid]));

    expect(mocks.eventLedgerService.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: 'retrospective.finding.rejected',
        outcome: 'success',
        workflowRunId: 'run-1',
        context: expect.objectContaining({ scopeId: 'scope-1' }),
        payload: expect.objectContaining({
          original_run_id: 'run-1',
          finding_index: 0,
          terminal_outcome: 'rejected_schema',
          reason_code: 'schema_invalid',
        }),
      }),
    );
  });

  it('emits a rejected event with the reason code when the router reports dropped (routed count not incremented)', async () => {
    mocks.router.route.mockResolvedValue({
      outcome: 'dropped',
      reasonCode: 'kind_unroutable',
    });
    mocks.queue.findByRunId.mockResolvedValue({
      id: 'queue-1',
      status: 'analyzed',
      signals_json: {},
    });
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    expect(mocks.eventLedgerService.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'workflow',
        eventName: 'retrospective.finding.rejected',
        outcome: 'failure',
        workflowRunId: 'run-1',
        payload: expect.objectContaining({
          terminal_outcome: 'routing_dropped',
          reason_code: 'kind_unroutable',
        }),
      }),
    );
    expect(mocks.eventLedgerService.emitBestEffort).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'retrospective.finding.routed' }),
    );
    const [, , patch] = mocks.queue.markStatus.mock.calls[0];
    expect(patch.signals_json.analysis.findings_routed).toBe(0);
  });

  it('gives each dropped finding in a batch a distinct finding_index (no collision on the routed counter)', async () => {
    mocks.router.route.mockResolvedValue({
      outcome: 'dropped',
      reasonCode: 'target_not_found',
    });
    const secondFinding = {
      ...MEMORY_FINDING,
      lesson: 'A second, unrelated lesson',
    };
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING, secondFinding]));

    const rejectedIndices = mocks.eventLedgerService.emitBestEffort.mock.calls
      .filter(([event]) => event.eventName === 'retrospective.finding.rejected')
      .map(([event]) => event.payload.finding_index);
    expect(rejectedIndices).toEqual([0, 1]);
  });

  it('does not throw and logs when the router port is absent', async () => {
    const service = createService(mocks, { withRouter: false });

    await expect(
      service.processFindings(baseInput([MEMORY_FINDING])),
    ).resolves.toBeUndefined();
    expect(mocks.router.route).not.toHaveBeenCalled();
  });

  // ── FU-16: config-gated dedup scope widening ─────────────────────────────

  it('omits agentProfileName/workflowName from the dedup retrieve call when the widen-scope setting is OFF (default)', async () => {
    mocks.retrieval.retrieve.mockResolvedValue([]);
    const service = createService(mocks);

    await service.processFindings({
      originalRunId: 'run-1',
      scopeId: 'scope-1',
      rawFindings: [MEMORY_FINDING],
      actingAgentProfileName: 'implementer-agent',
      workflowName: 'ci-workflow',
    });

    expect(mocks.retrieval.retrieve).toHaveBeenCalledTimes(1);
    const callArg = mocks.retrieval.retrieve.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('agentProfileName');
    expect(callArg).not.toHaveProperty('workflowName');
  });

  it('passes agentProfileName/workflowName into the dedup retrieve call when the widen-scope setting is ON', async () => {
    mocks.settings.get = vi.fn(async (key: string, fallback: unknown) =>
      key === RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING ? true : fallback,
    );
    mocks.retrieval.retrieve.mockResolvedValue([]);
    const service = createService(mocks);

    await service.processFindings({
      originalRunId: 'run-1',
      scopeId: 'scope-1',
      rawFindings: [MEMORY_FINDING],
      actingAgentProfileName: 'implementer-agent',
      workflowName: 'ci-workflow',
    });

    expect(mocks.retrieval.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'scope-1',
        agentProfileName: 'implementer-agent',
        workflowName: 'ci-workflow',
      }),
    );
  });

  it('omits agentProfileName/workflowName from the dedup retrieve call when the widen-scope setting is ON but neither identity field was supplied', async () => {
    mocks.settings.get = vi.fn(async (key: string, fallback: unknown) =>
      key === RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING ? true : fallback,
    );
    mocks.retrieval.retrieve.mockResolvedValue([]);
    const service = createService(mocks);

    await service.processFindings(baseInput([MEMORY_FINDING]));

    const callArg = mocks.retrieval.retrieve.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('agentProfileName');
    expect(callArg).not.toHaveProperty('workflowName');
  });
});
