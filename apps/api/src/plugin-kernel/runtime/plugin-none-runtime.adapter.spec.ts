import { describe, expect, it } from 'vitest';
import { PluginNoneRuntimeAdapter } from './plugin-none-runtime.adapter';

const pluginRef = {
  pluginId: 'com.acme.trusted-tools',
  version: '1.2.3',
  actorId: 'operator-1',
};

function createRegisteredAdapter() {
  const adapter = new PluginNoneRuntimeAdapter();
  const calls: string[] = [];

  adapter.registerTrustedPluginRuntime(pluginRef.pluginId, pluginRef.version, {
    handshake: async (request) => {
      calls.push(`handshake:${request.pluginId}`);
      return {
        accepted: true,
        runtimeMode: 'none',
        plugin: { id: request.pluginId, version: request.version },
      };
    },
    declareContributions: () => {
      calls.push('declareContributions');
      return [
        {
          id: 'summarize',
          type: 'tool',
          displayName: 'Summarize',
          config: {
            inputSchema: { type: 'object' },
            operation: 'execute',
          },
        },
      ];
    },
    invoke: async (request) => {
      calls.push(`invoke:${request.contributionId}:${request.operation}`);
      return { text: `summary:${String(request.input)}` };
    },
    deliverEvent: async (request) => {
      calls.push(`event:${request.topic}:${request.eventName}`);
      return { delivered: true };
    },
    healthCheck: () => {
      calls.push('healthCheck');
      return { healthy: true, details: { queueDepth: 0 } };
    },
    shutdown: (request) => {
      calls.push(`shutdown:${request.reason}`);
      return { stopped: true };
    },
  });

  return { adapter, calls };
}

describe('PluginNoneRuntimeAdapter', () => {
  it('reports none as its runtime mode', () => {
    const adapter = new PluginNoneRuntimeAdapter();

    expect(adapter.mode).toBe('none');
  });

  it('performs startup handshake and contribution declaration for explicitly trusted runtimes', async () => {
    const { adapter, calls } = createRegisteredAdapter();

    const result = await adapter.start(pluginRef);

    expect(result).toEqual({
      ok: true,
      output: {
        handshake: {
          accepted: true,
          runtimeMode: 'none',
          plugin: { id: 'com.acme.trusted-tools', version: '1.2.3' },
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
    expect(calls).toEqual([
      'handshake:com.acme.trusted-tools',
      'declareContributions',
    ]);
  });

  it('invokes trusted handlers and normalizes outputs', async () => {
    const { adapter, calls } = createRegisteredAdapter();

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: 'body',
      metadata: { traceId: 'trace-1' },
    });

    expect(result).toEqual({ ok: true, output: { text: 'summary:body' } });
    expect(calls).toContain('invoke:summarize:invoke');
  });

  it('delivers events to trusted handlers', async () => {
    const { adapter, calls } = createRegisteredAdapter();

    const result = await adapter.deliverEvent({
      ...pluginRef,
      topic: 'workflow.completed',
      eventName: 'WorkflowCompleted',
      payload: { runId: 'run-1' },
    });

    expect(result).toEqual({ ok: true, output: { delivered: true } });
    expect(calls).toContain('event:workflow.completed:WorkflowCompleted');
  });

  it('runs health checks through trusted handlers', async () => {
    const { adapter } = createRegisteredAdapter();

    const result = await adapter.healthCheck(pluginRef);

    expect(result).toEqual({
      ok: true,
      healthy: true,
      details: { queueDepth: 0 },
    });
  });

  it('shuts down trusted handlers', async () => {
    const { adapter, calls } = createRegisteredAdapter();

    const result = await adapter.shutdown({
      ...pluginRef,
      reason: 'operator-request',
      deadlineMs: 1000,
    });

    expect(result).toEqual({ ok: true, output: { stopped: true } });
    expect(calls).toContain('shutdown:operator-request');
  });

  it('rejects missing handler exports with safe normalized errors', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      {
        handshake: () => ({ accepted: true }),
      },
    );

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'missing_handler',
        message:
          'Trusted plugin runtime does not export the required invoke handler.',
        retryable: false,
      },
    });
  });

  it('normalizes thrown trusted handler errors without leaking raw messages', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      {
        invoke: () => {
          throw new Error('token=secret-token path=C:/sensitive/plugin.js');
        },
      },
    );

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'handler_failed',
        message: 'Trusted plugin runtime handler failed.',
        retryable: true,
      },
    });
  });

  it('does not collide ambiguous plugin id and version pairs', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime('a@b', 'c', {
      invoke: () => ({ source: 'first-runtime' }),
    });
    adapter.registerTrustedPluginRuntime('a', 'b@c', {
      invoke: () => ({ source: 'second-runtime' }),
    });

    const firstResult = await adapter.invoke({
      pluginId: 'a@b',
      version: 'c',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });
    const secondResult = await adapter.invoke({
      pluginId: 'a',
      version: 'b@c',
      actorId: 'operator-1',
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(firstResult).toEqual({
      ok: true,
      output: { source: 'first-runtime' },
    });
    expect(secondResult).toEqual({
      ok: true,
      output: { source: 'second-runtime' },
    });
  });

  it('sanitizes handler-returned invocation error results', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      {
        invoke: () => ({
          ok: false,
          error: {
            code: 'token=secret-token',
            message: 'providerToken=secret-token path=C:/sensitive/plugin.log',
            retryable: false,
            details: { secret: 'secret-token' },
          },
        }),
      },
    );

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'handler_failed',
        message: 'Trusted plugin runtime handler failed.',
        retryable: false,
      },
    });
  });

  it('sanitizes handler-returned health check error results', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      {
        healthCheck: () => ({
          ok: false,
          error: {
            code: 'path=C:/sensitive/plugin.log',
            message: 'token=secret-token',
            retryable: true,
            details: { providerToken: 'secret-token' },
          },
        }),
      },
    );

    const result = await adapter.healthCheck(pluginRef);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'handler_failed',
        message: 'Trusted plugin runtime handler failed.',
        retryable: true,
      },
    });
  });

  it('does not let original handler map mutations alter registered runtime behavior', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    const handlers = {
      invoke: () => ({ value: 'registered' }),
    };
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      handlers,
    );
    handlers.invoke = () => ({ value: 'mutated' });

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({ ok: true, output: { value: 'registered' } });
  });

  it('normalizes rejected trusted handler promises without leaking raw messages', async () => {
    const adapter = new PluginNoneRuntimeAdapter();
    adapter.registerTrustedPluginRuntime(
      pluginRef.pluginId,
      pluginRef.version,
      {
        invoke: async () => {
          throw new Error('apiKey=secret-token path=C:/sensitive/plugin.js');
        },
      },
    );

    const result = await adapter.invoke({
      ...pluginRef,
      contributionId: 'summarize',
      operation: 'invoke',
      input: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'handler_failed',
        message: 'Trusted plugin runtime handler failed.',
        retryable: true,
      },
    });
  });
});
