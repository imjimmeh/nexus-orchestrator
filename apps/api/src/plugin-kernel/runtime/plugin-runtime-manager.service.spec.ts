import { Test } from '@nestjs/testing';
import type {
  PluginIsolationMode,
  PluginManifestContribution,
} from '@nexus/plugin-sdk';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PluginRegistryEntryRepository } from '../database/repositories/plugin-registry-entry.repository';
import { PluginAuditService } from '../plugin-audit.service';
import { PluginPolicyService } from '../plugin-policy.service';
import { PluginRuntimeManagerService } from './plugin-runtime-manager.service';
import { PluginRuntimeHealthService } from './plugin-runtime-health.service';
import { PluginRuntimeSupervisorService } from './plugin-runtime-supervisor.service';
import { PLUGIN_RUNTIME_SUPERVISOR } from './plugin-runtime-supervisor.token';
import {
  PLUGIN_RUNTIME_ADAPTERS,
  type PluginRuntimeAdapter,
  type PluginRuntimeInvokeRequest,
} from './plugin-runtime.types';

type MockPluginRegistryEntryRepository = {
  findByPluginIdAndVersion: ReturnType<typeof vi.fn>;
};

type MockPluginAuditService = {
  recordLifecycleEvent: ReturnType<typeof vi.fn>;
  recordRuntimeEvent: ReturnType<typeof vi.fn>;
};

type MockPluginPolicyService = {
  decideEnable: ReturnType<typeof vi.fn>;
  decideRuntimeStart: ReturnType<typeof vi.fn>;
  decideRuntimeInvocation: ReturnType<typeof vi.fn>;
  decideEventDelivery: ReturnType<typeof vi.fn>;
};

type MockPluginRuntimeSupervisorService = {
  recordRuntimeCrash: ReturnType<typeof vi.fn>;
  recordRuntimeHealthy: ReturnType<typeof vi.fn>;
};

type MockPluginRuntimeHealthService = {
  recordStartup: ReturnType<typeof vi.fn>;
  recordRequestStarted: ReturnType<typeof vi.fn>;
  recordRequestFinished: ReturnType<typeof vi.fn>;
  recordHealthCheck: ReturnType<typeof vi.fn>;
  recordError: ReturnType<typeof vi.fn>;
  recordCrashLoop: ReturnType<typeof vi.fn>;
  recordShutdown: ReturnType<typeof vi.fn>;
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

interface MockPluginRuntimeAdapter {
  readonly mode: PluginIsolationMode;
  readonly start: Mock<(...args: any[]) => Promise<any>>;
  readonly invoke: Mock<(...args: any[]) => Promise<any>>;
  readonly deliverEvent: Mock<(...args: any[]) => Promise<any>>;
  readonly healthCheck: Mock<(...args: any[]) => Promise<any>>;
  readonly shutdown: Mock<(...args: any[]) => Promise<any>>;
}

const contribution: PluginManifestContribution = {
  id: 'summarize',
  type: 'tool',
  displayName: 'Summarize',
  config: {
    inputSchema: { type: 'object' },
    operation: 'execute',
  },
};

function buildRegistryEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    plugin_id: 'com.acme.workflow-tools',
    version: '1.2.3',
    name: 'Workflow Tools',
    description: null,
    author: null,
    source_type: 'package',
    source: 'npm:@acme/workflow-tools',
    lifecycle_state: 'enabled',
    enabled: true,
    trust_level: 'third_party',
    isolation_mode: 'worker_process',
    requested_permissions: [],
    granted_permissions: [],
    scan_result: { status: 'passed' },
    compatibility_result: { status: 'passed' },
    contributions: [contribution],
    last_error: null,
    installed_at: new Date('2026-01-01T00:00:00.000Z'),
    scanned_at: new Date('2026-01-01T00:00:00.000Z'),
    enabled_at: new Date('2026-01-01T00:00:00.000Z'),
    disabled_at: null,
    quarantined_at: null,
    uninstalled_at: null,
    metadata: {
      supportedContributionOperations: {
        summarize: ['invoke'],
      },
      runtimeHealth: 'healthy',
    },
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createAdapter(mode: PluginIsolationMode): MockPluginRuntimeAdapter {
  return {
    mode,
    start: vi.fn().mockResolvedValue({ ok: true }),
    invoke: vi
      .fn()
      .mockResolvedValue({ ok: true, output: { text: 'summary' } }),
    deliverEvent: vi.fn().mockResolvedValue({ ok: true }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true, healthy: true }),
    shutdown: vi.fn().mockResolvedValue({ ok: true }),
  };
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: (value: T) => void = () => undefined;
  let rejectDeferred: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

describe('PluginRuntimeManagerService', () => {
  let service: PluginRuntimeManagerService;
  let repository: MockPluginRegistryEntryRepository;
  let audit: MockPluginAuditService;
  let policy: MockPluginPolicyService;
  let supervisor: MockPluginRuntimeSupervisorService;
  let health: MockPluginRuntimeHealthService;
  let workerAdapter: MockPluginRuntimeAdapter;
  let containerAdapter: MockPluginRuntimeAdapter;

  beforeEach(async () => {
    repository = {
      findByPluginIdAndVersion: vi.fn().mockResolvedValue(buildRegistryEntry()),
    };
    audit = {
      recordLifecycleEvent: vi.fn().mockResolvedValue({ id: 'audit-1' }),
      recordRuntimeEvent: vi.fn().mockResolvedValue({ id: 'runtime-audit-1' }),
    };
    policy = {
      decideEnable: vi.fn().mockReturnValue({ allowed: true }),
      decideRuntimeStart: vi.fn().mockReturnValue({ allowed: true }),
      decideRuntimeInvocation: vi.fn().mockReturnValue({ allowed: true }),
      decideEventDelivery: vi.fn().mockReturnValue({ allowed: true }),
    };
    supervisor = {
      recordRuntimeCrash: vi
        .fn()
        .mockResolvedValue({ quarantined: false, crashCount: 1 }),
      recordRuntimeHealthy: vi.fn(),
    };
    health = {
      recordStartup: vi.fn(),
      recordRequestStarted: vi.fn(),
      recordRequestFinished: vi.fn(),
      recordHealthCheck: vi.fn(),
      recordError: vi.fn(),
      recordCrashLoop: vi.fn(),
      recordShutdown: vi.fn(),
    };
    workerAdapter = createAdapter('worker_process');
    containerAdapter = createAdapter('container');

    const module = await Test.createTestingModule({
      providers: [
        PluginRuntimeManagerService,
        { provide: PluginRegistryEntryRepository, useValue: repository },
        { provide: PluginAuditService, useValue: audit },
        { provide: PluginPolicyService, useValue: policy },
        { provide: PluginRuntimeSupervisorService, useValue: supervisor },
        { provide: PLUGIN_RUNTIME_SUPERVISOR, useValue: supervisor },
        { provide: PluginRuntimeHealthService, useValue: health },
        {
          provide: PLUGIN_RUNTIME_ADAPTERS,
          useValue: [
            workerAdapter as PluginRuntimeAdapter,
            containerAdapter as PluginRuntimeAdapter,
          ],
        },
      ],
    }).compile();

    service = module.get(PluginRuntimeManagerService);
  });

  it('selects the adapter matching the registry isolation mode for startup', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({ isolation_mode: 'container' }),
    );

    const result = await service.startPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(result).toEqual({ ok: true });
    expect(containerAdapter.start).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
      }),
    );
    expect(workerAdapter.start).not.toHaveBeenCalled();
  });

  it('policy-checks startup before calling the adapter', async () => {
    await service.startPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(policy.decideRuntimeStart).toHaveBeenCalledWith({
      context: expect.objectContaining({
        pluginId: 'com.acme.workflow-tools',
        isolationMode: 'worker_process',
      }),
    });
    expect(workerAdapter.start).toHaveBeenCalledTimes(1);
    expect(health.recordStartup).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    expect(audit.recordRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runtime.start.success',
        operation: 'start',
        result: 'success',
      }),
    );
  });

  it('denies startup for disabled plugins without calling the adapter', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({ enabled: false, lifecycle_state: 'disabled' }),
    );
    policy.decideRuntimeStart.mockReturnValue({
      allowed: false,
      reasonCode: 'plugin_disabled',
      message: 'Plugin must be enabled before this action is allowed.',
    });

    const result = await service.startPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'policy_denied',
        message: 'Plugin must be enabled before this action is allowed.',
        retryable: false,
        details: { reasonCode: 'plugin_disabled' },
      },
    });
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith({
      action: 'runtime.start.denied',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      result: 'denied',
      metadata: {
        reasonCode: 'plugin_disabled',
        message: 'Plugin must be enabled before this action is allowed.',
      },
    });
    expect(audit.recordRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runtime.policy.denied',
        operation: 'start',
        result: 'denied',
        metadata: expect.objectContaining({ reasonCode: 'plugin_disabled' }),
      }),
    );
    expect(workerAdapter.start).not.toHaveBeenCalled();
  });

  it('policy-checks invocation and forwards contribution requests', async () => {
    const request: PluginRuntimeInvokeRequest = {
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    };

    const result = await service.invokePlugin(request);

    expect(result).toEqual({ ok: true, output: { text: 'summary' } });
    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        grantedPermissions: [],
        contributions: [contribution],
      }),
      contributionId: 'summarize',
      operation: 'invoke',
    });
    expect(workerAdapter.invoke).toHaveBeenCalledWith(request);
    expect(health.recordRequestStarted).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    expect(health.recordRequestFinished).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    expect(audit.recordRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runtime.invoke.success',
        operation: 'invoke',
        contributionId: 'summarize',
        result: 'success',
      }),
    );
  });

  it('derives supported contribution operations from persisted contributions when metadata is missing', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({
        metadata: { runtimeHealth: 'healthy' },
      }),
    );

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'execute',
      input: { body: 'Long text' },
    });

    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        supportedContributionOperations: {
          summarize: ['execute'],
        },
      }),
      contributionId: 'summarize',
      operation: 'execute',
    });
  });

  it('falls back to persisted contributions when supported operation metadata is malformed', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({
        metadata: {
          runtimeHealth: 'healthy',
          supportedContributionOperations: {
            summarize: 'execute',
          },
        },
      }),
    );

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'execute',
      input: { body: 'Long text' },
    });

    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        supportedContributionOperations: {
          summarize: ['execute'],
        },
      }),
      contributionId: 'summarize',
      operation: 'execute',
    });
  });

  it('falls back to persisted contributions when operation metadata is empty', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({
        metadata: {
          runtimeHealth: 'healthy',
          supportedContributionOperations: {
            summarize: [''],
          },
        },
      }),
    );

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'execute',
      input: { body: 'Long text' },
    });

    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        supportedContributionOperations: {
          summarize: ['execute'],
        },
      }),
      contributionId: 'summarize',
      operation: 'execute',
    });
  });

  it('derives supported workflow step operations from persisted contributions', async () => {
    const workflowStepContribution: PluginManifestContribution = {
      id: 'review_change',
      type: 'workflow.step',
      displayName: 'Review Change',
      config: {
        stepType: 'plugin.review_change',
        inputContract: { type: 'object' },
        operation: 'review_change',
        blocking: true,
      },
    };
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({
        contributions: [workflowStepContribution],
        metadata: { runtimeHealth: 'healthy' },
      }),
    );

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'review_change',
      operation: 'review_change',
      input: { body: 'Long text' },
    });

    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        supportedContributionOperations: {
          review_change: ['review_change'],
        },
      }),
      contributionId: 'review_change',
      operation: 'review_change',
    });
  });

  it('skips malformed persisted contributions when deriving supported operations', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({
        contributions: [
          {
            id: 'broken_tool',
            type: 'tool',
            displayName: 'Broken Tool',
          } as unknown as PluginManifestContribution,
        ],
        metadata: { runtimeHealth: 'healthy' },
      }),
    );

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'broken_tool',
      operation: 'execute',
      input: { body: 'Long text' },
    });

    expect(policy.decideRuntimeInvocation).toHaveBeenCalledWith({
      context: expect.objectContaining({
        supportedContributionOperations: undefined,
      }),
      contributionId: 'broken_tool',
      operation: 'execute',
    });
  });

  it('policy-checks event delivery before forwarding the event', async () => {
    const result = await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });

    expect(result).toEqual({ ok: true });
    expect(policy.decideEventDelivery).toHaveBeenCalledWith({
      context: expect.objectContaining({ pluginId: 'com.acme.workflow-tools' }),
      topic: 'workflow.completed',
      contributionId: undefined,
      requiredPermissions: undefined,
    });
    expect(workerAdapter.deliverEvent).toHaveBeenCalledTimes(1);
  });

  it('forwards event subscription metadata into policy and adapter delivery calls', async () => {
    await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'event-delivery',
      topic: 'workflow.run.completed.v1',
      eventName: 'WorkflowRunCompleted',
      payload: { runId: 'run-1' },
      requiredPermissions: ['internal_capability:plugin.events.receive'],
    });

    expect(policy.decideEventDelivery).toHaveBeenCalledWith({
      context: expect.objectContaining({ pluginId: 'com.acme.workflow-tools' }),
      topic: 'workflow.run.completed.v1',
      contributionId: 'event-delivery',
      requiredPermissions: ['internal_capability:plugin.events.receive'],
    });
    expect(workerAdapter.deliverEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        contributionId: 'event-delivery',
        requiredPermissions: ['internal_capability:plugin.events.receive'],
      }),
    );
  });

  it('routes health checks and shutdown without contribution projection', async () => {
    const healthResult = await service.checkHealth({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });
    const shutdown = await service.shutdownPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      reason: 'operator-request',
    });

    expect(healthResult).toEqual({ ok: true, healthy: true });
    expect(shutdown).toEqual({ ok: true });
    expect(workerAdapter.healthCheck).toHaveBeenCalledTimes(1);
    expect(workerAdapter.shutdown).toHaveBeenCalledTimes(1);
    expect(health.recordHealthCheck).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      healthy: true,
    });
    expect(health.recordShutdown).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
  });

  it('denies health checks by policy without calling the adapter', async () => {
    policy.decideEventDelivery.mockReturnValue({
      allowed: false,
      reasonCode: 'plugin_disabled',
      message: 'Plugin must be enabled before this action is allowed.',
    });

    const result = await service.checkHealth({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'policy_denied',
        message: 'Plugin must be enabled before this action is allowed.',
        retryable: false,
        details: { reasonCode: 'plugin_disabled' },
      },
    });
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith({
      action: 'runtime.health.denied',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      result: 'denied',
      metadata: {
        reasonCode: 'plugin_disabled',
        message: 'Plugin must be enabled before this action is allowed.',
      },
    });
    expect(workerAdapter.healthCheck).not.toHaveBeenCalled();
  });

  it('denies shutdown by policy without calling the adapter', async () => {
    policy.decideEventDelivery.mockReturnValue({
      allowed: false,
      reasonCode: 'runtime_unhealthy',
      message: 'Plugin runtime is not healthy enough for this action.',
    });

    const result = await service.shutdownPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      reason: 'operator-request',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'policy_denied',
        message: 'Plugin runtime is not healthy enough for this action.',
        retryable: false,
        details: { reasonCode: 'runtime_unhealthy' },
      },
    });
    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith({
      action: 'runtime.shutdown.denied',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      result: 'denied',
      metadata: {
        reasonCode: 'runtime_unhealthy',
        message: 'Plugin runtime is not healthy enough for this action.',
      },
    });
    expect(workerAdapter.shutdown).not.toHaveBeenCalled();
  });

  it('normalizes missing adapters into structured runtime errors', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({ isolation_mode: 'none' }),
    );

    const result = await service.checkHealth({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'adapter_not_found',
        message:
          'No plugin runtime adapter is registered for isolation mode none.',
        retryable: false,
      },
    });
  });

  it('normalizes adapter timeouts into structured runtime errors', async () => {
    vi.mocked(workerAdapter.invoke).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            resolve({ ok: true });
          }, 50),
        ),
    );

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
      timeoutMs: 1,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'runtime_timeout',
        message: 'Plugin runtime call timed out after 1ms.',
        retryable: true,
      },
    });
    expect(health.recordError).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      code: 'runtime_timeout',
      message: 'Plugin runtime call failed.',
    });
    expect(audit.recordRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runtime.invoke.timeout',
        operation: 'invoke',
        result: 'failure',
      }),
    );
  });

  it('finishes pending requests when the manager timeout fires even if the adapter never settles', async () => {
    vi.useFakeTimers();
    try {
      workerAdapter.invoke.mockReturnValueOnce(new Promise(() => undefined));

      const resultPromise = service.invokePlugin({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'Long text' },
        timeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(1);

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'runtime_timeout',
          message: 'Plugin runtime call timed out after 1ms.',
          retryable: true,
        },
      });
      expect(health.recordRequestFinished).toHaveBeenCalledWith({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not double-finish pending requests when timed-out adapters settle late', async () => {
    vi.useFakeTimers();
    try {
      const deferredInvoke = createDeferred<{ readonly ok: true }>();
      workerAdapter.invoke.mockReturnValueOnce(deferredInvoke.promise);

      const resultPromise = service.invokePlugin({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'Long text' },
        timeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(1);

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'runtime_timeout',
          message: 'Plugin runtime call timed out after 1ms.',
          retryable: true,
        },
      });

      deferredInvoke.resolve({ ok: true });
      await vi.runAllTimersAsync();

      expect(health.recordRequestFinished).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns successful runtime results when runtime audit writes fail', async () => {
    audit.recordRuntimeEvent.mockRejectedValueOnce(
      new Error('audit unavailable token=secret'),
    );

    await expect(
      service.invokePlugin({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        contributionId: 'summarize',
        operation: 'invoke',
        input: { body: 'Long text' },
      }),
    ).resolves.toEqual({ ok: true, output: { text: 'summary' } });
  });

  it('cleans up successful starts that finish after the manager timed out', async () => {
    vi.useFakeTimers();
    try {
      repository.findByPluginIdAndVersion.mockResolvedValue(
        buildRegistryEntry({ isolation_mode: 'container' }),
      );
      const deferredStart = createDeferred<{ readonly ok: true }>();
      containerAdapter.start.mockReturnValueOnce(deferredStart.promise);

      const resultPromise = service.startPlugin({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        timeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(1);

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'runtime_timeout',
          message: 'Plugin runtime call timed out after 1ms.',
          retryable: true,
        },
      });

      deferredStart.resolve({ ok: true });
      await vi.runAllTimersAsync();

      expect(containerAdapter.shutdown).toHaveBeenCalledWith({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        reason: 'startup-timeout-cleanup',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('isolates late start failures after the manager timed out', async () => {
    vi.useFakeTimers();
    try {
      repository.findByPluginIdAndVersion.mockResolvedValue(
        buildRegistryEntry({ isolation_mode: 'container' }),
      );
      const deferredStart = createDeferred<{ readonly ok: true }>();
      containerAdapter.start.mockReturnValueOnce(deferredStart.promise);

      const resultPromise = service.startPlugin({
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        actorId: 'operator-1',
        timeoutMs: 1,
      });
      await vi.advanceTimersByTimeAsync(1);

      await expect(resultPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'runtime_timeout',
          message: 'Plugin runtime call timed out after 1ms.',
          retryable: true,
        },
      });

      deferredStart.reject(new Error('late start failed token=secret'));
      await vi.runAllTimersAsync();

      expect(containerAdapter.shutdown).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sanitizes thrown adapter errors before returning them to callers', async () => {
    vi.mocked(workerAdapter.invoke).mockRejectedValue(
      new Error('token=secret-token command=/tmp/plugin --api-key=secret'),
    );

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'Plugin runtime call failed.',
        retryable: true,
      },
    });
    expect(supervisor.recordRuntimeCrash).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    expect(health.recordError).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      code: 'runtime_error',
      message: 'Plugin runtime call failed.',
    });
    expect(audit.recordRuntimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runtime.crash',
        operation: 'invoke',
        result: 'failure',
      }),
    );
  });

  it('notifies the supervisor when adapters report runtime process crashes', async () => {
    vi.mocked(workerAdapter.invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'worker_exited',
        message: 'token=secret raw exit payload',
        retryable: true,
      },
    });

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'Plugin runtime call failed.',
        retryable: true,
      },
    });
    expect(supervisor.recordRuntimeCrash).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
    });
    expect(
      JSON.stringify(supervisor.recordRuntimeCrash.mock.calls),
    ).not.toContain('secret');
  });

  it('notifies the supervisor when container adapters report crash-class failures', async () => {
    repository.findByPluginIdAndVersion.mockResolvedValue(
      buildRegistryEntry({ isolation_mode: 'container' }),
    );
    vi.mocked(containerAdapter.start).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'container_start_failed',
        message: 'Docker daemon leaked DATABASE_URL=postgres://secret',
        retryable: true,
      },
    });
    vi.mocked(containerAdapter.healthCheck)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'container_crashed',
          message: 'raw exit payload token=secret',
          retryable: true,
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'container_health_failed',
          message: 'inspect failed path=/workspace',
          retryable: true,
        },
      });

    await service.startPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });
    await service.checkHealth({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });
    await service.checkHealth({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
    });

    expect(supervisor.recordRuntimeCrash).toHaveBeenCalledTimes(3);
    expect(supervisor.recordRuntimeCrash).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'container',
    });
    expect(
      JSON.stringify(supervisor.recordRuntimeCrash.mock.calls),
    ).not.toContain('secret');
    expect(health.recordCrashLoop).toHaveBeenCalledWith({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'container',
      crashCount: 1,
      quarantined: false,
    });
  });

  it('keeps supervisor failures isolated from adapter failure results', async () => {
    supervisor.recordRuntimeCrash.mockRejectedValue(
      new Error('audit database unavailable token=secret'),
    );
    vi.mocked(workerAdapter.invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'worker_exited',
        message: 'token=secret raw exit payload',
        retryable: true,
      },
    });

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
      timeoutMs: 1,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'Plugin runtime call failed.',
        retryable: true,
      },
    });
    expect(supervisor.recordRuntimeCrash).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('sanitizes adapter error results before returning them to callers', async () => {
    vi.mocked(workerAdapter.invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'adapter_failed',
        message: 'providerToken=secret-token path=C:/sensitive/plugin.log',
        retryable: false,
      },
    });

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'adapter_failed',
        message: 'Plugin runtime call failed.',
        retryable: false,
      },
    });
  });

  it('normalizes unsafe adapter error codes before returning them to callers', async () => {
    vi.mocked(workerAdapter.invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'token=secret-token path=C:/sensitive/plugin.log',
        message: 'Plugin runtime call failed.',
        retryable: false,
      },
    });

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'Plugin runtime call failed.',
        retryable: false,
      },
    });
  });

  it('rejects invocation payloads that exceed the request size limit', async () => {
    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'x'.repeat(20) },
      maxRequestBytes: 10,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request_too_large',
        message: 'Plugin runtime request payload exceeds 10 bytes.',
        retryable: false,
      },
    });
    expect(workerAdapter.invoke).not.toHaveBeenCalled();
  });

  it('rejects invocation metadata that exceeds the request size limit', async () => {
    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
      metadata: { trace: 'x'.repeat(20) },
      maxRequestBytes: 20,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request_too_large',
        message: 'Plugin runtime request payload exceeds 20 bytes.',
        retryable: false,
      },
    });
    expect(workerAdapter.invoke).not.toHaveBeenCalled();
  });

  it('rejects event payloads that exceed the request size limit', async () => {
    const result = await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { body: 'x'.repeat(20) },
      maxRequestBytes: 10,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request_too_large',
        message: 'Plugin runtime request payload exceeds 10 bytes.',
        retryable: false,
      },
    });
    expect(workerAdapter.deliverEvent).not.toHaveBeenCalled();
  });

  it('rejects event envelopes that exceed the request size limit', async () => {
    const result = await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      topic: 'workflow.completed.with.a.long.topic.name',
      eventName: 'WorkflowCompleted',
      payload: null,
      maxRequestBytes: 20,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request_too_large',
        message: 'Plugin runtime request payload exceeds 20 bytes.',
        retryable: false,
      },
    });
    expect(workerAdapter.deliverEvent).not.toHaveBeenCalled();
  });

  it('rejects unserializable invocation payloads cleanly', async () => {
    const circularPayload: Record<string, unknown> = {};
    circularPayload.self = circularPayload;

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: circularPayload,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'request_not_serializable',
        message: 'Plugin runtime request payload must be JSON serializable.',
        retryable: false,
      },
    });
    expect(workerAdapter.invoke).not.toHaveBeenCalled();
  });

  it('denies runtime invocation by policy without calling the adapter', async () => {
    policy.decideRuntimeInvocation.mockReturnValue({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });

    const result = await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'Long text' },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'policy_denied',
        message: 'Required plugin permission was not granted.',
        retryable: false,
        details: { reasonCode: 'permission_not_granted' },
      },
    });
    expect(workerAdapter.invoke).not.toHaveBeenCalled();
  });

  it('records audit denial events when policy denies runtime calls', async () => {
    policy.decideEventDelivery.mockReturnValue({
      allowed: false,
      reasonCode: 'runtime_unhealthy',
      message: 'Plugin runtime is not healthy enough for this action.',
    });

    await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });

    expect(audit.recordLifecycleEvent).toHaveBeenCalledWith({
      action: 'runtime.event.denied',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      result: 'denied',
      metadata: {
        reasonCode: 'runtime_unhealthy',
        message: 'Plugin runtime is not healthy enough for this action.',
      },
    });
    expect(workerAdapter.deliverEvent).not.toHaveBeenCalled();
  });

  it('does not audit raw caller-controlled denial identifiers or shutdown reasons', async () => {
    policy.decideRuntimeInvocation.mockReturnValueOnce({
      allowed: false,
      reasonCode: 'permission_not_granted',
      message: 'Required plugin permission was not granted.',
    });
    policy.decideEventDelivery
      .mockReturnValueOnce({
        allowed: false,
        reasonCode: 'runtime_unhealthy',
        message: 'Plugin runtime is not healthy enough for this action.',
      })
      .mockReturnValueOnce({
        allowed: false,
        reasonCode: 'runtime_unhealthy',
        message: 'Plugin runtime is not healthy enough for this action.',
      });

    await service.invokePlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      contributionId:
        'summarize token=secret-token /workspace/raw-payload.json',
      operation: 'invoke DATABASE_URL=postgres://secret',
      input: { body: 'Long text' },
    });
    await service.deliverEvent({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      topic: 'workflow.completed token=secret-token C:/payload.json',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });
    await service.shutdownPlugin({
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      actorId: 'operator-1',
      reason: 'operator included DATABASE_URL=postgres://secret',
    });

    const auditPayload = JSON.stringify([
      audit.recordLifecycleEvent.mock.calls,
      audit.recordRuntimeEvent.mock.calls,
    ]);
    expect(auditPayload).not.toContain('secret-token');
    expect(auditPayload).not.toContain('DATABASE_URL');
    expect(auditPayload).not.toContain('/workspace/raw-payload.json');
    expect(auditPayload).not.toContain('C:/payload.json');
    expect(auditPayload).not.toContain('operator included');
  });
});
