import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ContainerTier,
  getScopeId,
  IHostMountBinding,
  IJob,
  IToolPermissionPolicy,
  type HarnessId,
  type RuntimeToolchainConfig,
} from '@nexus/core';
import { resolveTriggerContext } from '../../shared/agent-scope.utils';
import { asRecord } from './step-support-context.helpers';
import { parseRunInputRuntimeToolchainConfig } from '../validation/workflow-validation.runtime-toolchains';
import Docker from 'dockerode';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { assertContainerSurvivedStartup } from '../../docker/container-orchestrator.helpers';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { StepEventPublisherService } from './step-event-publisher.service';
import { StepSupportService } from './step-support.service';
import { HostMountResolutionService } from '../workflow-host-mount/host-mount-resolution.service';
import { JobQueueData } from './step-execution.types';
import { resolveContainerIpAddress } from './step-agent-step-executor.helpers';
import {
  formatSkillMountDiagnostics,
  resolveAllowedSdkCodingToolsForAgent,
} from './step-agent-container-support.helpers';
import { buildProvisionedAgentContainerConfig } from './step-agent-container-provisioning.helpers';
import { HostMountAuditService } from '../workflow-host-mount/host-mount-audit.service';
import { requireJwtSecret } from '../../config/jwt-runtime-config';
import type { SkillLibraryRecord } from '../../ai-config/services/agent-skill-library.service.types';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';
import type { AgentProfile } from '../../ai-config/database/entities/agent-profile.entity';

@Injectable()
export class StepAgentContainerSupportService {
  private readonly logger = new Logger(StepAgentContainerSupportService.name);
  private readonly JWT_SECRET = requireJwtSecret();
  private static readonly SDK_CODING_TOOLS = [
    'read',
    'write',
    'edit',
    'bash',
    'ls',
    'find',
    'grep',
  ];

  constructor(
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly toolMounting: ToolMountingService,
    private readonly skillMounting: SkillMountingService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly aiConfig: AiConfigurationService,
    private readonly eventPublisher: StepEventPublisherService,
    private readonly support: StepSupportService,
    private readonly hostMountResolution: HostMountResolutionService,
    private readonly hostMountAudit: HostMountAuditService,
    private readonly harnessRegistry: HarnessProviderRegistryService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly toolchainResolver: ToolchainResolverService,
    private readonly harnessImageResolver: HarnessImageResolver,
    private readonly packageCacheVolumeService: PackageCacheVolumeService,
  ) {}

  async provisionJobContainer(
    data: JobQueueData,
    stateVariables: Record<string, unknown>,
    mountKey: string,
    harnessId: HarnessId,
    /**
     * The full profile ∪ workflow ∪ step effective skill set, already
     * resolved by the caller via the shared `resolveAgentAssignedSkills`
     * entry point (same resolver the prompt-injection path uses). When
     * supplied, the mount uses exactly this set instead of re-resolving a
     * profile-only list, so a bound (non-profile) skill lands on disk too.
     */
    preResolvedAssignedSkills?: SkillLibraryRecord[],
  ): Promise<string> {
    const { workflowRunId, jobId, job } = data;
    const stepId = this.resolvePrimaryStepId(job);
    const tier = this.support.getJobTier(job);
    const tools = await this.toolRegistry.getToolsForTier(tier);
    const filteredTools = this.support.selectToolsForJob(tools, job);
    const resolvedJobInputs = this.support.resolveJobInputs(
      job.inputs,
      stateVariables,
    );
    let agentProfile = this.support.resolveAgentProfileFromJobInputs(
      resolvedJobInputs,
      job,
    );
    const agentProfileEntity =
      await this.resolveCanonicalAgentProfile(agentProfile);
    agentProfile = agentProfileEntity?.name ?? agentProfile;
    const allowedToolNames = await this.support.resolveAllowedToolNames({
      tools: filteredTools,
      job,
      workflowPermissions: data.workflowPermissions,
      agentProfile,
    });
    const permissionFilteredTools = filteredTools.filter((tool) =>
      allowedToolNames.has(tool.name),
    );
    const hostMountPath = this.toolMounting.prepareToolMount(
      mountKey,
      permissionFilteredTools,
      agentProfile,
    );
    const hostMountBindings = await this.resolveProvisionHostMountBindings({
      data,
      stateVariables,
      agentProfile,
      workflowRunId,
      stepId,
      job,
    });
    const harnessEntry = this.harnessRegistry.resolve(harnessId);
    const containerId = await this.prepareRuntimeAndProvisionContainer({
      workflowRunId,
      jobId,
      stepId,
      tier,
      job,
      workflowPermissions: data.workflowPermissions,
      hostMountPath,
      hostMountBindings,
      agentProfile,
      agentProfileConfig: agentProfileEntity?.runtime_toolchains ?? undefined,
      stateVariables,
      mountKey,
      harnessId,
      harnessImageRef: harnessEntry.imageRef,
      harnessDefaultEnv: harnessEntry.defaultEnv,
      stepInputs: resolvedJobInputs,
      worktreePath:
        tier === ContainerTier.HEAVY
          ? await this.support.resolveWorktreePathFromTrigger(stateVariables)
          : undefined,
      preResolvedAssignedSkills,
    });
    await this.hostMountAudit.emitContainerLifecycle({
      eventName: 'workflow.host_mount.attached',
      outcome: 'success',
      workflowRunId,
      jobId,
      stepId,
      containerId,
      hostMountBindings,
    });

    return containerId;
  }

  async getContainerIpAddress(containerId: string): Promise<string> {
    return resolveContainerIpAddress(this.docker, containerId);
  }

  async startContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
    await assertContainerSurvivedStartup({ container });
  }

  async fetchContainerLogSnapshot(
    containerId: string,
    tail = 100,
  ): Promise<string> {
    return this.containerOrchestrator.fetchContainerLogSnapshot(
      containerId,
      tail,
    );
  }

  /** True only when Docker reports the container as actively running. */
  async isContainerRunning(containerId: string): Promise<boolean> {
    return (
      (await this.containerOrchestrator.getContainerRuntimeState(
        containerId,
      )) === 'running'
    );
  }

  private resolvePrimaryStepId(job: IJob): string {
    return Array.isArray(job.steps)
      ? (job.steps[0]?.id ?? 'default')
      : 'default';
  }

  async killStaleContainersForJob(
    workflowRunId: string,
    jobId: string,
  ): Promise<void> {
    try {
      const containers = await this.docker.listContainers({
        all: false,
        filters: {
          label: [
            'nexus.managed=true',
            `nexus.workflow_run_id=${workflowRunId}`,
            `nexus.job_id=${jobId}`,
          ],
          status: ['running'],
        },
      });

      for (const info of containers) {
        try {
          this.logger.warn(
            `Killing stale container ${info.Id} for run ${workflowRunId} job ${jobId}`,
          );
          const container = this.docker.getContainer(info.Id);
          await container.kill();
          await this.containerOrchestrator.removeContainer(info.Id, true);
        } catch {
          // best-effort: container may already be stopping
        }
      }
    } catch {
      // Docker API call failed - proceed without cleanup
    }
  }

  async cleanupJobResources(params: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    containerId: string | null;
    stopContainerLogStreaming: (() => void) | null;
    toolMountKey: string;
    skillMountKey: string;
    worktreePath?: string;
  }): Promise<void> {
    if (params.stopContainerLogStreaming) {
      try {
        params.stopContainerLogStreaming();
      } catch {
        // no-op
      }
    }

    if (params.containerId) {
      let hostMountBindings: IHostMountBinding[];
      try {
        hostMountBindings =
          await this.containerOrchestrator.getContainerHostMountBindings(
            params.containerId,
          );
      } catch {
        hostMountBindings = [];
      }

      try {
        await this.eventPublisher.publishProcessEvent(
          params.workflowRunId,
          'container_removing',
          {
            jobId: params.jobId,
            stepId: params.stepId,
            workflowRunId: params.workflowRunId,
            containerId: params.containerId,
          },
        );
        await this.containerOrchestrator.removeContainer(
          params.containerId,
          true,
        );
        await this.eventPublisher.publishProcessEvent(
          params.workflowRunId,
          'container_removed',
          {
            jobId: params.jobId,
            stepId: params.stepId,
            workflowRunId: params.workflowRunId,
            containerId: params.containerId,
          },
        );

        await this.hostMountAudit.emitContainerLifecycle({
          eventName: 'workflow.host_mount.removed',
          outcome: 'success',
          workflowRunId: params.workflowRunId,
          jobId: params.jobId,
          stepId: params.stepId,
          containerId: params.containerId,
          hostMountBindings,
        });
      } catch {
        // no-op
      }
    }

    if (params.worktreePath) {
      this.skillMounting.cleanupWorktreeSkills(
        params.worktreePath,
        params.skillMountKey,
      );
    }

    this.toolMounting.cleanupToolMount(params.toolMountKey);
    this.skillMounting.cleanupSkillMount(params.skillMountKey);
  }

  /**
   * Loads the canonical {@link AgentProfile} entity for the given profile
   * name, if one exists. Callers use `.name` for the canonical name and
   * `.runtime_toolchains` as the agent-profile layer of the toolchain
   * precedence chain (see `ToolchainResolverService.resolve`).
   */
  private async resolveCanonicalAgentProfile(
    agentProfile: string | undefined,
  ): Promise<AgentProfile | undefined> {
    if (!agentProfile) {
      return undefined;
    }

    const profileEntity =
      await this.aiConfig.getAgentProfileByName(agentProfile);
    return profileEntity ?? undefined;
  }

  private async resolveProvisionHostMountBindings(params: {
    data: JobQueueData;
    stateVariables: Record<string, unknown>;
    agentProfile?: string;
    workflowRunId: string;
    stepId: string;
    job: IJob;
  }): Promise<IHostMountBinding[]> {
    const hostMountOutcome =
      await this.hostMountResolution.resolveHostMountBindingsPreflight({
        job: params.job,
        workflowPermissions: params.data.workflowPermissions,
        agentProfile: params.agentProfile,
        stateVariables: params.stateVariables,
        workflowRunId: params.workflowRunId,
        stepId: params.stepId,
      });

    if (hostMountOutcome.status === 'approval_required') {
      throw new ForbiddenException(
        `Host mount write approval required for alias(es): ${hostMountOutcome.approvals_required
          .map((entry) => entry.alias)
          .join(', ')}`,
      );
    }

    return hostMountOutcome.bindings;
  }

  private async prepareRuntimeAndProvisionContainer(params: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    tier: ContainerTier;
    job: IJob;
    workflowPermissions?: IToolPermissionPolicy;
    hostMountPath: string;
    hostMountBindings: IHostMountBinding[];
    agentProfile?: string;
    /** Layer 2 of the toolchain precedence chain — the agent profile's `runtime_toolchains`. */
    agentProfileConfig?: RuntimeToolchainConfig;
    stateVariables: Record<string, unknown>;
    mountKey: string;
    worktreePath?: string;
    harnessId: HarnessId;
    harnessImageRef?: string;
    harnessDefaultEnv?: Record<string, string>;
    stepInputs: Record<string, unknown>;
    preResolvedAssignedSkills?: SkillLibraryRecord[];
  }): Promise<string> {
    const allowedCodingTools = resolveAllowedSdkCodingToolsForAgent({
      sdkCodingTools: StepAgentContainerSupportService.SDK_CODING_TOOLS,
      job: params.job,
      agentProfile: params.agentProfile,
      workflowPermissions: params.workflowPermissions,
      applyPolicyToToolNames: (allowed, available, policy) =>
        this.support.applyPolicyToToolNames(allowed, available, policy),
      canProfileUseTool: (profileName, toolName) =>
        this.toolMounting.canProfileUseTool(profileName, toolName),
    });
    this.writeToolRuntimeManifests({
      hostMountPath: params.hostMountPath,
      allowedCodingTools,
      hostMountBindings: params.hostMountBindings,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      workflowPermissions: params.workflowPermissions,
      jobPermissions: params.job.permissions,
    });

    const { assignedSkills, skillMountPath } =
      await this.resolveSkillMountForJob({
        agentProfile: params.agentProfile,
        stateVariables: params.stateVariables,
        mountKey: params.mountKey,
        workflowRunId: params.workflowRunId,
        preResolvedAssignedSkills: params.preResolvedAssignedSkills,
      });
    this.logger.log(
      formatSkillMountDiagnostics({
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        stepId: params.stepId,
        agentProfile: params.agentProfile,
        assignedSkillNames: assignedSkills.map((skill) => skill.name),
        skillMountPath,
      }),
    );

    if (skillMountPath && params.worktreePath) {
      this.skillMounting.populateWorktreeSkills(
        skillMountPath,
        params.worktreePath,
      );
    }

    const scopeId =
      getScopeId(resolveTriggerContext(params.stateVariables.trigger)) ??
      undefined;
    const runInputConfig = parseRunInputRuntimeToolchainConfig(
      asRecord(params.stateVariables.trigger),
    );

    return this.provisionContainer({
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      agentProfileName: params.agentProfile,
      agentProfileConfig: params.agentProfileConfig,
      scopeId,
      tier: params.tier,
      hostMountPath: params.hostMountPath,
      hostMountBindings: params.hostMountBindings,
      skillMountPath,
      worktreePath: params.worktreePath,
      harnessId: params.harnessId,
      harnessImageRef: params.harnessImageRef,
      harnessDefaultEnv: params.harnessDefaultEnv,
      stepInputs: params.stepInputs,
      runInputConfig,
    });
  }

  private writeToolRuntimeManifests(params: {
    hostMountPath: string;
    allowedCodingTools: string[];
    hostMountBindings: IHostMountBinding[];
    workflowRunId: string;
    jobId: string;
    stepId: string;
    workflowPermissions?: IToolPermissionPolicy;
    jobPermissions?: IToolPermissionPolicy;
  }): void {
    this.toolMounting.writeSdkToolAllowlist(
      params.hostMountPath,
      params.allowedCodingTools,
      {
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        stepId: params.stepId,
      },
    );
    this.toolMounting.writeHostMountScopeManifest(
      params.hostMountPath,
      params.hostMountBindings,
    );
  }

  /**
   * Resolves the skill set to mount to disk for a job's container. When the
   * caller already resolved the full profile ∪ workflow ∪ step effective set
   * (the same set the prompt-injection path assembles via the shared
   * `resolveAgentAssignedSkills` helper — see `step-agent-effective-skills
   * .helpers.ts`), that set is mounted directly and no further resolution
   * happens here, avoiding a redundant profile-only skill-library scan on
   * this hot path. Falls back to the legacy profile-only resolution only
   * when no pre-resolved set is available (e.g. a job with no steps).
   */
  private async resolveSkillMountForJob(params: {
    agentProfile?: string;
    stateVariables: Record<string, unknown>;
    mountKey: string;
    workflowRunId: string;
    preResolvedAssignedSkills?: SkillLibraryRecord[];
  }): Promise<{
    assignedSkills: SkillLibraryRecord[];
    skillMountPath: string | null;
  }> {
    const assignedSkills =
      params.preResolvedAssignedSkills ??
      (
        await this.support.resolveAssignedSkillsForProfile(
          params.agentProfile,
          {
            stateVariables: params.stateVariables,
            workflowRunId: params.workflowRunId,
          },
        )
      ).skills;

    return {
      assignedSkills,
      skillMountPath: this.skillMounting.prepareSkillMount(
        params.mountKey,
        assignedSkills,
      ),
    };
  }

  private async provisionContainer(params: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    agentProfileName?: string;
    /** Layer 2 of the toolchain precedence chain — the agent profile's `runtime_toolchains`. */
    agentProfileConfig?: RuntimeToolchainConfig;
    scopeId?: string;
    tier: ContainerTier;
    hostMountPath: string;
    hostMountBindings: IHostMountBinding[];
    skillMountPath?: string | null;
    worktreePath?: string;
    harnessId: HarnessId;
    harnessImageRef?: string;
    harnessDefaultEnv?: Record<string, string>;
    stepInputs: Record<string, unknown>;
    runInputConfig?: RuntimeToolchainConfig;
  }): Promise<string> {
    const finalConfig = await buildProvisionedAgentContainerConfig({
      ...params,
      jwtSecret: this.JWT_SECRET,
      harnessRegistry: this.harnessRegistry,
      resolver: this.toolchainResolver,
      imageResolver: this.harnessImageResolver,
      cacheService: this.packageCacheVolumeService,
    });

    return this.containerOrchestrator.provisionContainer(
      finalConfig,
      false,
      true,
      params.worktreePath,
    );
  }
}
