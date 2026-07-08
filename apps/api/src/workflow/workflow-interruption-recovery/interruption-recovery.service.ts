import { Inject, Injectable, Logger } from '@nestjs/common';
import { isHarnessId } from '@nexus/core';
import type { HarnessId, HarnessSessionRef } from '@nexus/core';
import { readFile } from 'node:fs/promises';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import {
  CHAT_SESSION_DOMAIN_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  type ChatSessionDomainPort,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { StepSessionCheckpointRepository } from '../workflow-session-checkpoint/step-session-checkpoint.repository.js';
import {
  checkpointSidecarSessionPath,
  resolveCheckpointBaseDir,
} from '../workflow-session-checkpoint/checkpoint-sidecar-path';
import type {
  CancelledSubagentExecution,
  InterruptionRecoveryResult,
  PrepareRecoveryInput,
} from './interruption-recovery.types';

function formatRecoveryReason(
  source: 'stale-run-watchdog' | 'supervisor-reap',
): string {
  return `${source} interruption recovery`;
}

@Injectable()
export class InterruptionRecoveryService {
  private readonly logger = new Logger(InterruptionRecoveryService.name);

  constructor(
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    private readonly checkpointRepo: StepSessionCheckpointRepository,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  async prepareRecovery(
    input: PrepareRecoveryInput,
  ): Promise<InterruptionRecoveryResult> {
    const cancelledSubagentExecutions = await this.cancelSubagents(input);

    await this.persistCancelledSubagentResumes(
      input,
      cancelledSubagentExecutions,
    );

    const { parentTreeId, chatSessionRecord } =
      await this.resolveParentTree(input);

    const rawHarnessId = chatSessionRecord?.harness_id || 'pi';
    const harnessId: HarnessId = isHarnessId(rawHarnessId)
      ? rawHarnessId
      : 'pi';

    const resumeSessionRef = await this.buildResumeSessionRef(
      parentTreeId,
      harnessId,
      chatSessionRecord,
      input.source,
    );

    const parentResume: InterruptionRecoveryResult['parentResume'] =
      parentTreeId && resumeSessionRef
        ? {
            resumeSessionTreeId: parentTreeId,
            resumeSessionRef,
          }
        : undefined;

    if (parentResume) {
      try {
        await this.checkpointRepo.recordCheckpoint({
          run_id: input.workflowRunId,
          job_id: input.jobId,
          execution_id: input.parentExecutionId,
          session_tree_id: parentResume.resumeSessionTreeId,
          session_ref: parentResume.resumeSessionRef,
          engine: harnessId,
          phase: 'result',
        });
      } catch (error) {
        this.logger.warn(
          `Failed to record checkpoint for run ${input.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { cancelledSubagentExecutions, parentResume };
  }

  private async persistCancelledSubagentResumes(
    input: PrepareRecoveryInput,
    cancelledSubagentExecutions: CancelledSubagentExecution[],
  ): Promise<void> {
    if (cancelledSubagentExecutions.length === 0) return;

    const key = `_internal.${input.jobId}.cancelled_subagent_resumes`;
    try {
      await this.runRepo.setStateVariableAtomic(
        input.workflowRunId,
        key,
        cancelledSubagentExecutions,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to persist cancelled subagent resumes for run ${input.workflowRunId}`,
        error,
      );
    }
  }

  private async cancelSubagents(
    input: PrepareRecoveryInput,
  ): Promise<CancelledSubagentExecution[]> {
    const results: CancelledSubagentExecution[] = [];

    for (const containerId of input.parentContainerIds) {
      try {
        const result = await this.subagentOrchestrator.cancelActiveForParent(
          containerId,
          {
            workflowRunId: input.workflowRunId,
            reason: formatRecoveryReason(input.source),
          },
        );

        if (result.cancelled_execution_ids.length > 0) {
          this.logger.log(
            `Cancelled ${result.cancelled_execution_ids.length} subagent execution(s) for container ${containerId}`,
          );
        }

        for (const executionId of result.cancelled_execution_ids) {
          let sessionTreeId: string | undefined;
          let agentProfileName: string | undefined;
          let contractId: string | undefined;

          try {
            const chatSession =
              await this.chatSessionRepo.findBySubagentExecutionId(executionId);
            if (chatSession) {
              sessionTreeId = chatSession.session_tree_id ?? undefined;
              agentProfileName = chatSession.agent_profile_name;
            }
          } catch (error) {
            this.logger.warn(
              `Failed to look up chat session for subagent execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          try {
            const subagentDetails =
              await this.subagentDetailsRepo.findByExecutionId(executionId);
            if (subagentDetails) {
              contractId = subagentDetails.delegation_contract_id ?? undefined;
            }
          } catch (error) {
            this.logger.warn(
              `Failed to look up subagent details for subagent execution ${executionId}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          results.push({
            executionId,
            sessionTreeId,
            agentProfileName,
            contractId,
          });
        }
      } catch (error) {
        this.logger.error(
          `Failed to cancel subagents for container ${containerId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  private async resolveParentTree(input: PrepareRecoveryInput): Promise<{
    parentTreeId?: string;
    chatSessionRecord?: { id?: string; harness_id?: string | null };
  }> {
    if (input.source === 'stale-run-watchdog') {
      return this.resolveStaleRunWatchdogParent(input);
    }

    if (input.source === 'supervisor-reap') {
      return this.resolveSupervisorReapParent(input);
    }

    return {};
  }

  private async resolveStaleRunWatchdogParent(
    input: PrepareRecoveryInput,
  ): Promise<{
    parentTreeId?: string;
    chatSessionRecord?: { id?: string; harness_id?: string | null };
  }> {
    try {
      const session = await this.chatSessionRepo.findParentByWorkflowRunId(
        input.workflowRunId,
      );

      if (!session?.session_tree_id) return {};

      return {
        parentTreeId: session.session_tree_id,
        chatSessionRecord: session,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to resolve parent session for stale run ${input.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  private async resolveSupervisorReapParent(
    input: PrepareRecoveryInput,
  ): Promise<{
    parentTreeId?: string;
    chatSessionRecord?: { id?: string; harness_id?: string | null };
  }> {
    let jsonl: string;

    if (input.sidecarSessionJsonl?.trim()) {
      jsonl = input.sidecarSessionJsonl;
    } else {
      try {
        const filePath = checkpointSidecarSessionPath(
          resolveCheckpointBaseDir(),
          input.workflowRunId,
          input.jobId,
        );
        jsonl = await readFile(filePath, 'utf8');
      } catch (error) {
        this.logger.warn(
          `Failed to read sidecar session file for run ${input.workflowRunId}, job ${input.jobId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {};
      }
    }

    try {
      const treeId = await this.sessionHydration.saveSessionFromJsonl(
        jsonl,
        { workflow_run_id: input.workflowRunId },
        { containerTier: input.containerTier },
      );

      let chatSessionRecord:
        | { id?: string; harness_id?: string | null }
        | undefined;
      try {
        const session = await this.chatSessionRepo.findParentByWorkflowRunId(
          input.workflowRunId,
        );
        if (session) {
          chatSessionRecord = session;
        }
      } catch (lookupError) {
        this.logger.warn(
          `Failed to resolve parent session for supervisor reap on run ${input.workflowRunId}: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`,
        );
      }

      return { parentTreeId: treeId, chatSessionRecord };
    } catch (error) {
      this.logger.warn(
        `Failed to persist sidecar session for run ${input.workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  private async buildResumeSessionRef(
    parentTreeId?: string,
    harnessId?: HarnessId,
    chatSessionRecord?: { id?: string; harness_id?: string | null },
    source?: 'stale-run-watchdog' | 'supervisor-reap',
  ): Promise<HarnessSessionRef | undefined> {
    if (!parentTreeId) return undefined;

    try {
      const capabilities = this.harnessRegistry.resolve(
        harnessId ?? 'pi',
      ).capabilities;

      if (capabilities.resumeMechanism === 'file_injection') {
        const sourceLabel = source ?? 'stale-run-watchdog';
        const resultNodeId = await this.sessionHydration.appendSystemResultNode(
          parentTreeId,
          `wait_for_subagents interrupted by ${sourceLabel}; subagents cancelled; resuming.`,
        );
        return {
          kind: 'pi',
          treeId: parentTreeId,
          resumeNodeId: resultNodeId,
        };
      }

      return {
        kind: 'claude_code',
        sessionId: chatSessionRecord?.id ?? parentTreeId,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to build resume session ref for tree ${parentTreeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
