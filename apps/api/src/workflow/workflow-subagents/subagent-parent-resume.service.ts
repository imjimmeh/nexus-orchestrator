import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ContainerTier, IContainerConfig } from '@nexus/core';
import { signAgentToken } from '../../auth/sign-agent-token';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { PiSessionTreeRepository } from '../../runtime/database/repositories/pi-session-tree.repository';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { resolveWorktreePathFromRun } from './subagent-orchestrator.utils';
import {
  CHAT_SESSION_DOMAIN_PORT,
  type ChatSessionDomainPort,
} from '../domain-ports';

@Injectable()
export class SubagentParentResumeService {
  private readonly logger = new Logger(SubagentParentResumeService.name);

  constructor(
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    private readonly sessionTreeRepo: PiSessionTreeRepository,
    private readonly aiConfig: AiConfigurationService,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly containerOrchestrator: ContainerOrchestratorService,
  ) {}

  async resumeParentAfterSubagent(
    parentSessionTreeId: string,
    result: Record<string, unknown>,
    jwtSecret: string,
  ): Promise<void> {
    const sessionTree = await this.requireSessionTree(parentSessionTreeId);

    if (!sessionTree.workflow_run_id) {
      throw new Error(
        `Session tree ${parentSessionTreeId} has no workflow_run_id — cannot resume parent`,
      );
    }

    const parentWorkflowRunId = sessionTree.workflow_run_id;
    const tier = this.toContainerTier(sessionTree.container_tier);
    const resultNodeId = await this.sessionHydration.appendSystemResultNode(
      parentSessionTreeId,
      `Subagent completed with result: ${JSON.stringify(result)}`,
      sessionTree.last_leaf_node_id || undefined,
    );

    const parentStepId = parentSessionTreeId;
    const parentToken = this.buildParentToken(
      parentWorkflowRunId,
      parentStepId,
      jwtSecret,
    );

    await this.storeResumeRunnerConfig(
      parentWorkflowRunId,
      parentStepId,
      resultNodeId,
    );

    const parentContainerId = await this.provisionParentContainer(
      parentWorkflowRunId,
      parentStepId,
      parentToken,
      tier,
    );

    await this.sessionHydration.rehydrateSession(
      parentSessionTreeId,
      parentContainerId,
      resultNodeId,
    );

    this.logger.log(
      `Rehydrated parent session ${parentSessionTreeId} into ${parentContainerId}`,
    );
  }

  private async requireSessionTree(parentSessionTreeId: string) {
    const sessionTree =
      await this.sessionTreeRepo.findById(parentSessionTreeId);
    if (!sessionTree) {
      throw new BadRequestException(
        `Session tree ${parentSessionTreeId} not found`,
      );
    }

    return sessionTree;
  }

  private toContainerTier(containerTier: number): ContainerTier {
    return containerTier === 2 ? ContainerTier.HEAVY : ContainerTier.LIGHT;
  }

  private buildParentToken(
    workflowRunId: string,
    parentStepId: string,
    jwtSecret: string,
  ): string {
    return signAgentToken(
      {
        sub: `agent:${workflowRunId}:${parentStepId}`,
        workflowRunId,
        role: 'agent',
        roles: ['Agent'],
        stepId: parentStepId,
        jobId: parentStepId,
        resumedFromSubagent: true,
      },
      jwtSecret,
    );
  }

  private async storeResumeRunnerConfig(
    workflowRunId: string,
    parentStepId: string,
    resultNodeId: string,
  ): Promise<void> {
    const sessionModel = await this.aiConfig.getModelForUseCase('session');
    const providerConfig = await this.aiConfig.resolveRunnerProviderConfig({
      modelName: sessionModel,
    });

    await this.runnerConfigStore.store(workflowRunId, parentStepId, {
      harnessId: 'pi',
      model: {
        provider: providerConfig.provider,
        model: sessionModel,
        auth: providerConfig.auth,
        baseUrl: providerConfig.baseUrl,
        providerConfig: providerConfig.providerConfig,
      },
      prompt: {
        systemPrompt: 'Continue execution from updated session tree state.',
      },
      session: {
        resumeNodeId: resultNodeId,
      },
    });
  }

  private async provisionParentContainer(
    workflowRunId: string,
    parentStepId: string,
    parentToken: string,
    tier: ContainerTier,
  ): Promise<string> {
    const run = await this.runRepo.findById(workflowRunId);
    const worktreePath = resolveWorktreePathFromRun(run);
    const config = this.buildParentContainerConfig(
      workflowRunId,
      parentStepId,
      parentToken,
      tier,
    );

    return this.containerOrchestrator.provisionContainer(
      config,
      false,
      false,
      worktreePath,
    );
  }

  private buildParentContainerConfig(
    workflowRunId: string,
    parentStepId: string,
    parentToken: string,
    tier: ContainerTier,
  ): IContainerConfig {
    return {
      image:
        tier === ContainerTier.HEAVY
          ? 'nexus-heavy:latest'
          : 'nexus-light:latest',
      tier,
      env: {
        WORKFLOW_RUN_ID: workflowRunId,
        STEP_ID: parentStepId,
        AGENT_JWT: parentToken,
        WEBSOCKET_URL:
          process.env.WEBSOCKET_URL || 'http://host.docker.internal:3001',
      },
      labels: {
        'nexus.managed': 'true',
        'nexus.workflow_run_id': workflowRunId,
        'nexus.tier': tier,
        'nexus.resumed': 'true',
      },
    };
  }
}
