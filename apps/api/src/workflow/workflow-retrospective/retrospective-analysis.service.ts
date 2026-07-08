/**
 * `RetrospectiveAnalysisService` — EPIC-212 Phase-2 Task 6.
 *
 * The glue that turns a claimed queue row into routed, novel, evidence-backed
 * findings. It spans two halves of an ASYNC architecture because launching the
 * analyst is fire-and-forget (`startWorkflow` does NOT resolve on run
 * completion):
 *
 *   A. DISPATCH (`analyze`, implements `RetrospectiveAnalysisPort`) — the drain
 *      calls this per claimed row. It builds the token-bounded digest and
 *      launches the `run_retrospective` analyst, threading the ORIGINAL run id
 *      into the child run's `trigger.workflow_run_id` (the correlation key).
 *      Returns `{status:'analyzed'}` ("handed off"); a launch throw →
 *      `{status:'failed'}`. Never throws.
 *
 *   B. COMPLETION (`processFindings`) — invoked by `RetrospectiveFindingsListener`
 *      when the analyst run completes. It validates the raw findings, verifies
 *      their `evidence_event_ids` against the ORIGINAL run's ledger (dropping
 *      fabricated ids), dedups each surviving finding against KNOWN memory via
 *      the Phase-1 vector recall, and hands the novel survivors to the router
 *      PORT (Task 7). Fail-soft throughout.
 *
 * Scope-neutral: only the neutral `scopeId` flows through; no domain-specific
 * identifiers leave this boundary.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { RetrospectiveFinding } from '@nexus/core';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import { CANDIDATE_SIMILARITY } from '../../memory/signals/candidate-similarity.interface';
import type { ICandidateSimilarity } from '../../memory/signals/candidate-similarity.interface';
import {
  CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
  CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
} from '../../memory/signals/candidate-similarity.config';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import { RunTranscriptDigestService } from './run-transcript-digest.service';
import { ChatTranscriptDigestService } from './chat-transcript-digest.service';
import {
  CHAT_SESSION_MEMORY_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  type IChatSessionMemoryPort,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import type {
  ActingAgentProfileSummary,
  OriginalWorkflowDetails,
  RetrospectiveAnalysisOutcome,
  RetrospectiveAnalysisPort,
  RetrospectiveDedupIdentity,
  RetrospectiveProcessFindingsInput,
} from './retrospective-analysis.types';
import {
  buildDedupScopeFields,
  resolveDedupWidenScope,
} from './retrospective-dedup-scope.helpers';
import { RETROSPECTIVE_ROUTER_PORT } from './retrospective-router.port';
import type { RetrospectiveRouterPort } from './retrospective-router.port';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import {
  filterFindingsByEvidenceWithOutcomes,
  parseFindingsWithOutcomes,
} from './retrospective-findings.helpers';
import {
  dedupeExecutionProfileNames,
  dedupeProfileNames,
  hydrateActingAgentProfileSummaries,
  resolveActingAgentProfileName,
  resolveChatSessionsForSource,
} from './retrospective-acting-agent-profiles.helpers';
import { resolveWorkflowDetailsForRun } from './retrospective-workflow-yaml.helpers';
import {
  buildReceivedFindingEvent,
  buildRejectedFindingEvent,
  buildRoutedFindingEvent,
} from './retrospective-analysis-events.helpers';
import type { RejectedFindingEventParams } from './retrospective-analysis-events.helpers.types';

/** The analyst workflow + profile this orchestrator launches. */
const RUN_RETROSPECTIVE_WORKFLOW_ID = 'run_retrospective';
const ANALYST_AGENT_PROFILE = 'retrospective-analyst';
/** Owner type for the dedup KNN over existing memory segments. */
const MEMORY_SEGMENT_OWNER_TYPE = 'memory_segment';
/** Top-1 is enough to decide "already known". */
const NEAR_DUP_K = 1;
/** Rough token budget for the dedup candidate fetch. */
const DEDUP_TOKEN_BUDGET = 2000;
/** Ledger scan cap for the evidence-id universe (matches repo max). */
const LEDGER_SCAN_LIMIT = 1000;

interface RetrospectiveOutcomeCounts {
  rejected_schema: number;
  rejected_evidence: number;
  rejected_known_memory: number;
  routed: number;
}

interface NovelFindingsResult {
  novel: RetrospectiveFinding[];
  rejectedKnown: RetrospectiveFinding[];
  rejectedKnownMemory: number;
}

@Injectable()
export class RetrospectiveAnalysisService implements RetrospectiveAnalysisPort {
  private readonly logger = new Logger(RetrospectiveAnalysisService.name);

  constructor(
    private readonly digestService: RunTranscriptDigestService,
    private readonly chatDigestService: ChatTranscriptDigestService,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    @Inject(CHAT_SESSION_MEMORY_PORT)
    private readonly sessionMemory: IChatSessionMemoryPort,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    private readonly eventLedger: EventLedgerRepository,
    private readonly retrieval: MemoryRetrievalService,
    private readonly settings: SystemSettingsService,
    private readonly queue: RetrospectiveQueueRepository,
    private readonly eventLedgerService: EventLedgerService,
    @Optional()
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity | null,
    @Optional()
    @Inject(RETROSPECTIVE_ROUTER_PORT)
    private readonly router: RetrospectiveRouterPort | null,
    private readonly workflowRuns: WorkflowRunRepository,
    private readonly workflows: WorkflowRepository,
    private readonly agentProfiles: AgentProfileRepository,
    private readonly executions: ExecutionRepository,
  ) {}

  // ── A. Dispatch (drain → analyst) ─────────────────────────────────────────

  /**
   * Build the digest and launch the analyst for one claimed row. The original
   * run id flows into the child run's `trigger.workflow_run_id` so the
   * completion listener can correlate findings back to this run. Returns
   * `{status:'analyzed'}` on successful hand-off; `{status:'failed'}` on any
   * launch error. Never throws (fail-soft).
   */
  async analyze(
    row: RetrospectiveQueue,
  ): Promise<RetrospectiveAnalysisOutcome> {
    try {
      const isChat = row.source_type === 'chat_session' && row.chat_session_id;
      const chatSessionId = row.chat_session_id ?? '';
      const workflowRunId = row.workflow_run_id ?? '';
      const digest = isChat
        ? await this.chatDigestService.buildDigest(chatSessionId, row.scope_id)
        : await this.digestService.buildDigest(workflowRunId, row.scope_id);
      const workflowDetails = isChat
        ? { yaml: undefined, name: undefined }
        : await this.resolveOriginalWorkflowDetails(workflowRunId);
      const actingAgentProfiles = await this.resolveActingAgentProfiles(
        isChat ? { chatSessionId } : { workflowRunId },
      );

      await this.workflowEngine.startWorkflow(RUN_RETROSPECTIVE_WORKFLOW_ID, {
        scope_id: row.scope_id,
        workflow_run_id: isChat ? undefined : workflowRunId,
        chat_session_id: isChat ? chatSessionId : undefined,
        digest: JSON.stringify(digest),
        agent_profile: ANALYST_AGENT_PROFILE,
        workflow_yaml: workflowDetails.yaml,
        workflow_name: workflowDetails.name,
        acting_agent_profiles: actingAgentProfiles
          ? JSON.stringify(actingAgentProfiles)
          : undefined,
        acting_agent_profile_name:
          resolveActingAgentProfileName(actingAgentProfiles),
      });

      return { status: 'analyzed' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const identifier =
        row.source_type === 'chat_session'
          ? row.chat_session_id
          : row.workflow_run_id;
      this.warn(
        `analyst launch failed for row ${row.id} (${identifier})`,
        error,
      );
      return { status: 'failed', reason };
    }
  }

  /**
   * Best-effort lookup of the original run's CURRENT workflow YAML + name.
   * The YAML gives the analyst the full definition on hand for
   * `workflow_definition_change` findings (a proposal for that kind must
   * carry the complete corrected YAML, not a fragment); the name (FU-16 Task
   * A2) is threaded into the launch trigger so the completion-side dedup
   * check can later widen its recall to the `workflow(<name>)` memory pool.
   * Fail-soft: any lookup miss/error yields `{yaml: undefined, name:
   * undefined}` and is warned, never thrown.
   */
  private async resolveOriginalWorkflowDetails(
    workflowRunId: string,
  ): Promise<OriginalWorkflowDetails> {
    try {
      return await resolveWorkflowDetailsForRun(
        workflowRunId,
        (id) => this.workflowRuns.findById(id),
        (id) => this.workflows.findById(id),
      );
    } catch (error) {
      this.warn(
        `original-workflow-details lookup failed for run ${workflowRunId}`,
        error,
      );
      return { yaml: undefined, name: undefined };
    }
  }

  /**
   * Best-effort lookup of the agent profile(s) that ACTUALLY executed steps
   * in the run/chat session under analysis (ground truth, not the workflow
   * YAML's request) — see `retrospective-acting-agent-profiles.helpers.ts`.
   * Two sources, tried in order for a run-sourced digest: `chat_sessions`
   * (populated only for runs that spawned a subagent) falling back to
   * `executions` (populated at step dispatch for every step, so it covers the
   * common single-agent-per-step run that never creates a chat session).
   * Fail-soft: any lookup miss/error yields `undefined` and is warned, never
   * thrown — the prompt tells the analyst it must not emit
   * `agent_profile_change` without this input.
   */
  private async resolveActingAgentProfiles(
    source: { workflowRunId: string } | { chatSessionId: string },
  ): Promise<ActingAgentProfileSummary[] | undefined> {
    try {
      const sessions = await resolveChatSessionsForSource(
        source,
        this.chatSessionRepo,
      );
      let profileNames = dedupeProfileNames(sessions);
      if (profileNames.length === 0 && 'workflowRunId' in source) {
        const executions = await this.executions.findByWorkflowRun(
          source.workflowRunId,
        );
        profileNames = dedupeExecutionProfileNames(executions);
      }
      return await hydrateActingAgentProfileSummaries(profileNames, (name) =>
        this.agentProfiles.findByName(name),
      );
    } catch (error) {
      this.warn('acting-agent-profile lookup failed', error);
      return undefined;
    }
  }

  // ── B. Completion (analyst → router) ──────────────────────────────────────

  /**
   * Validate, evidence-verify, dedup-against-known, and route the analyst's
   * raw findings. Fail-soft: any error is swallowed + warned so the event bus
   * is never broken.
   */
  async processFindings(
    input: RetrospectiveProcessFindingsInput,
  ): Promise<void> {
    const { originalRunId, scopeId, rawFindings } = input;
    const dedupIdentity: RetrospectiveDedupIdentity = {
      agentProfileName: input.actingAgentProfileName,
      workflowName: input.workflowName,
    };
    try {
      const outcomes = createOutcomeCounts();
      const findingsTotal = Array.isArray(rawFindings) ? rawFindings.length : 0;
      await this.emitReceivedFindings(originalRunId, scopeId, rawFindings);
      const parsed = parseFindingsWithOutcomes(rawFindings);
      outcomes.rejected_schema += parsed.rejected.length;
      await Promise.all(
        parsed.rejected.map((rejection) =>
          this.emitRejectedFinding(originalRunId, scopeId, {
            findingIndex: rejection.index,
            terminalOutcome: 'rejected_schema',
            reasonCode: rejection.reasonCode,
            issues: rejection.issues,
          }),
        ),
      );
      if (parsed.valid.length === 0) {
        await this.recordSummary(originalRunId, findingsTotal, 0, outcomes);
        return;
      }

      const validEventIds = await this.loadValidEvidenceIds(originalRunId);
      const evidenced = filterFindingsByEvidenceWithOutcomes(
        parsed.valid,
        validEventIds,
      );
      outcomes.rejected_evidence += evidenced.rejected.length;
      await Promise.all(
        evidenced.rejected.map((rejection) =>
          this.emitRejectedFinding(originalRunId, scopeId, {
            findingIndex: rejection.index,
            terminalOutcome: 'rejected_evidence',
            reasonCode: rejection.reasonCode,
            issues: rejection.issues,
          }),
        ),
      );
      const { novel, rejectedKnown, rejectedKnownMemory } =
        await this.filterNovel(evidenced.valid, scopeId, dedupIdentity);
      outcomes.rejected_known_memory += rejectedKnownMemory;
      await Promise.all(
        rejectedKnown.map((finding, index) =>
          this.emitRejectedFinding(originalRunId, scopeId, {
            findingIndex: index,
            terminalOutcome: 'rejected_known_memory',
            reasonCode: 'known_memory',
            lessonSnippet: snippet(finding.lesson),
          }),
        ),
      );

      const routed = await this.routeFindings(novel, scopeId, originalRunId);
      outcomes.routed += routed;
      await this.recordSummary(originalRunId, findingsTotal, routed, outcomes);
    } catch (error) {
      this.warn(`processFindings failed for run ${originalRunId}`, error);
    }
  }

  // ── Evidence verification ─────────────────────────────────────────────────

  private async loadValidEvidenceIds(
    runId: string,
  ): Promise<ReadonlySet<string>> {
    try {
      const chatSession = await this.chatSessionRepo.findById(runId);
      if (chatSession) {
        const messages = await this.sessionMemory.findRecentBySession(
          runId,
          100,
        );
        return new Set(messages.map((m) => `chat_msg:${m.id}`));
      }

      const [events] = await this.eventLedger.query({
        workflow_run_id: runId,
        limit: LEDGER_SCAN_LIMIT,
      });
      return new Set(events.map((event) => event.id));
    } catch (error) {
      this.warn(`evidence-id load failed for run ${runId}`, error);
      return new Set<string>();
    }
  }

  // ── Dedup against known memory (Phase-1 vector recall) ────────────────────

  private async filterNovel(
    findings: RetrospectiveFinding[],
    scopeId: string | null,
    identity: RetrospectiveDedupIdentity,
  ): Promise<NovelFindingsResult> {
    const novel: RetrospectiveFinding[] = [];
    const rejectedKnown: RetrospectiveFinding[] = [];
    let rejectedKnownMemory = 0;
    for (const finding of findings) {
      const known = await this.isAlreadyKnown(
        scopeId,
        finding.lesson,
        identity,
      );
      if (!known) {
        novel.push(finding);
      } else {
        rejectedKnown.push(finding);
        rejectedKnownMemory += 1;
      }
    }
    return { novel, rejectedKnown, rejectedKnownMemory };
  }

  /**
   * True when an EXISTING memory segment in scope is a near-duplicate of the
   * lesson (RAW cosine similarity >= `candidate_similarity_threshold`). Uses
   * the raw-similarity path, not the RRF-fused `findNearest`, so the 0.85
   * threshold actually fires once embeddings are configured. Fail-soft: any
   * error (or absent similarity provider) treats the lesson as novel so a
   * genuine finding is never silently lost.
   *
   * FU-16: when `RETROSPECTIVE_DEDUP_WIDEN_SCOPE_SETTING` is ON, `identity`'s
   * `agentProfileName`/`workflowName` are also passed to `retrieve`, widening
   * the dedup pool to `MemoryRetrievalService`'s `agent(<name>)` +
   * `workflow(<name>)` pools. Default OFF preserves the exact current
   * project+global-only pool.
   */
  private async isAlreadyKnown(
    scopeId: string | null,
    lesson: string,
    identity: RetrospectiveDedupIdentity = {},
  ): Promise<boolean> {
    if (scopeId === null || this.similarity === null) {
      return false;
    }
    try {
      const widenScope = await resolveDedupWidenScope(this.settings);
      const scopeFields = buildDedupScopeFields(widenScope, identity);
      const segments = await this.retrieval.retrieve({
        scopeId,
        queryText: lesson,
        tokenBudget: DEDUP_TOKEN_BUDGET,
        ...scopeFields,
      });
      if (segments.length === 0) {
        return false;
      }

      const threshold = await this.resolveSimilarityThreshold();
      const neighbours = await this.similarity.findRawSimilarNeighbors(
        lesson,
        NEAR_DUP_K,
        {
          ownerType: MEMORY_SEGMENT_OWNER_TYPE,
          ownerIds: segments.map((segment) => segment.id),
          corpus: segments.map((segment) => ({
            ownerId: segment.id,
            content: segment.content,
          })),
        },
      );

      const top = neighbours[0];
      return top !== undefined && top.score >= threshold;
    } catch (error) {
      this.warn(`dedup check failed (treating as novel)`, error);
      return false;
    }
  }

  private async resolveSimilarityThreshold(): Promise<number> {
    try {
      return await this.settings.get<number>(
        CANDIDATE_SIMILARITY_THRESHOLD_SETTING,
        CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT,
      );
    } catch {
      return CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT;
    }
  }

  // ── Routing (Task-7 port; absent → log, never lose) ───────────────────────

  private async routeFindings(
    findings: RetrospectiveFinding[],
    scopeId: string | null,
    originalRunId: string,
  ): Promise<number> {
    if (findings.length === 0) {
      return 0;
    }
    if (this.router === null) {
      this.logger.warn(
        `RetrospectiveAnalysisService: router port absent — ${findings.length} ` +
          `novel finding(s) from run ${originalRunId} would route but were not ` +
          `persisted (Task 7 not wired).`,
      );
      await Promise.all(
        findings.map((finding, index) =>
          this.emitRejectedFinding(originalRunId, scopeId, {
            findingIndex: index,
            terminalOutcome: 'routing_failed',
            reasonCode: 'router_unavailable',
            lessonSnippet: snippet(finding.lesson),
            outcome: 'failure',
          }),
        ),
      );
      return 0;
    }
    let routed = 0;
    for (const [index, finding] of findings.entries()) {
      try {
        const result = await this.router.route({
          finding,
          scopeId,
          originalRunId,
        });
        if (result.outcome === 'routed') {
          await this.emitRoutedFinding(originalRunId, scopeId, index, finding);
          routed += 1;
        } else {
          await this.emitRejectedFinding(originalRunId, scopeId, {
            findingIndex: index,
            terminalOutcome: 'routing_dropped',
            reasonCode: result.reasonCode,
            lessonSnippet: snippet(finding.lesson),
            outcome: 'failure',
            errorMessage: result.detail,
          });
        }
      } catch (error) {
        this.warn(`router.route failed for run ${originalRunId}`, error);
        await this.emitRejectedFinding(originalRunId, scopeId, {
          findingIndex: index,
          terminalOutcome: 'routing_failed',
          reasonCode: 'router_error',
          lessonSnippet: snippet(finding.lesson),
          outcome: 'failure',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return routed;
  }

  private async emitReceivedFindings(
    originalRunId: string,
    scopeId: string | null,
    rawFindings: unknown,
  ): Promise<void> {
    if (!Array.isArray(rawFindings)) {
      return;
    }
    await Promise.all(
      rawFindings.map((_, index) =>
        this.eventLedgerService.emitBestEffort(
          buildReceivedFindingEvent(originalRunId, scopeId, index),
        ),
      ),
    );
  }

  private async emitRoutedFinding(
    originalRunId: string,
    scopeId: string | null,
    findingIndex: number,
    finding: RetrospectiveFinding,
  ): Promise<void> {
    await this.eventLedgerService.emitBestEffort(
      buildRoutedFindingEvent(
        originalRunId,
        scopeId,
        findingIndex,
        finding,
        snippet(finding.lesson),
      ),
    );
  }

  private async emitRejectedFinding(
    originalRunId: string,
    scopeId: string | null,
    params: RejectedFindingEventParams,
  ): Promise<void> {
    await this.eventLedgerService.emitBestEffort(
      buildRejectedFindingEvent(originalRunId, scopeId, params),
    );
  }

  // ── Observability (best-effort) ───────────────────────────────────────────

  private async recordSummary(
    runId: string,
    findingsTotal: number,
    findingsRouted: number,
    outcomes: RetrospectiveOutcomeCounts,
  ): Promise<void> {
    try {
      const row = await this.queue.findByRunId(runId);
      if (row === null) {
        return;
      }
      await this.queue.markStatus(row.id, row.status, {
        signals_json: {
          ...row.signals_json,
          analysis: {
            findings_total: findingsTotal,
            findings_routed: findingsRouted,
            outcomes,
          },
        },
      });
    } catch (error) {
      this.warn(`analysis-summary write failed for run ${runId}`, error);
    }
  }

  private warn(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `RetrospectiveAnalysisService ${context}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

function createOutcomeCounts(): RetrospectiveOutcomeCounts {
  return {
    rejected_schema: 0,
    rejected_evidence: 0,
    rejected_known_memory: 0,
    routed: 0,
  };
}

function snippet(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`;
}
