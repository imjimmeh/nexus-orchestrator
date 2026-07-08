import {
  ContainerTier,
  CONTAINER_AGENT_DIR,
  CONTAINER_CHECKPOINT_PATH,
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
  IContainerConfig,
  IHostMountBinding,
  type HarnessId,
} from '@nexus/core';
import { signAgentToken } from '../../auth/sign-agent-token';
import { CONTAINER_SKILLS_ROOT } from '../../tool-runtime/skill-mounting.constants';

interface BuildAgentContainerConfigParams {
  workflowRunId: string;
  jobId: string;
  stepId: string;
  agentProfileName?: string;
  scopeId?: string | null;
  tier: ContainerTier;
  hostMountPath: string;
  hostMountBindings: IHostMountBinding[];
  skillMountPath?: string | null;
  jwtSecret: string;
  harnessId: HarnessId;
  harnessImageRef?: string;
  harnessDefaultEnv?: Record<string, string>;
  /** Container path where skills should be mounted. */
  containerSkillsPath?: string;
  /**
   * When provided, binds this host directory into the container at
   * {@link CONTAINER_AGENT_DIR} (read-write) and sets the
   * `SESSION_CHECKPOINT_PATH` env var to {@link CONTAINER_CHECKPOINT_PATH}.
   * When absent, neither the volume nor the env var is emitted (feature inert).
   */
  checkpointHostDir?: string;
}

const DEFAULT_WEBSOCKET_URL = 'http://host.docker.internal:3001';
const DEFAULT_API_BASE_URL = 'http://nexus-api:3000';

export function buildAgentContainerConfig(
  params: BuildAgentContainerConfigParams,
): IContainerConfig {
  const token = signAgentToken(
    {
      sub: `agent:${params.workflowRunId}:${params.jobId}`,
      workflowRunId: params.workflowRunId,
      role: 'agent',
      stepId: params.stepId,
      jobId: params.jobId,
      agentProfileName: params.agentProfileName,
      ...(params.scopeId ? { scopeId: params.scopeId } : {}),
      roles: ['Agent'],
    },
    params.jwtSecret,
  );

  const image =
    params.harnessImageRef ??
    (params.tier === ContainerTier.HEAVY
      ? 'nexus-heavy:latest'
      : 'nexus-light:latest');

  const skillVolumes = params.skillMountPath
    ? [
        {
          hostPath: params.skillMountPath,
          containerPath: params.containerSkillsPath ?? CONTAINER_SKILLS_ROOT,
          readOnly: true,
        },
      ]
    : [];

  const checkpointVolumes = params.checkpointHostDir
    ? [
        {
          // Bind the host sidecar directory to the container agent dir so the
          // harness can write checkpoints.jsonl alongside session.jsonl.
          hostPath: params.checkpointHostDir,
          containerPath: CONTAINER_AGENT_DIR,
          readOnly: false,
        },
      ]
    : [];

  return {
    image,
    tier: params.tier,
    env: {
      ...(params.harnessDefaultEnv ?? {}),
      WORKFLOW_RUN_ID: params.workflowRunId,
      JOB_ID: params.jobId,
      STEP_ID: params.stepId,
      AGENT_JWT: token,
      WEBSOCKET_URL: process.env.WEBSOCKET_URL || DEFAULT_WEBSOCKET_URL,
      API_BASE_URL: process.env.API_BASE_URL || DEFAULT_API_BASE_URL,
      WORKSPACE_PATH: '/workspace',
      EXTENSIONS_PATH: CONTAINER_EXTENSIONS_PATH,
      SESSION_PATH: CONTAINER_SESSION_PATH,
      HARNESS_ID: params.harnessId,
      // Forward the opt-in credential delivery mode so the in-container engine
      // can select file-based (~/.claude/.credentials.json) auth. Unset on the
      // API means the engine keeps its default env-token delivery.
      ...(process.env.CLAUDE_CODE_AUTH_DELIVERY
        ? { CLAUDE_CODE_AUTH_DELIVERY: process.env.CLAUDE_CODE_AUTH_DELIVERY }
        : {}),
      // When the checkpoint sidecar directory is provided, activate the harness
      // FileSidecarSink by pointing it at the in-container file path.
      ...(params.checkpointHostDir
        ? { SESSION_CHECKPOINT_PATH: CONTAINER_CHECKPOINT_PATH }
        : {}),
    },
    volumes: [
      {
        hostPath: params.hostMountPath,
        containerPath: CONTAINER_EXTENSIONS_PATH,
        readOnly: true,
      },
      ...params.hostMountBindings.map((binding) => ({
        hostPath: binding.hostPath,
        containerPath: binding.containerPath,
        readOnly: binding.readOnly,
      })),
      ...skillVolumes,
      ...checkpointVolumes,
    ],
    workingDir: '/workspace',
    labels: {
      'nexus.managed': 'true',
      'nexus.workflow_run_id': params.workflowRunId,
      'nexus.job_id': params.jobId,
      'nexus.step_id': params.stepId,
      'nexus.tier': params.tier,
    },
  };
}
