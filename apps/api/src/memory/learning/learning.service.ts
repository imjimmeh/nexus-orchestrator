import { Injectable } from '@nestjs/common';
import { LearningCandidateRepository } from '../database/repositories/learning-candidate.repository';
import { ImprovementProposalRepository } from '../../improvement/database/repositories/improvement-proposal.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from '../../observability/autonomy-observability.types';
import { ListLearningCandidatesRequest, WorkflowStatus } from '@nexus/core';
import { toLearningCandidateListItem } from './learning.mapper';
import type { LearningCandidateListResponse } from './learning.types';
import { WorkflowEngineService } from '../../workflow/workflow-engine.service';
import { WorkflowPersistenceService } from '../../workflow/workflow-persistence.service';
import { sleep } from '../../common/utils/async.utils';
import { buildPaginatedMeta } from '../../common/utils/query-helpers';

interface SweepJobOutput {
  scannedScopes?: number | string;
  scannedObservations?: number | string;
  rankedCandidates?: number | string;
  promotedCandidates?: number | string;
  createdSkillProposals?: number | string;
}

interface SweepJobState {
  output?: SweepJobOutput;
}

interface WorkflowRunStateJobs {
  sweep?: SweepJobState;
}

interface WorkflowRunTriggerState {
  trigger?: unknown;
  source?: unknown;
}

interface WorkflowRunState {
  trigger?: WorkflowRunTriggerState;
  jobs?: WorkflowRunStateJobs;
}

type WorkflowRunListItem = Awaited<
  ReturnType<WorkflowPersistenceService['getWorkflowRuns']>
>[number];

/**
 * Dashboard proposal totals historically only ever reflected `skill_create`
 * proposals (the retired legacy skill proposal table held nothing else), so
 * the improvement-pipeline count is scoped to this kind to keep
 * `proposalTotals` semantically unchanged now that `improvement_proposals`
 * also holds other proposal kinds (workflow/agent-profile/code changes).
 */
const DASHBOARD_PROPOSAL_KINDS = ['skill_create'] as const;

@Injectable()
export class LearningService {
  constructor(
    private readonly candidates: LearningCandidateRepository,
    private readonly proposals: ImprovementProposalRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly workflowEngine: WorkflowEngineService,
    private readonly persistence: WorkflowPersistenceService,
  ) {}

  async getStatus() {
    const [
      pendingCandidates,
      promotedCandidates,
      pendingProposals,
      approvedProposals,
      rejectedProposals,
      failedProposals,
      runs,
    ] = await Promise.all([
      this.candidates.countByStatuses(['pending']),
      this.candidates.countByStatuses(['promoted']),
      this.proposals.countByStatuses(
        ['pending'],
        [...DASHBOARD_PROPOSAL_KINDS],
      ),
      this.proposals.countByStatuses(
        ['approved'],
        [...DASHBOARD_PROPOSAL_KINDS],
      ),
      this.proposals.countByStatuses(
        ['rejected'],
        [...DASHBOARD_PROPOSAL_KINDS],
      ),
      this.proposals.countByStatuses(['failed'], [...DASHBOARD_PROPOSAL_KINDS]),
      this.persistence.getWorkflowRuns({
        workflowId: 'memory_learning_sweep',
      }),
    ]);

    const sweepRunning = runs.some(
      (run) =>
        run.status === WorkflowStatus.RUNNING ||
        run.status === WorkflowStatus.PENDING,
    );

    const completedRuns = runs
      .filter(
        (run) => run.status === WorkflowStatus.COMPLETED && run.completed_at,
      )
      .sort((a, b) => {
        const aCompletedAt = a.completed_at;
        const bCompletedAt = b.completed_at;
        if (!aCompletedAt || !bCompletedAt) {
          return 0;
        }
        return (
          new Date(bCompletedAt).getTime() - new Date(aCompletedAt).getTime()
        );
      });
    const lastRun = completedRuns[0]
      ? this.toLearningSweepRunSummary(completedRuns[0])
      : null;

    return {
      enabled: true,
      intervalSeconds: 0,
      promotionThreshold: 0,
      proposalThreshold: 0,
      sweepRunning,
      candidateTotals: {
        pending: pendingCandidates,
        promoted: promotedCandidates,
      },
      proposalTotals: {
        pending: pendingProposals,
        approved: approvedProposals,
        rejected: rejectedProposals,
        failed: failedProposals,
      },
      lastRun,
    };
  }

  async runManualSweep() {
    const startedAt = new Date().toISOString();
    const runId = await this.workflowEngine.startWorkflow(
      'memory_learning_sweep',
      {
        trigger: 'manual',
      },
    );

    if (!runId) {
      throw new Error('Failed to start memory learning sweep workflow');
    }

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningRunStarted,
      outcome: 'in_progress',
      payload: { runId, trigger: 'manual' },
    });

    const run = await this.waitForWorkflowRun(runId);
    const completedAt = new Date().toISOString();
    const output = this.parseSweepOutput(run);

    const result = {
      runId,
      trigger: 'manual' as const,
      startedAt,
      completedAt,
      scannedScopes: Number(output.scannedScopes) || 0,
      scannedObservations: Number(output.scannedObservations) || 0,
      rankedCandidates: Number(output.rankedCandidates) || 0,
      promotedCandidates: Number(output.promotedCandidates) || 0,
      createdSkillProposals: Number(output.createdSkillProposals) || 0,
    };

    await this.eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: AUTONOMY_EVENT_NAMES.learningRunCompleted,
      outcome: run.status === WorkflowStatus.COMPLETED ? 'success' : 'failure',
      payload: result,
    });

    return result;
  }

  private async waitForWorkflowRun(
    runId: string,
    timeoutMs = 60000,
  ): Promise<
    Awaited<ReturnType<WorkflowPersistenceService['getWorkflowRun']>>
  > {
    const start = Date.now();
    let run = await this.persistence.getWorkflowRun(runId);
    while (
      run.status !== WorkflowStatus.COMPLETED &&
      run.status !== WorkflowStatus.FAILED &&
      run.status !== WorkflowStatus.CANCELLED &&
      Date.now() - start < timeoutMs
    ) {
      await sleep(200);
      run = await this.persistence.getWorkflowRun(runId);
    }
    return run;
  }

  private parseSweepOutput(
    run: Awaited<ReturnType<WorkflowPersistenceService['getWorkflowRun']>>,
  ): SweepJobOutput {
    const state = run.state_variables as unknown as
      | WorkflowRunState
      | undefined;
    return state?.jobs?.sweep?.output ?? {};
  }

  private parseWorkflowRunState(
    run: Pick<WorkflowRunListItem, 'state_variables'>,
  ): WorkflowRunState | undefined {
    return run.state_variables;
  }

  private toLearningSweepRunSummary(run: WorkflowRunListItem) {
    const completedAt = this.toIsoTimestamp(run.completed_at);
    const output = this.parseSweepOutput(run);

    return {
      runId: run.id,
      trigger: this.resolveSweepTrigger(run),
      startedAt: this.toIsoTimestamp(run.started_at, completedAt),
      completedAt,
      scannedScopes: Number(output.scannedScopes) || 0,
      scannedObservations: Number(output.scannedObservations) || 0,
      rankedCandidates: Number(output.rankedCandidates) || 0,
      promotedCandidates: Number(output.promotedCandidates) || 0,
      createdSkillProposals: Number(output.createdSkillProposals) || 0,
    };
  }

  private resolveSweepTrigger(
    run: WorkflowRunListItem,
  ): 'manual' | 'scheduled' {
    const trigger = this.parseWorkflowRunState(run)?.trigger;
    return trigger?.trigger === 'manual' || trigger?.source === 'manual'
      ? 'manual'
      : 'scheduled';
  }

  private toIsoTimestamp(
    value: Date | string | null | undefined,
    fallback = '',
  ) {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return value;
    }
    return fallback;
  }

  async listCandidates(
    query: ListLearningCandidatesRequest,
  ): Promise<LearningCandidateListResponse> {
    const [{ data, total }, suppressedCount] = await Promise.all([
      this.candidates.list({
        statuses: query.status,
        candidateTypes: query.candidate_type,
        scopeType: query.scope_type,
        scopeId: query.scope_id,
        excludeMerged: true,
        search: query.search,
        minScore: query.min_score,
        createdFrom: query.created_from,
        createdTo: query.created_to,
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      }),
      this.candidates.countMerged(),
    ]);

    return {
      data: data.map((candidate) => toLearningCandidateListItem(candidate)),
      meta: {
        ...buildPaginatedMeta(total, query.page, query.limit),
        suppressedCount,
      },
    };
  }
}
