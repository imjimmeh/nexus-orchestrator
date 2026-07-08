import type { HarnessRuntimeConfig } from '@nexus/core';

export interface ContainerAgentRequest {
  provider: string;
  model: string;
  auth: HarnessRuntimeConfig['model']['auth'];
  apiKey?: string;
  baseUrl?: string;
  providerConfig?: HarnessRuntimeConfig['model']['providerConfig'];
  systemPrompt: string;
  initialPrompt?: string;
  temperature?: number;
  thinkingLevel?: HarnessRuntimeConfig['model']['thinkingLevel'];
  stepId: string;
  background?: boolean;
  mode?: 'async' | 'sync';
}

export interface ContainerAgentResponse {
  ok: boolean;
  response: string;
  error?: string;
  usage?: unknown;
  /** SDK session id produced during this turn, present only for Claude Code engine runs. */
  producedSessionId?: string;
}

export interface ContainerCommandRequest {
  command: string;
  timeoutMs?: number;
  workingDir?: string;
  stepId?: string;
}

export interface ContainerCommandResponse {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

/**
 * Optional diagnostics/liveness hooks for `ContainerHttpClientService.waitForHealth`.
 * `isContainerRunning` lets the wait loop fail fast on a container that has
 * already exited instead of waiting out the full timeout.
 */
export interface HealthCheckDiagnostics {
  containerId: string;
  fetchLogs: () => Promise<string>;
  isContainerRunning?: () => Promise<boolean>;
}
