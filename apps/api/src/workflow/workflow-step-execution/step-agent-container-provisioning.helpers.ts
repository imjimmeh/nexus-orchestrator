import * as fs from 'node:fs';
import {
  ContainerTier,
  IContainerConfig,
  IHostMountBinding,
  type HarnessId,
  type RuntimeToolchainConfig,
} from '@nexus/core';
import {
  checkpointSidecarHostDir,
  resolveCheckpointBaseDir,
} from '../workflow-session-checkpoint/checkpoint-sidecar-path';
import { isSessionCheckpointResumeEnabled } from '../../config/session-checkpoint.config';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';
import { parseStepRuntimeToolchainConfig } from '../validation/workflow-validation.runtime-toolchains';
import { buildAgentContainerConfig } from './step-agent-container-config.helpers';
import { applyRuntimeToolchains } from './step-agent-container-support.runtime-toolchains';

/**
 * Resolves the checkpoint sidecar host directory and creates it when session
 * checkpoint resume is enabled; otherwise a no-op (feature stays inert).
 */
function prepareCheckpointHostDir(
  workflowRunId: string,
  jobId: string,
): string | undefined {
  if (!isSessionCheckpointResumeEnabled()) return undefined;

  const checkpointHostDir = checkpointSidecarHostDir(
    resolveCheckpointBaseDir(),
    workflowRunId,
    jobId,
  );
  fs.mkdirSync(checkpointHostDir, { recursive: true });
  return checkpointHostDir;
}

/**
 * Builds the fully-provisioned {@link IContainerConfig} for a step's agent
 * container: the base config (env/volumes/labels/JWT) via
 * {@link buildAgentContainerConfig}, then the resolved runtime toolchain
 * image and package/OS cache mounts via {@link applyRuntimeToolchains}.
 * Consolidates the orchestration so `StepAgentContainerSupportService` stays
 * a thin caller.
 */
export async function buildProvisionedAgentContainerConfig(params: {
  workflowRunId: string;
  jobId: string;
  stepId: string;
  agentProfileName?: string;
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
  /** Layer 2 of the toolchain precedence chain — the agent profile's `runtime_toolchains`. */
  agentProfileConfig?: RuntimeToolchainConfig;
  /** Layer 3 of the toolchain precedence chain — the neutral `runtime_toolchains` run input. */
  runInputConfig?: RuntimeToolchainConfig;
  jwtSecret: string;
  harnessRegistry: HarnessProviderRegistryService;
  resolver: ToolchainResolverService;
  imageResolver: HarnessImageResolver;
  cacheService: PackageCacheVolumeService;
}): Promise<IContainerConfig> {
  const checkpointHostDir = prepareCheckpointHostDir(
    params.workflowRunId,
    params.jobId,
  );
  const capabilities = params.harnessRegistry.resolve(
    params.harnessId,
  ).capabilities;

  const config = buildAgentContainerConfig({
    workflowRunId: params.workflowRunId,
    jobId: params.jobId,
    stepId: params.stepId,
    agentProfileName: params.agentProfileName,
    scopeId: params.scopeId,
    tier: params.tier,
    hostMountPath: params.hostMountPath,
    hostMountBindings: params.hostMountBindings,
    skillMountPath: params.skillMountPath,
    jwtSecret: params.jwtSecret,
    harnessId: params.harnessId,
    harnessImageRef: params.harnessImageRef,
    harnessDefaultEnv: params.harnessDefaultEnv,
    containerSkillsPath: capabilities.skillsContainerPath,
    checkpointHostDir,
  });

  const baseImageRef =
    params.harnessImageRef ??
    (params.tier === ContainerTier.HEAVY
      ? 'nexus-heavy:latest'
      : 'nexus-light:latest');

  return applyRuntimeToolchains({
    config,
    harnessId: params.harnessId,
    baseImageRef,
    resolverInputs: {
      stepConfig: parseStepRuntimeToolchainConfig(params.stepInputs),
      agentProfileConfig: params.agentProfileConfig,
      runInputConfig: params.runInputConfig,
      workspacePath: params.worktreePath,
    },
    resolver: params.resolver,
    imageResolver: params.imageResolver,
    cacheService: params.cacheService,
  });
}
