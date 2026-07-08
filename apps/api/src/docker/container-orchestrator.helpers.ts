import type Docker from 'dockerode';
import {
  DEFAULT_CHECKPOINT_BASE_DIR,
  type IContainerConfig,
} from '@nexus/core';
import * as path from 'node:path';

const DEFAULT_TOOL_MOUNT_BASE_PATH = path.join('/tmp', 'nexus-tools');
const DEFAULT_API_HOST_SHARE_BASE_PATH = path.join(
  '/data',
  'nexus-host-shares',
);
export const HOST_SHARE_CONTAINER_ROOT = '/workspace/host-shares';

type ContainerVolumeMount = {
  hostPath: string;
  containerPath: string;
  readOnly?: boolean;
};

type ResourceLimits = {
  Memory: number;
  NanoCpus: number;
  MemorySwap: number;
};

export const POST_START_INSPECTION_DELAY_MS = 1_500;

interface ContainerStartInspectResult {
  State?: {
    Status?: string;
    ExitCode?: number;
    Error?: string;
  };
}

export async function assertContainerSurvivedStartup(params: {
  container: {
    id: string;
    inspect: () => Promise<ContainerStartInspectResult>;
  };
  delayMs?: number;
}): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, params.delayMs ?? POST_START_INSPECTION_DELAY_MS);
  });

  const inspected = await params.container.inspect();
  const status = inspected.State?.Status;
  const healthyStatuses = new Set(['running', 'created', 'restarting']);
  if (status && healthyStatuses.has(status)) {
    return;
  }

  const detailParts = [
    `status=${status ?? 'unknown'}`,
    `exit_code=${String(inspected.State?.ExitCode ?? 'unknown')}`,
  ];
  const rawError = inspected.State?.Error;
  const error = typeof rawError === 'string' ? rawError.trim() : '';
  if (error.length > 0) {
    detailParts.push(`error=${error}`);
  }

  throw new Error(
    `Container ${params.container.id} exited shortly after start (${detailParts.join(', ')})`,
  );
}

export function normalizePath(targetPath: string): string {
  return targetPath.replaceAll('\\', '/').replace(/\/+$/, '');
}

export function toRelativePath(pathFragment: string): string {
  return pathFragment.replace(/^[\\/]+/, '');
}

export function joinDockerHostPath(
  basePath: string,
  relativePath: string,
): string {
  const normalizedBase = basePath.replace(/[\\/]+$/, '');
  if (!relativePath) {
    return normalizedBase;
  }

  const normalizedRelative = relativePath.replaceAll('\\', '/');
  return `${normalizedBase}/${normalizedRelative}`;
}

export function resolveDockerWorktreeHostPath(params: {
  worktreePath: string;
  workspaceBasePath: string;
  hostWorkspacePath: string;
}): string {
  if (
    !params.hostWorkspacePath ||
    !params.worktreePath.startsWith(params.workspaceBasePath)
  ) {
    return params.worktreePath;
  }

  const relativePath = toRelativePath(
    params.worktreePath.slice(params.workspaceBasePath.length),
  );

  return joinDockerHostPath(params.hostWorkspacePath, relativePath);
}

export function resolveDockerVolumeHostPath(params: {
  hostPath: string;
  hostToolMountPath?: string;
  toolMountBasePath?: string;
  hostSkillsLibraryPath?: string;
  apiSkillsLibraryPath: string;
  hostShareMountPath?: string;
  apiHostShareBasePath?: string;
  hostCheckpointPath?: string;
  checkpointBasePath?: string;
}): string {
  const toolResolved = resolveDockerToolMountHostPath({
    hostPath: params.hostPath,
    hostToolMountPath: params.hostToolMountPath,
    toolMountBasePath: params.toolMountBasePath,
  });
  const skillsResolved = resolveDockerSkillsLibraryHostPath({
    hostPath: toolResolved,
    hostSkillsLibraryPath: params.hostSkillsLibraryPath,
    apiSkillsLibraryPath: params.apiSkillsLibraryPath,
  });
  const shareResolved = resolveDockerHostShareMountHostPath({
    hostPath: skillsResolved,
    hostShareMountPath: params.hostShareMountPath,
    apiHostShareBasePath: params.apiHostShareBasePath,
  });

  return resolveDockerCheckpointHostPath({
    hostPath: shareResolved,
    hostCheckpointPath: params.hostCheckpointPath,
    checkpointBasePath: params.checkpointBasePath,
  });
}

export function isHostShareContainerPath(containerPath: string): boolean {
  return (
    containerPath === HOST_SHARE_CONTAINER_ROOT ||
    containerPath.startsWith(`${HOST_SHARE_CONTAINER_ROOT}/`)
  );
}

export function resolveHostShareAlias(containerPath: string): string | null {
  const relativePath = path.posix.relative(
    HOST_SHARE_CONTAINER_ROOT,
    containerPath,
  );
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }

  const alias = relativePath.split('/')[0]?.trim();
  return alias && alias.length > 0 ? alias : null;
}

function resolveDockerToolMountHostPath(params: {
  hostPath: string;
  hostToolMountPath?: string;
  toolMountBasePath?: string;
}): string {
  if (!params.hostToolMountPath) {
    return params.hostPath;
  }

  const toolMountBasePath =
    params.toolMountBasePath ?? DEFAULT_TOOL_MOUNT_BASE_PATH;

  if (!params.hostPath.startsWith(toolMountBasePath)) {
    return params.hostPath;
  }

  const relativePath = toRelativePath(
    params.hostPath.slice(toolMountBasePath.length),
  );

  return joinDockerHostPath(params.hostToolMountPath, relativePath);
}

function resolveDockerSkillsLibraryHostPath(params: {
  hostPath: string;
  hostSkillsLibraryPath?: string;
  apiSkillsLibraryPath: string;
}): string {
  if (!params.hostSkillsLibraryPath) {
    return params.hostPath;
  }

  if (!params.hostPath.startsWith(params.apiSkillsLibraryPath)) {
    return params.hostPath;
  }

  const relativePath = toRelativePath(
    params.hostPath.slice(params.apiSkillsLibraryPath.length),
  );

  return joinDockerHostPath(params.hostSkillsLibraryPath, relativePath);
}

function resolveDockerHostShareMountHostPath(params: {
  hostPath: string;
  hostShareMountPath?: string;
  apiHostShareBasePath?: string;
}): string {
  if (!params.hostShareMountPath) {
    return params.hostPath;
  }

  const apiHostShareBasePath =
    params.apiHostShareBasePath ?? DEFAULT_API_HOST_SHARE_BASE_PATH;

  if (!params.hostPath.startsWith(apiHostShareBasePath)) {
    return params.hostPath;
  }

  const relativePath = toRelativePath(
    params.hostPath.slice(apiHostShareBasePath.length),
  );

  return joinDockerHostPath(params.hostShareMountPath, relativePath);
}

function resolveDockerCheckpointHostPath(params: {
  hostPath: string;
  hostCheckpointPath?: string;
  checkpointBasePath?: string;
}): string {
  if (!params.hostCheckpointPath) {
    return params.hostPath;
  }

  const checkpointBasePath =
    params.checkpointBasePath ?? DEFAULT_CHECKPOINT_BASE_DIR;

  if (!params.hostPath.startsWith(checkpointBasePath)) {
    return params.hostPath;
  }

  const relativePath = toRelativePath(
    params.hostPath.slice(checkpointBasePath.length),
  );

  return joinDockerHostPath(params.hostCheckpointPath, relativePath);
}

export function upsertVolume(
  volumes: ContainerVolumeMount[],
  volume: ContainerVolumeMount,
): void {
  const index = volumes.findIndex(
    (candidate) => candidate.containerPath === volume.containerPath,
  );
  if (index >= 0) {
    volumes[index] = volume;
    return;
  }

  volumes.push(volume);
}

export function buildContainerCreateOptions(params: {
  config: IContainerConfig;
  binds: string[];
  env: string[];
  resourceLimits: ResourceLimits;
  enableNetwork: boolean;
  worktreePath?: string;
  configuredContainerUser?: string;
  defaultNetworkMode: string;
}): Docker.ContainerCreateOptions {
  return {
    Image: params.config.image,
    Env: params.env,
    Labels: {
      'nexus.managed': 'true',
      'nexus.tier': params.config.tier,
      ...params.config.labels,
    },
    ...(params.config.workingDir || params.worktreePath
      ? { WorkingDir: params.config.workingDir || '/workspace' }
      : {}),
    ...(params.configuredContainerUser
      ? { User: params.configuredContainerUser }
      : {}),
    HostConfig: {
      Binds: params.binds,
      ...params.resourceLimits,
      NetworkMode: params.enableNetwork ? params.defaultNetworkMode : 'none',
    },
  };
}
