import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  ContainerState,
  ContainerTier,
  type IContainerConfig,
} from '@nexus/core';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import type {
  PluginContainerRuntimeClient,
  PluginContainerRuntimeConfig,
} from './plugin-container-runtime.types';
import type {
  PluginRuntimeAdapter,
  PluginRuntimeBaseRequest,
  PluginRuntimeError,
  PluginRuntimeEventDeliveryRequest,
  PluginRuntimeHealthCheckResult,
  PluginRuntimeInvokeRequest,
  PluginRuntimeOperationResult,
  PluginRuntimeShutdownRequest,
  PluginRuntimeStartRequest,
} from './plugin-runtime.types';

export const PLUGIN_CONTAINER_RUNTIME_CLIENT = Symbol(
  'PLUGIN_CONTAINER_RUNTIME_CLIENT',
);
export const PLUGIN_CONTAINER_RUNTIME_ENV = Symbol(
  'PLUGIN_CONTAINER_RUNTIME_ENV',
);

const CONTAINER_RUNTIME_ENABLED_ENV = 'PLUGIN_CONTAINER_RUNTIME_ENABLED';
const CONTAINER_RUNTIME_ALLOW_NETWORK_ENV =
  'PLUGIN_CONTAINER_RUNTIME_ALLOW_NETWORK';
const DEFAULT_CONTAINER_TIMEOUT_MS = 30_000;
const SECRET_ENV_KEY_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)/iu;

type ContainerRuntimeStartRequest = PluginRuntimeStartRequest & {
  readonly container?: PluginContainerRuntimeConfig;
};

interface ContainerRuntimeProcess {
  readonly containerId: string;
  readonly pluginId: string;
  readonly version: string;
  readonly status: 'active' | 'cleanup_only';
}

class DisabledPluginContainerRuntimeClient implements PluginContainerRuntimeClient {
  startSession(): Promise<PluginRuntimeOperationResult> {
    return Promise.resolve(containerRuntimeClientUnavailable());
  }

  invoke(): Promise<PluginRuntimeOperationResult> {
    return Promise.resolve(containerRuntimeClientUnavailable());
  }

  deliverEvent(): Promise<PluginRuntimeOperationResult> {
    return Promise.resolve(containerRuntimeClientUnavailable());
  }

  healthCheck(): Promise<PluginRuntimeHealthCheckResult> {
    return Promise.resolve(containerRuntimeClientUnavailable());
  }

  shutdown(): Promise<PluginRuntimeOperationResult> {
    return Promise.resolve(containerRuntimeClientUnavailable());
  }
}

@Injectable()
export class PluginContainerRuntimeAdapter implements PluginRuntimeAdapter {
  readonly mode = 'container' as const;

  private readonly runtimes = new Map<string, ContainerRuntimeProcess>();
  private readonly startQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly containerOrchestrator: ContainerOrchestratorService,
    @Optional()
    @Inject(PLUGIN_CONTAINER_RUNTIME_CLIENT)
    private readonly runtimeClient: PluginContainerRuntimeClient = new DisabledPluginContainerRuntimeClient(),
    @Optional()
    @Inject(PLUGIN_CONTAINER_RUNTIME_ENV)
    private readonly sourceEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  async start(
    request: ContainerRuntimeStartRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const key = this.runtimeKey(request);
    const previousStart = this.startQueues.get(key) ?? Promise.resolve();
    const currentStart = previousStart.then(
      () => this.startAfterPrevious(request, key),
      () => this.startAfterPrevious(request, key),
    );
    const queueTail = currentStart.then(
      () => undefined,
      () => undefined,
    );
    this.startQueues.set(key, queueTail);

    try {
      return await currentStart;
    } finally {
      if (this.startQueues.get(key) === queueTail) {
        this.startQueues.delete(key);
      }
    }
  }

  private async startAfterPrevious(
    request: ContainerRuntimeStartRequest,
    key: string,
  ): Promise<PluginRuntimeOperationResult> {
    if (!this.isEnabled()) return this.unavailable();

    const containerConfig = this.buildContainerConfig(request);
    if (!containerConfig.ok) return containerConfig;

    const existingRuntime = this.runtimes.get(key);
    if (existingRuntime) {
      const cleanup = await this.cleanupRuntime(existingRuntime);
      if (!cleanup.ok) return cleanup;
      this.runtimes.delete(key);
    }

    let containerId: string;
    try {
      containerId = await this.containerOrchestrator.provisionContainer(
        containerConfig.value.config,
        true,
        containerConfig.value.enableNetwork,
        undefined,
      );
    } catch {
      return this.safeError(
        'container_start_failed',
        'Plugin container failed to start.',
        true,
      );
    }

    const runtime = {
      containerId,
      pluginId: request.pluginId,
      version: request.version,
      status: 'active' as const,
    };
    this.runtimes.set(key, runtime);

    const startup = await this.callRuntimeClient(
      () =>
        this.runtimeClient.startSession({
          containerId,
          pluginId: request.pluginId,
          version: request.version,
          timeoutMs: request.timeoutMs ?? containerConfig.value.timeoutMs,
        }),
      'container_start_failed',
      'Plugin container failed to start.',
      request.timeoutMs ?? containerConfig.value.timeoutMs,
    );

    if (!startup.ok) {
      const cleanup = await this.cleanupRuntime(runtime);
      if (cleanup.ok) {
        this.runtimes.delete(key);
      } else {
        this.runtimes.set(key, { ...runtime, status: 'cleanup_only' });
      }
    }

    return startup;
  }

  async invoke(
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult> {
    if (!this.isEnabled()) return this.unavailable();

    const runtime = this.getRuntime(request);
    if (!runtime.ok) return runtime;

    return this.callRuntimeClient(
      () => this.runtimeClient.invoke(runtime.value.containerId, request),
      'container_invocation_failed',
      'Plugin container invocation failed.',
      request.timeoutMs,
    );
  }

  async deliverEvent(
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult> {
    if (!this.isEnabled()) return this.unavailable();

    const runtime = this.getRuntime(request);
    if (!runtime.ok) return runtime;

    return this.callRuntimeClient(
      () => this.runtimeClient.deliverEvent(runtime.value.containerId, request),
      'container_event_delivery_failed',
      'Plugin container event delivery failed.',
      request.timeoutMs,
    );
  }

  async healthCheck(
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult> {
    if (!this.isEnabled()) return this.unavailable();

    const runtime = this.getRuntime(request);
    if (!runtime.ok) return runtime;

    try {
      const status = await this.containerOrchestrator.getContainerStatus(
        runtime.value.containerId,
      );
      if (status.state !== ContainerState.RUNNING) {
        return this.safeError(
          'container_crashed',
          'Plugin container is not running.',
          true,
        );
      }
    } catch {
      return this.safeError(
        'container_health_failed',
        'Plugin container health check failed.',
        true,
      );
    }

    return this.callRuntimeClient(
      () => this.runtimeClient.healthCheck(runtime.value.containerId, request),
      'container_health_failed',
      'Plugin container health check failed.',
      request.timeoutMs,
    );
  }

  async shutdown(
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult> {
    if (!this.isEnabled()) return this.unavailable();

    const runtime = this.runtimes.get(this.runtimeKey(request));
    if (!runtime) return { ok: true };

    const shutdown =
      runtime.status === 'cleanup_only'
        ? { ok: true as const }
        : await this.callRuntimeClient(
            () => this.runtimeClient.shutdown(runtime.containerId, request),
            'container_shutdown_failed',
            'Plugin container shutdown failed.',
            request.deadlineMs,
          );
    const cleanup = await this.cleanupRuntime(runtime);
    if (cleanup.ok) {
      this.runtimes.delete(this.runtimeKey(request));
    }

    if (!shutdown.ok) return shutdown;
    if (!cleanup.ok) return cleanup;

    return { ok: true };
  }

  private buildContainerConfig(request: ContainerRuntimeStartRequest):
    | {
        readonly ok: true;
        readonly value: {
          readonly config: IContainerConfig;
          readonly enableNetwork: boolean;
          readonly timeoutMs?: number;
        };
      }
    | { readonly ok: false; readonly error: PluginRuntimeError } {
    const runtimeConfig = request.container;
    const image = runtimeConfig?.image?.trim();
    if (!image) {
      return this.safeError(
        'container_config_invalid',
        'Plugin container runtime requires an explicit image.',
        false,
      );
    }

    const validation = this.validateRuntimeConfig(runtimeConfig);
    if (!validation.ok) return validation;

    return {
      ok: true,
      value: {
        config: {
          image,
          tier: runtimeConfig?.tier ?? ContainerTier.LIGHT,
          env: {},
          volumes: runtimeConfig?.volumes ?? [],
          labels: {
            'nexus.managed': 'true',
            'nexus.runtime': 'plugin-container',
            'nexus.plugin.id': request.pluginId,
            'nexus.plugin.version': request.version,
          },
        },
        enableNetwork: runtimeConfig?.allowNetwork === true,
        timeoutMs: runtimeConfig?.timeoutMs,
      },
    };
  }

  private validateRuntimeConfig(
    runtimeConfig: PluginContainerRuntimeConfig | undefined,
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: PluginRuntimeError } {
    if ((runtimeConfig?.volumes?.length ?? 0) > 0) {
      return this.safeError(
        'container_config_invalid',
        'Plugin container runtime does not allow host volume mounts.',
        false,
      );
    }

    if (this.hasEnvPassthrough(runtimeConfig?.env)) {
      return this.safeError(
        'container_config_invalid',
        this.hasSecretLikeEnvKey(runtimeConfig?.env)
          ? 'Plugin container runtime does not allow secret-like env keys.'
          : 'Plugin container runtime does not allow env passthrough.',
        false,
      );
    }

    if (runtimeConfig?.allowNetwork === true && !this.isNetworkEnabled()) {
      return this.safeError(
        'container_config_invalid',
        'Plugin container runtime network access is not enabled.',
        false,
      );
    }

    return { ok: true };
  }

  private async callRuntimeClient<
    T extends PluginRuntimeOperationResult | PluginRuntimeHealthCheckResult,
  >(
    operation: () => Promise<T>,
    failureCode: string,
    failureMessage: string,
    timeoutMs = DEFAULT_CONTAINER_TIMEOUT_MS,
  ): Promise<T> {
    try {
      const result = await this.withTimeout(operation(), timeoutMs);
      if (!result.ok) {
        return this.safeError(failureCode, failureMessage, true) as T;
      }

      return result;
    } catch (error) {
      return this.safeError(
        this.isTimeoutError(error) ? 'container_timeout' : failureCode,
        this.isTimeoutError(error)
          ? 'Plugin container request timed out.'
          : failureMessage,
        true,
      ) as T;
    }
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Plugin container request timed out.'));
      }, timeoutMs);

      promise.then(
        (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timeout);
          reject(
            error instanceof Error
              ? error
              : new Error('Plugin container runtime request failed.'),
          );
        },
      );
    });
  }

  private async cleanupRuntime(
    runtime: ContainerRuntimeProcess,
  ): Promise<PluginRuntimeOperationResult> {
    let removeFailed = false;
    try {
      await this.containerOrchestrator.killContainer(runtime.containerId);
    } catch {
      // Removal is still attempted because the container may already be stopped.
    }

    try {
      await this.containerOrchestrator.removeContainer(
        runtime.containerId,
        true,
      );
    } catch {
      removeFailed = true;
    }

    if (removeFailed) {
      return this.safeError(
        'container_cleanup_failed',
        'Plugin container cleanup failed.',
        true,
      );
    }

    return { ok: true };
  }

  private getRuntime(
    request: PluginRuntimeBaseRequest,
  ):
    | { readonly ok: true; readonly value: ContainerRuntimeProcess }
    | { readonly ok: false; readonly error: PluginRuntimeError } {
    const runtime = this.runtimes.get(this.runtimeKey(request));
    if (!runtime) {
      return this.safeError(
        'container_not_started',
        'Plugin container runtime has not been started.',
        true,
      );
    }

    if (runtime.status !== 'active') {
      return this.safeError(
        'container_not_started',
        'Plugin container runtime has not been started.',
        true,
      );
    }

    return { ok: true, value: runtime };
  }

  private unavailable(): {
    readonly ok: false;
    readonly error: PluginRuntimeError;
  } {
    return this.safeError(
      'container_runtime_unavailable',
      'Plugin container runtime is not enabled.',
      false,
    );
  }

  private safeError(
    code: string,
    message: string,
    retryable: boolean,
  ): { readonly ok: false; readonly error: PluginRuntimeError } {
    return {
      ok: false,
      error: { code, message, retryable },
    };
  }

  private isEnabled(): boolean {
    return (
      this.sourceEnv[CONTAINER_RUNTIME_ENABLED_ENV]?.trim().toLowerCase() ===
      'true'
    );
  }

  private isNetworkEnabled(): boolean {
    return (
      this.sourceEnv[
        CONTAINER_RUNTIME_ALLOW_NETWORK_ENV
      ]?.trim().toLowerCase() === 'true'
    );
  }

  private hasSecretLikeEnvKey(
    env: Record<string, string> | undefined,
  ): boolean {
    if (!env) return false;

    return Object.keys(env).some((key) => SECRET_ENV_KEY_PATTERN.test(key));
  }

  private hasEnvPassthrough(env: Record<string, string> | undefined): boolean {
    return Object.keys(env ?? {}).length > 0;
  }

  private runtimeKey(request: PluginRuntimeBaseRequest): string {
    return `${request.pluginId}@${request.version}`;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    return error.message.toLowerCase().includes('timed out');
  }
}

function containerRuntimeClientUnavailable(): {
  readonly ok: false;
  readonly error: PluginRuntimeError;
} {
  return {
    ok: false,
    error: {
      code: 'container_runtime_client_unavailable',
      message: 'Plugin container runtime client is not configured.',
      retryable: false,
    },
  };
}
