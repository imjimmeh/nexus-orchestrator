import { describe, expect, it, vi } from 'vitest';
import { handleTelemetryPostAuthConnection } from './telemetry-gateway-post-auth.helpers';

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    role: 'agent' as const,
    workflowRunId: 'run-1',
    stepId: 'session',
    join: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn(),
    ...overrides,
  };
}

const VALID_RUNNER_CONFIG = {
  harnessId: 'nexus-light',
  model: {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    auth: { type: 'api_key', apiKey: 'sk-test' },
  },
  prompt: { systemPrompt: 'hi', initialPrompt: 'hi' },
};

describe('handleTelemetryPostAuthConnection', () => {
  it('caches provider and model from the runner config onto the agent socket', async () => {
    const client = makeClient();

    await handleTelemetryPostAuthConnection({
      client,
      processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
      getRunnerConfig: vi.fn().mockResolvedValue(VALID_RUNNER_CONFIG),
      subscribeUiChannel: vi.fn().mockResolvedValue(undefined),
      getEventHistory: vi.fn().mockResolvedValue([]),
    });

    expect(client.providerName).toBe('deepseek');
    expect(client.modelName).toBe('deepseek-v4-pro');
    expect(client.emit).toHaveBeenCalledWith('configure', VALID_RUNNER_CONFIG);
  });

  it('leaves provider/model unset when the runner config is malformed', async () => {
    const client = makeClient();

    await handleTelemetryPostAuthConnection({
      client,
      processAndBroadcastEvent: vi.fn().mockResolvedValue(undefined),
      getRunnerConfig: vi.fn().mockResolvedValue({ not: 'a config' }),
      subscribeUiChannel: vi.fn().mockResolvedValue(undefined),
      getEventHistory: vi.fn().mockResolvedValue([]),
    });

    expect(client.providerName).toBeUndefined();
    expect(client.modelName).toBeUndefined();
  });
});
