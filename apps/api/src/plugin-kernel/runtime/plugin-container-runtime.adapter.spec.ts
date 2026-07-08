import {
  ContainerState,
  ContainerTier,
  type IContainerConfig,
} from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { PluginKernelModule } from '../plugin-kernel.module';
import { PluginNoneRuntimeAdapter } from './plugin-none-runtime.adapter';
import { PLUGIN_RUNTIME_ADAPTERS } from './plugin-runtime.types';
import { PluginWorkerRuntimeAdapter } from './plugin-worker-runtime.adapter';
import {
  PLUGIN_CONTAINER_RUNTIME_CLIENT,
  PLUGIN_CONTAINER_RUNTIME_ENV,
  PluginContainerRuntimeAdapter,
} from './plugin-container-runtime.adapter';
import type { PluginContainerRuntimeClient } from './plugin-container-runtime.types';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const pluginRef = {
  pluginId: 'com.acme.container-plugin',
  version: '1.2.3',
  actorId: 'operator-1',
};

interface MockContainerOrchestrator {
  readonly provisionContainer: ReturnType<typeof vi.fn>;
  readonly getContainerStatus: ReturnType<typeof vi.fn>;
  readonly killContainer: ReturnType<typeof vi.fn>;
  readonly removeContainer: ReturnType<typeof vi.fn>;
}

interface MockPluginContainerRuntimeClient {
  readonly startSession: ReturnType<typeof vi.fn>;
  readonly invoke: ReturnType<typeof vi.fn>;
  readonly deliverEvent: ReturnType<typeof vi.fn>;
  readonly healthCheck: ReturnType<typeof vi.fn>;
  readonly shutdown: ReturnType<typeof vi.fn>;
}

function createHarness(env: NodeJS.ProcessEnv = {}) {
  const orchestrator: MockContainerOrchestrator = {
    provisionContainer: vi.fn().mockResolvedValue('container-1'),
    getContainerStatus: vi.fn().mockResolvedValue({
      id: 'container-1',
      name: 'plugin-container',
      state: ContainerState.RUNNING,
      status: 'running',
      created: new Date('2026-01-01T00:00:00.000Z'),
      image: 'registry.local/acme/plugin:1.2.3',
    }),
    killContainer: vi.fn().mockResolvedValue(undefined),
    removeContainer: vi.fn().mockResolvedValue(undefined),
  };
  const runtimeClient: MockPluginContainerRuntimeClient = {
    startSession: vi
      .fn()
      .mockResolvedValue({ ok: true, output: { ready: true } }),
    invoke: vi
      .fn()
      .mockResolvedValue({ ok: true, output: { text: 'summary' } }),
    deliverEvent: vi.fn().mockResolvedValue({ ok: true }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true, healthy: true }),
    shutdown: vi.fn().mockResolvedValue({ ok: true }),
  };
  const adapter = new PluginContainerRuntimeAdapter(
    orchestrator as unknown as ContainerOrchestratorService,
    runtimeClient,
    env,
  );

  return { adapter, orchestrator, runtimeClient };
}

function enabledStartRequest(overrides: Record<string, unknown> = {}) {
  return {
    ...pluginRef,
    container: {
      image: 'registry.local/acme/plugin:1.2.3',
      ...overrides,
    },
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve;
  });

  return { promise, resolve: resolveDeferred };
}

describe('PluginContainerRuntimeAdapter', () => {
  it('reports container as its runtime mode', () => {
    const { adapter } = createHarness();

    expect(adapter.mode).toBe('container');
  });

  it('denies startup when the container runtime feature gate is disabled', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'false',
    });

    await expect(adapter.start(enabledStartRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_runtime_unavailable',
        message: 'Plugin container runtime is not enabled.',
        retryable: false,
      },
    });
    expect(orchestrator.provisionContainer).not.toHaveBeenCalled();
  });

  it('starts a constrained container with no host network or workspace mount by default', async () => {
    const { adapter, orchestrator, runtimeClient } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });

    await expect(adapter.start(enabledStartRequest())).resolves.toEqual({
      ok: true,
      output: { ready: true },
    });

    expect(orchestrator.provisionContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'registry.local/acme/plugin:1.2.3',
        tier: ContainerTier.LIGHT,
        env: {},
        volumes: [],
        labels: expect.objectContaining({
          'nexus.managed': 'true',
          'nexus.plugin.id': pluginRef.pluginId,
        }),
      }) satisfies IContainerConfig,
      true,
      false,
      undefined,
    );
    expect(runtimeClient.startSession).toHaveBeenCalledWith({
      containerId: 'container-1',
      pluginId: pluginRef.pluginId,
      version: pluginRef.version,
      timeoutMs: undefined,
    });
  });

  it('requires explicit image and allows explicitly configured network/resource policy inputs', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
      PLUGIN_CONTAINER_RUNTIME_ALLOW_NETWORK: 'true',
    });

    await expect(
      adapter.start({ ...pluginRef, container: { allowNetwork: true } }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_config_invalid',
        message: 'Plugin container runtime requires an explicit image.',
        retryable: false,
      },
    });

    await adapter.start(
      enabledStartRequest({
        allowNetwork: true,
        tier: ContainerTier.HEAVY,
      }),
    );

    expect(orchestrator.provisionContainer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tier: ContainerTier.HEAVY,
        env: {},
      }),
      true,
      true,
      undefined,
    );
  });

  it('rejects host volume mounts, writable binds, secret env keys, and unapproved network', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });

    await expect(
      adapter.start(
        enabledStartRequest({
          volumes: [
            {
              hostPath: 'C:/Users/operator/workspace/plugin',
              containerPath: '/plugin',
              readOnly: true,
            },
          ],
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_config_invalid',
        message: 'Plugin container runtime does not allow host volume mounts.',
        retryable: false,
      },
    });
    await expect(
      adapter.start(
        enabledStartRequest({
          volumes: [
            {
              hostPath: 'safe-volume',
              containerPath: '/plugin',
              readOnly: false,
            },
          ],
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_config_invalid',
        message: 'Plugin container runtime does not allow host volume mounts.',
        retryable: false,
      },
    });
    await expect(
      adapter.start(
        enabledStartRequest({
          env: { PLUGIN_TOKEN: 'secret-token' },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_config_invalid',
        message:
          'Plugin container runtime does not allow secret-like env keys.',
        retryable: false,
      },
    });
    await expect(
      adapter.start(enabledStartRequest({ allowNetwork: true })),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_config_invalid',
        message: 'Plugin container runtime network access is not enabled.',
        retryable: false,
      },
    });
    expect(orchestrator.provisionContainer).not.toHaveBeenCalled();
  });

  it('rejects raw env passthrough even for benign-looking config keys', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });

    for (const env of [
      { PLUGIN_CONFIG: 'enabled' },
      { AUTH: 'none' },
      { CONFIG_JSON: '{"safe":true}' },
    ]) {
      await expect(
        adapter.start(enabledStartRequest({ env })),
      ).resolves.toEqual({
        ok: false,
        error: {
          code: 'container_config_invalid',
          message: 'Plugin container runtime does not allow env passthrough.',
          retryable: false,
        },
      });
    }

    expect(orchestrator.provisionContainer).not.toHaveBeenCalled();
  });

  it('cleans existing runtime before replacing it on sequential starts', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    orchestrator.provisionContainer
      .mockResolvedValueOnce('container-1')
      .mockResolvedValueOnce('container-2');

    await adapter.start(enabledStartRequest());
    await adapter.start(enabledStartRequest());
    await adapter.shutdown({ ...pluginRef, reason: 'operator-request' });

    expect(orchestrator.killContainer).toHaveBeenCalledWith('container-1');
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-1',
      true,
    );
    expect(orchestrator.killContainer).toHaveBeenCalledWith('container-2');
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-2',
      true,
    );
  });

  it('serializes concurrent starts so no provisioned container is orphaned', async () => {
    const { adapter, orchestrator, runtimeClient } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    const firstStart = createDeferred<{ readonly ok: true }>();
    orchestrator.provisionContainer
      .mockResolvedValueOnce('container-1')
      .mockResolvedValueOnce('container-2');
    runtimeClient.startSession
      .mockReturnValueOnce(firstStart.promise)
      .mockResolvedValueOnce({ ok: true, output: { ready: true } });

    const firstStartPromise = adapter.start(enabledStartRequest());
    const secondStartPromise = adapter.start(enabledStartRequest());
    await Promise.resolve();

    expect(orchestrator.provisionContainer).toHaveBeenCalledTimes(1);
    firstStart.resolve({ ok: true });
    await expect(firstStartPromise).resolves.toEqual({ ok: true });
    await expect(secondStartPromise).resolves.toEqual({
      ok: true,
      output: { ready: true },
    });
    await adapter.shutdown({ ...pluginRef, reason: 'operator-request' });

    expect(orchestrator.killContainer).toHaveBeenCalledWith('container-1');
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-1',
      true,
    );
    expect(orchestrator.killContainer).toHaveBeenCalledWith('container-2');
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-2',
      true,
    );
  });

  it('delegates invocation, event delivery, health, and shutdown through the runtime client', async () => {
    const { adapter, runtimeClient, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });

    await adapter.start(enabledStartRequest());
    await expect(
      adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'hello' },
      }),
    ).resolves.toEqual({ ok: true, output: { text: 'summary' } });
    await expect(
      adapter.deliverEvent({
        ...pluginRef,
        topic: 'workflow.completed',
        eventName: 'WorkflowCompleted',
        payload: { runId: 'run-1' },
      }),
    ).resolves.toEqual({ ok: true });
    await expect(adapter.healthCheck(pluginRef)).resolves.toEqual({
      ok: true,
      healthy: true,
    });
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-request' }),
    ).resolves.toEqual({ ok: true });

    expect(runtimeClient.invoke).toHaveBeenCalledWith('container-1', {
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'hello' },
    });
    expect(runtimeClient.deliverEvent).toHaveBeenCalledTimes(1);
    expect(runtimeClient.healthCheck).toHaveBeenCalledWith(
      'container-1',
      pluginRef,
    );
    expect(runtimeClient.shutdown).toHaveBeenCalledWith('container-1', {
      ...pluginRef,
      reason: 'operator-request',
    });
    expect(orchestrator.killContainer).toHaveBeenCalledWith('container-1');
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-1',
      true,
    );
  });

  it('normalizes startup, invocation timeout, crash, and shutdown errors without leaking internals', async () => {
    const { adapter, orchestrator, runtimeClient } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    vi.mocked(orchestrator.provisionContainer).mockRejectedValueOnce(
      new Error(
        'Docker daemon failed DATABASE_URL=postgres://secret /host/worktree',
      ),
    );

    await expect(adapter.start(enabledStartRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_start_failed',
        message: 'Plugin container failed to start.',
        retryable: true,
      },
    });

    await adapter.start(enabledStartRequest());
    vi.mocked(runtimeClient.invoke).mockRejectedValueOnce(
      new Error('HTTP POST timed out: http://172.17.0.2:8374/invoke'),
    );
    await expect(
      adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: { secret: 'raw-payload' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_timeout',
        message: 'Plugin container request timed out.',
        retryable: true,
      },
    });

    vi.mocked(orchestrator.getContainerStatus).mockResolvedValueOnce({
      id: 'container-1',
      name: 'plugin-container',
      state: ContainerState.EXITED,
      status: 'exited with code 137 and raw payload',
      created: new Date('2026-01-01T00:00:00.000Z'),
      image: 'registry.local/acme/plugin:1.2.3',
    });
    await expect(adapter.healthCheck(pluginRef)).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_crashed',
        message: 'Plugin container is not running.',
        retryable: true,
      },
    });

    vi.mocked(runtimeClient.shutdown).mockRejectedValueOnce(
      new Error('cannot post secret payload to /tmp/workspace'),
    );
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-request' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_shutdown_failed',
        message: 'Plugin container shutdown failed.',
        retryable: true,
      },
    });
  });

  it('keeps runtime state when shutdown cleanup fails so cleanup can be retried', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    orchestrator.removeContainer
      .mockRejectedValueOnce(new Error('Docker remove failed path=/workspace'))
      .mockResolvedValueOnce(undefined);

    await adapter.start(enabledStartRequest());
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-request' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_cleanup_failed',
        message: 'Plugin container cleanup failed.',
        retryable: true,
      },
    });
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-retry' }),
    ).resolves.toEqual({ ok: true });
    expect(orchestrator.removeContainer).toHaveBeenCalledTimes(2);
  });

  it('keeps failed-start runtime state when cleanup fails so shutdown can retry cleanup', async () => {
    const unsafeFailure = {
      ok: false as const,
      error: {
        code: 'container_start_failed',
        message: 'startup failed path=/workspace',
        retryable: true,
      },
    };
    const { adapter, orchestrator, runtimeClient } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    runtimeClient.startSession.mockResolvedValueOnce(unsafeFailure);
    orchestrator.removeContainer
      .mockRejectedValueOnce(new Error('Docker remove failed path=/workspace'))
      .mockResolvedValueOnce(undefined);

    await expect(adapter.start(enabledStartRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_start_failed',
        message: 'Plugin container failed to start.',
        retryable: true,
      },
    });
    await expect(
      adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'after failed start' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_not_started',
        message: 'Plugin container runtime has not been started.',
        retryable: true,
      },
    });
    await expect(
      adapter.deliverEvent({
        ...pluginRef,
        topic: 'workflow.completed',
        eventName: 'WorkflowCompleted',
        payload: { runId: 'run-1' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_not_started',
        message: 'Plugin container runtime has not been started.',
        retryable: true,
      },
    });
    await expect(adapter.healthCheck(pluginRef)).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_not_started',
        message: 'Plugin container runtime has not been started.',
        retryable: true,
      },
    });
    expect(runtimeClient.invoke).not.toHaveBeenCalled();
    expect(runtimeClient.deliverEvent).not.toHaveBeenCalled();
    expect(runtimeClient.healthCheck).not.toHaveBeenCalled();
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'startup-cleanup-retry' }),
    ).resolves.toEqual({ ok: true });
    expect(runtimeClient.shutdown).not.toHaveBeenCalled();
    expect(orchestrator.removeContainer).toHaveBeenCalledTimes(2);
  });

  it('attempts container removal when shutdown kill fails', async () => {
    const { adapter, orchestrator } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });
    orchestrator.killContainer.mockRejectedValueOnce(
      new Error('Docker kill failed token=secret'),
    );

    await adapter.start(enabledStartRequest());
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-request' }),
    ).resolves.toEqual({ ok: true });
    expect(orchestrator.removeContainer).toHaveBeenCalledWith(
      'container-1',
      true,
    );
  });

  it('sanitizes resolved runtime-client failures for every container operation', async () => {
    const unsafeFailure = {
      ok: false as const,
      error: {
        code: 'docker_daemon_500',
        message:
          'Docker daemon leaked DATABASE_URL=postgres://secret /host/worktree raw-payload',
        retryable: false,
        details: {
          env: 'GITHUB_TOKEN=github-secret',
          ipc: { payload: { secret: 'raw-payload' } },
          path: 'C:/Users/operator/workspace/plugin',
        },
      },
    };
    const { adapter, runtimeClient } = createHarness({
      PLUGIN_CONTAINER_RUNTIME_ENABLED: 'true',
    });

    vi.mocked(runtimeClient.startSession).mockResolvedValueOnce(unsafeFailure);
    await expect(adapter.start(enabledStartRequest())).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_start_failed',
        message: 'Plugin container failed to start.',
        retryable: true,
      },
    });
    await expect(
      adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'after failed start' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_not_started',
        message: 'Plugin container runtime has not been started.',
        retryable: true,
      },
    });
    expect(runtimeClient.invoke).not.toHaveBeenCalled();

    await adapter.start(enabledStartRequest());
    vi.mocked(runtimeClient.invoke).mockResolvedValueOnce(unsafeFailure);
    await expect(
      adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: { secret: 'raw-payload' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_invocation_failed',
        message: 'Plugin container invocation failed.',
        retryable: true,
      },
    });

    vi.mocked(runtimeClient.deliverEvent).mockResolvedValueOnce(unsafeFailure);
    await expect(
      adapter.deliverEvent({
        ...pluginRef,
        topic: 'workflow.completed',
        eventName: 'WorkflowCompleted',
        payload: { secret: 'raw-payload' },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_event_delivery_failed',
        message: 'Plugin container event delivery failed.',
        retryable: true,
      },
    });

    vi.mocked(runtimeClient.healthCheck).mockResolvedValueOnce(unsafeFailure);
    await expect(adapter.healthCheck(pluginRef)).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_health_failed',
        message: 'Plugin container health check failed.',
        retryable: true,
      },
    });

    vi.mocked(runtimeClient.shutdown).mockResolvedValueOnce(unsafeFailure);
    await expect(
      adapter.shutdown({ ...pluginRef, reason: 'operator-request' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'container_shutdown_failed',
        message: 'Plugin container shutdown failed.',
        retryable: true,
      },
    });
  });

  it('registers the container adapter while preserving existing runtime adapters', () => {
    const providers = Reflect.getMetadata(
      'providers',
      PluginKernelModule,
    ) as unknown[];
    const runtimeAdaptersProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === PLUGIN_RUNTIME_ADAPTERS,
    ) as
      | {
          useFactory: (...adapters: unknown[]) => unknown[];
          inject: unknown[];
        }
      | undefined;

    expect(providers).toContain(PluginNoneRuntimeAdapter);
    expect(providers).toContain(PluginWorkerRuntimeAdapter);
    expect(providers).toContain(PluginContainerRuntimeAdapter);
    expect(
      providers.some((provider) => {
        return (
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          provider.provide === PLUGIN_CONTAINER_RUNTIME_CLIENT
        );
      }),
    ).toBe(true);
    expect(
      providers.some((provider) => {
        return (
          typeof provider === 'object' &&
          provider !== null &&
          'provide' in provider &&
          provider.provide === PLUGIN_CONTAINER_RUNTIME_ENV
        );
      }),
    ).toBe(true);
    expect(runtimeAdaptersProvider?.inject).toEqual([
      PluginNoneRuntimeAdapter,
      PluginWorkerRuntimeAdapter,
      PluginContainerRuntimeAdapter,
    ]);
    expect(
      runtimeAdaptersProvider?.useFactory('none', 'worker', 'container'),
    ).toEqual(['none', 'worker', 'container']);
  });
});
