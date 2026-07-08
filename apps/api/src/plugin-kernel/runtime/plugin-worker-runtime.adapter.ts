import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  PLUGIN_RUNTIME_PROTOCOL_VERSION,
  parsePluginRuntimeProtocolMessage,
  pluginEventDeliverMessageSchema,
  pluginHandshakeRequestMessageSchema,
  pluginHealthCheckRequestMessageSchema,
  pluginInvokeRequestMessageSchema,
  pluginShutdownMessageSchema,
  type PluginContributionsDeclareMessage,
  type PluginErrorMessage,
  type PluginHandshakeResponseMessage,
  type PluginHealthCheckResponseMessage,
  type PluginInvokeResponseMessage,
  type PluginRuntimeProtocolMessage,
} from '@nexus/plugin-sdk';
import type { ChildProcess } from 'node:child_process';
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
import {
  createPluginWorkerCorrelationId,
  createPluginWorkerEnvironment,
  defaultPluginWorkerProcessFactory,
  PLUGIN_WORKER_PROCESS_FACTORY,
  PLUGIN_WORKER_SOURCE_ENV,
} from './plugin-worker-runtime-ipc';
import type { PluginWorkerProcessFactory } from './plugin-worker-runtime-ipc.types';
import {
  addPendingCorrelation,
  getCorrelationId,
  hasPendingCorrelation,
  hasPendingExpectedType,
  isCorrelated,
  protocolError,
  removePendingCorrelation,
  runtimeKey,
  safeError,
  safeInvalidIpcMessage,
  toRuntimeJsonValue,
} from './plugin-worker-runtime.helpers';

const DEFAULT_IPC_TIMEOUT_MS = 30_000;
const WORKER_FAILED_MESSAGE = 'Plugin worker process failed.';

type RuntimeProcess = {
  readonly worker: ChildProcess;
  readonly pluginId: string;
  readonly version: string;
  readonly idleExitHandler: () => void;
  readonly idleErrorHandler: () => void;
};

type ExpectedResponse =
  | PluginHandshakeResponseMessage
  | PluginContributionsDeclareMessage
  | PluginInvokeResponseMessage
  | PluginHealthCheckResponseMessage
  | PluginErrorMessage;

@Injectable()
export class PluginWorkerRuntimeAdapter implements PluginRuntimeAdapter {
  readonly mode = 'worker_process' as const;

  private readonly workers = new Map<string, RuntimeProcess>();
  private readonly pendingCorrelationCounts = new Map<string, number>();
  private readonly pendingCorrelationExpectedTypes = new Map<
    string,
    Map<ExpectedResponse['type'], number>
  >();

  constructor(
    @Optional()
    @Inject(PLUGIN_WORKER_PROCESS_FACTORY)
    private readonly workerFactory: PluginWorkerProcessFactory = defaultPluginWorkerProcessFactory,
    @Optional()
    @Inject(PLUGIN_WORKER_SOURCE_ENV)
    private readonly sourceEnv: NodeJS.ProcessEnv = process.env,
  ) {}

  async start(
    request: PluginRuntimeStartRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const runtime = this.ensureWorker(request);
    if (!runtime.ok) return runtime;

    const correlationId = createPluginWorkerCorrelationId();
    const handshakeRequest = pluginHandshakeRequestMessageSchema.parse({
      protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
      type: 'handshake.request',
      pluginId: request.pluginId,
      correlationId,
      runtime: {
        id: 'nexus.api',
        version: '1',
        mode: 'worker_process',
        supportedProtocolVersions: [PLUGIN_RUNTIME_PROTOCOL_VERSION],
      },
      plugin: {
        id: request.pluginId,
        version: request.version,
        supportedProtocolVersions: [PLUGIN_RUNTIME_PROTOCOL_VERSION],
      },
    });

    const contributionsPromise = this.waitForMessage(
      runtime.value,
      correlationId,
      ['contributions.declare', 'error'],
      request.timeoutMs,
    );
    const handshake = await this.sendAndWait(
      runtime.value,
      handshakeRequest,
      ['handshake.response', 'error'],
      request.timeoutMs,
    );
    if (!handshake.ok) return handshake;
    if (handshake.value.type === 'error') return protocolError(handshake.value);
    if (handshake.value.type !== 'handshake.response')
      return safeInvalidIpcMessage();

    const contributions = await contributionsPromise;
    if (!contributions.ok) return contributions;
    if (contributions.value.type === 'error')
      return protocolError(contributions.value);
    if (contributions.value.type !== 'contributions.declare')
      return safeInvalidIpcMessage();

    return {
      ok: true,
      output: toRuntimeJsonValue({
        handshake: {
          accepted: handshake.value.accepted,
          runtimeMode: handshake.value.runtimeMode,
          plugin: handshake.value.plugin,
        },
        contributions: contributions.value.contributions,
      }),
    };
  }

  async invoke(
    request: PluginRuntimeInvokeRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const runtime = this.ensureWorker(request);
    if (!runtime.ok) return runtime;

    return this.requestOperation(
      runtime.value,
      pluginInvokeRequestMessageSchema.parse({
        protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
        type: 'invoke.request',
        pluginId: request.pluginId,
        correlationId: createPluginWorkerCorrelationId(),
        contributionId: request.contributionId,
        operation: request.operation,
        input: toRuntimeJsonValue(request.input),
        timeoutMs: request.timeoutMs,
        metadata: request.metadata,
      }),
      request.timeoutMs,
    );
  }

  async deliverEvent(
    request: PluginRuntimeEventDeliveryRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const runtime = this.ensureWorker(request);
    if (!runtime.ok) return runtime;

    return this.requestOperation(
      runtime.value,
      pluginEventDeliverMessageSchema.parse({
        protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
        type: 'event.deliver',
        pluginId: request.pluginId,
        correlationId: createPluginWorkerCorrelationId(),
        topic: request.topic,
        eventName: request.eventName,
        payload: toRuntimeJsonValue(request.payload),
      }),
      request.timeoutMs,
    );
  }

  async healthCheck(
    request: PluginRuntimeBaseRequest,
  ): Promise<PluginRuntimeHealthCheckResult> {
    const runtime = this.ensureWorker(request);
    if (!runtime.ok) return runtime;

    const response = await this.sendAndWait(
      runtime.value,
      pluginHealthCheckRequestMessageSchema.parse({
        protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
        type: 'health.check.request',
        pluginId: request.pluginId,
        correlationId: createPluginWorkerCorrelationId(),
      }),
      ['health.check.response', 'error'],
      request.timeoutMs,
    );
    if (!response.ok) return response;
    if (response.value.type === 'error') return protocolError(response.value);
    if (response.value.type !== 'health.check.response')
      return safeInvalidIpcMessage();

    return {
      ok: true,
      healthy: response.value.healthy,
      details: response.value.details,
    };
  }

  shutdown(
    request: PluginRuntimeShutdownRequest,
  ): Promise<PluginRuntimeOperationResult> {
    const runtime = this.workers.get(runtimeKey(request));
    if (!runtime) return Promise.resolve({ ok: true });

    if (runtime.worker.send) {
      runtime.worker.send(
        pluginShutdownMessageSchema.parse({
          protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
          type: 'shutdown',
          pluginId: request.pluginId,
          reason: request.reason,
          deadlineMs: request.deadlineMs,
        }),
      );
    }
    runtime.worker.kill();
    this.evictRuntime(runtime);

    return Promise.resolve({ ok: true });
  }

  private async requestOperation(
    runtime: RuntimeProcess,
    message:
      | ReturnType<typeof pluginInvokeRequestMessageSchema.parse>
      | ReturnType<typeof pluginEventDeliverMessageSchema.parse>,
    timeoutMs?: number,
  ): Promise<PluginRuntimeOperationResult> {
    const response = await this.sendAndWait(
      runtime,
      message,
      ['invoke.response', 'error'],
      timeoutMs,
    );
    if (!response.ok) return response;
    if (response.value.type === 'error') return protocolError(response.value);
    if (response.value.type !== 'invoke.response')
      return safeInvalidIpcMessage();

    return response.value.ok
      ? { ok: true, output: response.value.output }
      : safeError(
          'worker_rejected',
          'Plugin worker rejected the request.',
          true,
        );
  }

  private sendAndWait(
    runtime: RuntimeProcess,
    message: PluginRuntimeProtocolMessage,
    expectedTypes: readonly ExpectedResponse['type'][],
    timeoutMs?: number,
  ): Promise<
    | { readonly ok: true; readonly value: ExpectedResponse }
    | { readonly ok: false; readonly error: PluginRuntimeError }
  > {
    if (!runtime.worker.send) {
      return Promise.resolve(
        safeError('worker_unavailable', WORKER_FAILED_MESSAGE, true),
      );
    }

    const correlationId = getCorrelationId(message);
    const pending = this.createWaitRegistration(
      runtime,
      correlationId,
      expectedTypes,
      timeoutMs,
    );
    try {
      runtime.worker.send(message);
    } catch {
      pending.cleanup();
      this.evictRuntime(runtime);

      return Promise.resolve(
        safeError('ipc_send_failed', 'Plugin worker IPC send failed.', true),
      );
    }

    return pending.promise;
  }

  private waitForMessage(
    runtime: RuntimeProcess,
    correlationId: string,
    expectedTypes: readonly ExpectedResponse['type'][],
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
  ): Promise<
    | { readonly ok: true; readonly value: ExpectedResponse }
    | { readonly ok: false; readonly error: PluginRuntimeError }
  > {
    return this.createWaitRegistration(
      runtime,
      correlationId,
      expectedTypes,
      timeoutMs,
    ).promise;
  }

  private createWaitRegistration(
    runtime: RuntimeProcess,
    correlationId: string,
    expectedTypes: readonly ExpectedResponse['type'][],
    timeoutMs = DEFAULT_IPC_TIMEOUT_MS,
  ): {
    readonly promise: Promise<
      | { readonly ok: true; readonly value: ExpectedResponse }
      | { readonly ok: false; readonly error: PluginRuntimeError }
    >;
    readonly cleanup: () => void;
  } {
    let cleanup: (deferPendingUpdate?: boolean) => void = () => undefined;
    const promise = new Promise<
      | { readonly ok: true; readonly value: ExpectedResponse }
      | { readonly ok: false; readonly error: PluginRuntimeError }
    >((resolve) => {
      let settled = false;
      const cleanupRegistration = (deferPendingUpdate = false) => {
        if (settled) return;
        settled = true;
        const removePending = () => {
          removePendingCorrelation(
            this.pendingCorrelationCounts,
            this.pendingCorrelationExpectedTypes,
            correlationId,
            expectedTypes,
          );
        };
        if (deferPendingUpdate) queueMicrotask(removePending);
        else removePending();
        clearTimeout(timeout);
        runtime.worker.off('message', onMessage);
        runtime.worker.off('exit', onExit);
        runtime.worker.off('error', onError);
      };
      cleanup = cleanupRegistration;

      const fail = (result: {
        readonly ok: false;
        readonly error: PluginRuntimeError;
      }) => {
        cleanupRegistration();
        resolve(result);
      };

      const onMessage = (rawMessage: unknown) => {
        let message: PluginRuntimeProtocolMessage;
        try {
          message = parsePluginRuntimeProtocolMessage(rawMessage);
        } catch {
          fail(safeInvalidIpcMessage());
          return;
        }

        const validation = this.validateIpcMessage(
          message,
          correlationId,
          runtime,
          expectedTypes,
        );
        if (!validation.ok) {
          if ('skip' in validation) return;
          fail({ ok: false, error: validation.error });
          return;
        }

        cleanupRegistration(true);
        resolve({ ok: true, value: message as ExpectedResponse });
      };

      const onExit = () => {
        this.evictRuntime(runtime);
        fail(
          safeError(
            'worker_exited',
            'Plugin worker process exited before completing the request.',
            true,
          ),
        );
      };
      const onError = () => {
        this.evictRuntime(runtime);
        fail(safeError('worker_error', WORKER_FAILED_MESSAGE, true));
      };
      const timeout = setTimeout(() => {
        fail(
          safeError(
            'ipc_timeout',
            'Plugin worker IPC request timed out.',
            true,
          ),
        );
      }, timeoutMs);

      runtime.worker.on('message', onMessage);
      runtime.worker.on('exit', onExit);
      runtime.worker.on('error', onError);
      addPendingCorrelation(
        this.pendingCorrelationCounts,
        this.pendingCorrelationExpectedTypes,
        correlationId,
        expectedTypes,
      );
    });

    return {
      promise,
      cleanup: () => {
        cleanup();
      },
    };
  }

  private ensureWorker(
    request: PluginRuntimeBaseRequest,
  ):
    | { readonly ok: true; readonly value: RuntimeProcess }
    | { readonly ok: false; readonly error: PluginRuntimeError } {
    const key = runtimeKey(request);
    const existing = this.workers.get(key);
    if (existing) return { ok: true, value: existing };

    try {
      const env = createPluginWorkerEnvironment(
        request.pluginId,
        request.version,
        this.sourceEnv,
      );
      const worker = this.workerFactory({
        pluginId: request.pluginId,
        version: request.version,
        env,
        bootstrapPath: this.sourceEnv.NEXUS_PLUGIN_WORKER_BOOTSTRAP,
      });
      const runtime: RuntimeProcess = {
        worker,
        pluginId: request.pluginId,
        version: request.version,
        idleExitHandler: () => {
          this.evictRuntime(runtime);
        },
        idleErrorHandler: () => {
          this.evictRuntime(runtime);
        },
      };
      this.workers.set(key, runtime);
      worker
        .on('exit', runtime.idleExitHandler)
        .on('error', runtime.idleErrorHandler);

      return { ok: true, value: runtime };
    } catch {
      return safeError('worker_start_failed', WORKER_FAILED_MESSAGE, true);
    }
  }

  private evictRuntime(runtime: RuntimeProcess): void {
    this.workers.delete(runtimeKey(runtime));
    runtime.worker
      .off('exit', runtime.idleExitHandler)
      .off('error', runtime.idleErrorHandler);
  }

  private validateIpcMessage(
    message: PluginRuntimeProtocolMessage,
    correlationId: string,
    runtime: RuntimeProcess,
    expectedTypes: readonly ExpectedResponse['type'][],
  ):
    | { readonly ok: true }
    | { readonly ok: false; readonly error: PluginRuntimeError }
    | { readonly ok: false; readonly skip: true } {
    if (!isCorrelated(message) || message.correlationId !== correlationId) {
      return isCorrelated(message) &&
        hasPendingCorrelation(
          this.pendingCorrelationCounts,
          message.correlationId,
        )
        ? { ok: false, skip: true }
        : safeError(
            'ipc_correlation_mismatch',
            'Plugin worker returned an unexpected IPC correlation id.',
            true,
          );
    }
    if (message.pluginId !== runtime.pluginId) return safeInvalidIpcMessage();
    if (!(expectedTypes as ReadonlyArray<string>).includes(message.type)) {
      return hasPendingExpectedType(
        this.pendingCorrelationExpectedTypes,
        correlationId,
        message.type,
      )
        ? { ok: false, skip: true }
        : safeInvalidIpcMessage();
    }
    return { ok: true };
  }
}
