import { describe, expect, it, vi } from 'vitest';
import { TelemetryEventService } from './telemetry-event.service';
import { TelemetryContainerContextService } from './telemetry-container-context.service';
import { TelemetrySessionCheckpointService } from './telemetry-session-checkpoint.service';
import type { AuthenticatedSocket } from './types';

function makeContainerContext() {
  return {
    resolve: vi.fn().mockResolvedValue(null),
  } as unknown as TelemetryContainerContextService;
}

function makeSessionCheckpoint() {
  return {
    persistBound: vi.fn().mockResolvedValue(undefined),
    getShouldPersist: vi.fn(() => () => true),
  } as unknown as TelemetrySessionCheckpointService;
}

function makeStreamService() {
  return { persistEvent: vi.fn().mockResolvedValue(undefined) };
}

function makePubSubService() {
  return { publishEvent: vi.fn().mockResolvedValue(undefined) };
}

function makeAgentResponseStore() {
  return {
    store: vi.fn().mockResolvedValue(undefined),
    storeStepComplete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeEventLedger() {
  return { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
}

function makeSubagentOrchestrator() {
  return {
    handleCompletion: vi.fn().mockResolvedValue(undefined),
    spawn: vi.fn().mockResolvedValue('exec-1'),
    waitForSubagents: vi.fn().mockResolvedValue({}),
    checkStatus: vi.fn().mockResolvedValue({}),
  };
}

function buildService() {
  const streamService = makeStreamService();
  const pubsubService = makePubSubService();
  const agentResponseStore = makeAgentResponseStore();
  const eventLedger = makeEventLedger();
  const containerContext = makeContainerContext();
  const sessionCheckpoint = makeSessionCheckpoint();
  const subagentOrchestrator = makeSubagentOrchestrator();

  const service = new TelemetryEventService(
    streamService as never,
    pubsubService as never,
    eventLedger as never,
    agentResponseStore as never,
    containerContext,
    sessionCheckpoint,
    subagentOrchestrator as never,
  );

  return {
    service,
    streamService,
    pubsubService,
    agentResponseStore,
    eventLedger,
    containerContext,
    sessionCheckpoint,
    subagentOrchestrator,
  };
}

function makeAgentClient(
  overrides: Partial<AuthenticatedSocket> = {},
): AuthenticatedSocket {
  return {
    role: 'agent',
    workflowRunId: 'run-1',
    streamId: 'run-1',
    stepId: 'step-1',
    jobId: 'job-1',
    containerId: 'container-1',
    isSubagent: false,
    ...overrides,
  } as unknown as AuthenticatedSocket;
}

describe('TelemetryEventService', () => {
  describe('processAndBroadcastEvent', () => {
    it('persists and publishes the event with a fresh timestamp', async () => {
      const { service, streamService, pubsubService } = buildService();
      await service.processAndBroadcastEvent('run-1', {
        event_type: 'agent_telemetry',
        payload: { foo: 'bar' },
      });

      expect(streamService.persistEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          event_type: 'agent_telemetry',
          payload: { foo: 'bar' },
          timestamp: expect.any(String),
        }),
      );
      expect(pubsubService.publishEvent).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({
          event_type: 'agent_telemetry',
          payload: { foo: 'bar' },
        }),
      );
    });
  });

  describe('dispatchCommandEvent', () => {
    it('dispatches command_started through the stream + pubsub path', async () => {
      const { service, streamService, pubsubService } = buildService();
      await service.dispatchCommandEvent('command_started', 'run-1', {
        foo: 'bar',
      });

      expect(streamService.persistEvent).toHaveBeenCalled();
      expect(pubsubService.publishEvent).toHaveBeenCalled();
    });

    it('does not persist command_output chunks (live only)', async () => {
      const { service, streamService, pubsubService } = buildService();
      await service.dispatchCommandEvent('command_output', 'run-1', {
        foo: 'bar',
      });

      expect(streamService.persistEvent).not.toHaveBeenCalled();
      expect(pubsubService.publishEvent).toHaveBeenCalled();
    });
  });

  describe('command_started / command_output / command_finished subscribe handlers', () => {
    it('no-ops when the client has no streamId or workflowRunId', async () => {
      const { service, pubsubService } = buildService();
      const client = { role: 'agent' } as unknown as AuthenticatedSocket;

      await service.handleCommandStarted(client, { foo: 'bar' });
      await service.handleCommandOutput(client, { foo: 'bar' });
      await service.handleCommandFinished(client, { foo: 'bar' });

      expect(pubsubService.publishEvent).not.toHaveBeenCalled();
    });

    it('dispatches command_started using the streamId when present', async () => {
      const { service, pubsubService } = buildService();
      const client = makeAgentClient({ streamId: 'subagent-stream-1' });

      await service.handleCommandStarted(client, { foo: 'bar' });

      expect(pubsubService.publishEvent).toHaveBeenCalledWith(
        'subagent-stream-1',
        expect.objectContaining({ event_type: 'command_started' }),
      );
    });
  });

  describe('handleAgentError', () => {
    it('persists the error message into the agent response store', async () => {
      const { service, agentResponseStore, pubsubService } = buildService();
      const client = makeAgentClient();

      await service.handleAgentError(client, { message: 'agent crashed' });

      expect(agentResponseStore.store).toHaveBeenCalledWith(
        'run-1',
        'step-1',
        '__AGENT_ERROR__:agent crashed',
      );
      expect(agentResponseStore.storeStepComplete).toHaveBeenCalledWith(
        'run-1',
        'step-1',
        '__AGENT_ERROR__:agent crashed',
      );
      expect(pubsubService.publishEvent).toHaveBeenCalled();
    });
  });

  describe('handleAgentEnd (subagent path)', () => {
    it('signals the subagent orchestrator when the socket is a subagent', async () => {
      const { service, subagentOrchestrator, agentResponseStore } =
        buildService();
      const client = makeAgentClient({
        isSubagent: true,
        subagentExecutionId: 'exec-1',
      });

      await service.handleAgentEnd(client, { ok: true });

      expect(subagentOrchestrator.handleCompletion).toHaveBeenCalledWith(
        'exec-1',
        expect.objectContaining({ ok: true }),
        'run-1',
      );
      expect(agentResponseStore.store).toHaveBeenCalled();
    });
  });
});
