import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  PLUGIN_RUNTIME_PROTOCOL_VERSION,
  type PluginRuntimeProtocolMessage,
} from '@nexus/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { PluginWorkerRuntimeAdapter } from './plugin-worker-runtime.adapter';

interface PluginWorkerProcessFactoryOptions {
  readonly pluginId: string;
  readonly version: string;
  readonly env: NodeJS.ProcessEnv;
}

type PluginWorkerProcessFactory = (
  options: PluginWorkerProcessFactoryOptions,
) => ChildProcess;

const pluginRef = {
  pluginId: 'com.acme.worker',
  version: '1.2.3',
  actorId: 'operator-1',
};

const secretEnvironment = {
  NODE_ENV: 'test',
  OPENAI_API_KEY: 'openai-secret',
  GITHUB_TOKEN: 'github-secret',
  DATABASE_URL: 'postgres://secret',
  NPM_TOKEN: 'npm-secret',
};

class MockWorkerProcess extends EventEmitter {
  readonly sentMessages: PluginRuntimeProtocolMessage[] = [];
  readonly pid = 1234;
  killed = false;
  sendError?: Error;

  send(message: PluginRuntimeProtocolMessage): boolean {
    if (this.sendError) throw this.sendError;

    this.sentMessages.push(message);
    return true;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  receive(message: unknown): void {
    this.emit('message', message);
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit('exit', code, signal);
  }
}

function createHarness(env: NodeJS.ProcessEnv = secretEnvironment) {
  const worker = new MockWorkerProcess();
  const factory = vi.fn<PluginWorkerProcessFactory>(
    () => worker as unknown as ChildProcess,
  );
  const adapter = new PluginWorkerRuntimeAdapter(factory, env);

  return { adapter, factory, worker };
}

function latestSent(worker: MockWorkerProcess): PluginRuntimeProtocolMessage {
  const message = worker.sentMessages.at(-1);
  if (!message) throw new Error('Expected worker message to be sent.');

  return message;
}

function sentAt(
  worker: MockWorkerProcess,
  index: number,
): PluginRuntimeProtocolMessage {
  const message = worker.sentMessages.at(index);
  if (!message) throw new Error(`Expected sent worker message at ${index}.`);

  return message;
}

function listenerCounts(worker: MockWorkerProcess) {
  return {
    message: worker.listenerCount('message'),
    exit: worker.listenerCount('exit'),
    error: worker.listenerCount('error'),
  };
}

function expectNoPendingListeners(worker: MockWorkerProcess): void {
  expect(listenerCounts(worker).message).toBe(0);
}

function expectNoListeners(worker: MockWorkerProcess): void {
  expect(listenerCounts(worker)).toEqual({ message: 0, exit: 0, error: 0 });
}

function receiveInvokeResponse(
  worker: MockWorkerProcess,
  request: PluginRuntimeProtocolMessage,
  output: Record<string, unknown>,
): void {
  if (!('correlationId' in request)) {
    throw new Error('Expected correlated request.');
  }

  worker.receive({
    protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
    type: 'invoke.response',
    pluginId: request.pluginId,
    correlationId: request.correlationId,
    ok: true,
    output,
  });
}

function respondToLatest(
  worker: MockWorkerProcess,
  response: Record<string, unknown>,
): void {
  const request = latestSent(worker);
  worker.receive({
    protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
    pluginId: request.pluginId,
    correlationId:
      'correlationId' in request ? request.correlationId : 'unused',
    ...response,
  });
}

describe('PluginWorkerRuntimeAdapter', () => {
  it('reports worker_process as its runtime mode', () => {
    const { adapter } = createHarness();

    expect(adapter.mode).toBe('worker_process');
  });

  it('performs startup handshake and contribution declaration through structured IPC', async () => {
    const { adapter, worker } = createHarness();

    const startPromise = adapter.start(pluginRef);
    const handshakeRequest = latestSent(worker);
    expect(handshakeRequest).toMatchObject({
      protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
      type: 'handshake.request',
      pluginId: pluginRef.pluginId,
      runtime: { id: 'nexus.api', mode: 'worker_process' },
      plugin: { id: pluginRef.pluginId, version: pluginRef.version },
    });

    respondToLatest(worker, {
      type: 'handshake.response',
      accepted: true,
      runtimeMode: 'worker_process',
      agreedProtocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
      plugin: { id: pluginRef.pluginId, version: pluginRef.version },
    });
    respondToLatest(worker, {
      type: 'contributions.declare',
      contributions: [
        {
          id: 'summarize',
          type: 'tool',
          displayName: 'Summarize',
          config: {
            inputSchema: { type: 'object' },
            operation: 'execute',
          },
        },
      ],
    });

    await expect(startPromise).resolves.toEqual({
      ok: true,
      output: {
        handshake: {
          accepted: true,
          runtimeMode: 'worker_process',
          plugin: { id: pluginRef.pluginId, version: pluginRef.version },
        },
        contributions: [
          {
            id: 'summarize',
            type: 'tool',
            displayName: 'Summarize',
            config: {
              inputSchema: { type: 'object' },
              operation: 'execute',
            },
          },
        ],
      },
    });
  });

  it('correlates invocation responses by correlation id', async () => {
    const { adapter, worker } = createHarness();

    const invokePromise = adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'hello' },
      metadata: { traceId: 'trace-1' },
    });
    const request = latestSent(worker);

    expect(request).toMatchObject({
      type: 'invoke.request',
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'hello' },
      metadata: { traceId: 'trace-1' },
    });

    worker.receive({
      protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
      type: 'invoke.response',
      pluginId: pluginRef.pluginId,
      correlationId: 'different-correlation-id',
      ok: true,
      output: { text: 'wrong' },
    });

    await expect(invokePromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'ipc_correlation_mismatch',
        message: 'Plugin worker returned an unexpected IPC correlation id.',
        retryable: true,
      },
    });
  });

  it('does not fail unrelated pending calls when concurrent responses arrive out of order', async () => {
    const { adapter, worker } = createHarness();

    const firstPromise = adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'first' },
    });
    const firstRequest = sentAt(worker, 0);
    const secondPromise = adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: { body: 'second' },
    });
    const secondRequest = sentAt(worker, 1);

    expect(listenerCounts(worker)).toEqual({ message: 2, exit: 3, error: 3 });

    receiveInvokeResponse(worker, firstRequest, { text: 'first-result' });
    await expect(firstPromise).resolves.toEqual({
      ok: true,
      output: { text: 'first-result' },
    });
    expect(listenerCounts(worker)).toEqual({ message: 1, exit: 2, error: 2 });

    receiveInvokeResponse(worker, secondRequest, { text: 'second-result' });
    await expect(secondPromise).resolves.toEqual({
      ok: true,
      output: { text: 'second-result' },
    });
    expectNoPendingListeners(worker);
  });

  it('normalizes send failures and cleans up pending listeners immediately', async () => {
    const { adapter, worker } = createHarness();
    worker.sendError = new Error('DATABASE_URL=postgres://secret');

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'ipc_send_failed',
        message: 'Plugin worker IPC send failed.',
        retryable: true,
      },
    });
    expectNoPendingListeners(worker);
  });

  it('evicts a worker after process error so the next operation starts a fresh worker', async () => {
    const firstWorker = new MockWorkerProcess();
    const secondWorker = new MockWorkerProcess();
    const factory = vi
      .fn<PluginWorkerProcessFactory>()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker);
    const adapter = new PluginWorkerRuntimeAdapter(factory, secretEnvironment);

    const firstPromise = adapter.healthCheck(pluginRef);
    firstWorker.emit('error', new Error('GITHUB_TOKEN=github-secret'));
    await expect(firstPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'worker_error',
        message: 'Plugin worker process failed.',
        retryable: true,
      },
    });
    expectNoPendingListeners(firstWorker);

    const secondPromise = adapter.healthCheck(pluginRef);
    expect(factory).toHaveBeenCalledTimes(2);
    respondToLatest(secondWorker, {
      type: 'health.check.response',
      healthy: true,
    });

    await expect(secondPromise).resolves.toEqual({ ok: true, healthy: true });
    expectNoPendingListeners(secondWorker);
  });

  it('fails correlated wrong-type responses immediately and cleans up listeners', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, worker } = createHarness();
      const healthPromise = adapter.healthCheck({
        ...pluginRef,
        timeoutMs: 1000,
      });
      const request = latestSent(worker);
      if (!('correlationId' in request)) {
        throw new Error('Expected correlated request.');
      }

      worker.receive({
        protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
        type: 'invoke.response',
        pluginId: pluginRef.pluginId,
        correlationId: request.correlationId,
        ok: true,
        output: { wrong: true },
      });

      await expect(healthPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'invalid_ipc_message',
          message: 'Plugin worker returned an invalid IPC message.',
          retryable: true,
        },
      });
      expectNoPendingListeners(worker);
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails startup when a correlated response matches neither startup waiter', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, worker } = createHarness();
      const startPromise = adapter.start({ ...pluginRef, timeoutMs: 1000 });
      const request = latestSent(worker);
      if (!('correlationId' in request)) {
        throw new Error('Expected correlated request.');
      }

      worker.receive({
        protocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
        type: 'event.deliver',
        pluginId: pluginRef.pluginId,
        correlationId: request.correlationId,
        topic: 'workflow.completed',
        eventName: 'WorkflowCompleted',
        payload: { runId: 'run-1' },
      });

      await Promise.resolve();
      await Promise.resolve();

      await expect(startPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'invalid_ipc_message',
          message: 'Plugin worker returned an invalid IPC message.',
          retryable: true,
        },
      });
      expectNoPendingListeners(worker);
      await vi.advanceTimersByTimeAsync(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts idle workers on process error or exit without unhandled errors', async () => {
    const firstWorker = new MockWorkerProcess();
    const secondWorker = new MockWorkerProcess();
    const thirdWorker = new MockWorkerProcess();
    const factory = vi
      .fn<PluginWorkerProcessFactory>()
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(secondWorker)
      .mockReturnValueOnce(thirdWorker);
    const adapter = new PluginWorkerRuntimeAdapter(factory, secretEnvironment);

    const firstHealthPromise = adapter.healthCheck(pluginRef);
    respondToLatest(firstWorker, {
      type: 'health.check.response',
      healthy: true,
    });
    await expect(firstHealthPromise).resolves.toEqual({
      ok: true,
      healthy: true,
    });
    expectNoPendingListeners(firstWorker);

    expect(() =>
      firstWorker.emit('error', new Error('NPM_TOKEN=npm-secret')),
    ).not.toThrow();
    expectNoListeners(firstWorker);

    const secondHealthPromise = adapter.healthCheck(pluginRef);
    expect(factory).toHaveBeenCalledTimes(2);
    respondToLatest(secondWorker, {
      type: 'health.check.response',
      healthy: true,
    });
    await expect(secondHealthPromise).resolves.toEqual({
      ok: true,
      healthy: true,
    });
    expectNoPendingListeners(secondWorker);

    secondWorker.exit(1, null);
    expectNoListeners(secondWorker);

    const thirdHealthPromise = adapter.healthCheck(pluginRef);
    expect(factory).toHaveBeenCalledTimes(3);
    respondToLatest(thirdWorker, {
      type: 'health.check.response',
      healthy: true,
    });
    await expect(thirdHealthPromise).resolves.toEqual({
      ok: true,
      healthy: true,
    });
    expectNoPendingListeners(thirdWorker);
  });

  it('delivers events, checks health, and shuts down workers', async () => {
    const { adapter, worker } = createHarness();

    const eventPromise = adapter.deliverEvent({
      ...pluginRef,
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });
    expect(latestSent(worker)).toMatchObject({
      type: 'event.deliver',
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });
    respondToLatest(worker, {
      type: 'invoke.response',
      ok: true,
      output: { delivered: true },
    });
    await expect(eventPromise).resolves.toEqual({
      ok: true,
      output: { delivered: true },
    });

    const healthPromise = adapter.healthCheck(pluginRef);
    expect(latestSent(worker)).toMatchObject({ type: 'health.check.request' });
    respondToLatest(worker, {
      type: 'health.check.response',
      healthy: true,
      details: { queueDepth: 0 },
    });
    await expect(healthPromise).resolves.toEqual({
      ok: true,
      healthy: true,
      details: { queueDepth: 0 },
    });

    const shutdownResult = await adapter.shutdown({
      ...pluginRef,
      reason: 'operator-request',
      deadlineMs: 1000,
    });
    expect(latestSent(worker)).toMatchObject({
      type: 'shutdown',
      reason: 'operator-request',
      deadlineMs: 1000,
    });
    expect(worker.killed).toBe(true);
    expect(shutdownResult).toEqual({ ok: true });
  });

  it('passes only allowlisted environment variables and plugin runtime metadata', async () => {
    const { adapter, factory, worker } = createHarness();

    const startPromise = adapter.start(pluginRef);
    respondToLatest(worker, {
      type: 'handshake.response',
      accepted: true,
      runtimeMode: 'worker_process',
      agreedProtocolVersion: PLUGIN_RUNTIME_PROTOCOL_VERSION,
      plugin: { id: pluginRef.pluginId, version: pluginRef.version },
    });
    respondToLatest(worker, {
      type: 'contributions.declare',
      contributions: [
        {
          id: 'summarize',
          type: 'tool',
          displayName: 'Summarize',
          config: {
            inputSchema: { type: 'object' },
            operation: 'execute',
          },
        },
      ],
    });
    await startPromise;

    const options = factory.mock.calls[0]?.[0];
    expect(options?.env).toEqual({
      NODE_ENV: 'test',
      NEXUS_PLUGIN_ID: pluginRef.pluginId,
      NEXUS_PLUGIN_VERSION: pluginRef.version,
      NEXUS_PLUGIN_RUNTIME_MODE: 'worker_process',
      NEXUS_PLUGIN_PROTOCOL_VERSION: PLUGIN_RUNTIME_PROTOCOL_VERSION,
    });
  });

  it('normalizes timeout, process exit, process error, and invalid IPC failures safely', async () => {
    vi.useFakeTimers();
    try {
      const timeoutHarness = createHarness();
      const timeoutPromise = timeoutHarness.adapter.invoke({
        ...pluginRef,
        contributionId: 'summarize',
        operation: 'invoke',
        input: null,
        timeoutMs: 10,
      });
      await vi.advanceTimersByTimeAsync(10);
      await expect(timeoutPromise).resolves.toEqual({
        ok: false,
        error: {
          code: 'ipc_timeout',
          message: 'Plugin worker IPC request timed out.',
          retryable: true,
        },
      });
      expectNoPendingListeners(timeoutHarness.worker);
    } finally {
      vi.useRealTimers();
    }

    const exitHarness = createHarness();
    const exitPromise = exitHarness.adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });
    exitHarness.worker.exit(1, null);
    await expect(exitPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'worker_exited',
        message: 'Plugin worker process exited before completing the request.',
        retryable: true,
      },
    });
    expectNoPendingListeners(exitHarness.worker);

    const errorHarness = createHarness();
    const errorPromise = errorHarness.adapter.healthCheck(pluginRef);
    errorHarness.worker.emit(
      'error',
      new Error('OPENAI_API_KEY=openai-secret command=C:/plugin.js'),
    );
    await expect(errorPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'worker_error',
        message: 'Plugin worker process failed.',
        retryable: true,
      },
    });
    expectNoPendingListeners(errorHarness.worker);

    const invalidHarness = createHarness();
    const invalidPromise = invalidHarness.adapter.healthCheck(pluginRef);
    invalidHarness.worker.receive({ raw: 'OPENAI_API_KEY=openai-secret' });
    await expect(invalidPromise).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid_ipc_message',
        message: 'Plugin worker returned an invalid IPC message.',
        retryable: true,
      },
    });
    expectNoPendingListeners(invalidHarness.worker);
  });
});
