import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TelemetrySubagentGatewayService } from './telemetry-subagent.service';
import type { AuthenticatedSocket } from './types';

function makeContainerContext() {
  return { resolve: vi.fn().mockResolvedValue(null) };
}

function makeSubagentOrchestrator() {
  return {
    spawn: vi.fn().mockResolvedValue('exec-1'),
    waitForSubagents: vi.fn().mockResolvedValue({ count: 2 }),
    checkStatus: vi.fn().mockResolvedValue({ status: 'running' }),
  };
}

function buildService(opts: { withTerminalRunGuard?: boolean } = {}) {
  const subagentOrchestrator = makeSubagentOrchestrator();
  const containerContext = makeContainerContext();
  const terminalRunGuard = opts.withTerminalRunGuard
    ? { assertRunIsActive: vi.fn().mockResolvedValue(undefined) }
    : undefined;

  const service = new TelemetrySubagentGatewayService(
    subagentOrchestrator as never,
    containerContext,
    terminalRunGuard as never,
  );

  return { service, subagentOrchestrator, containerContext, terminalRunGuard };
}

function makeAgentClient(
  overrides: Partial<AuthenticatedSocket> = {},
): AuthenticatedSocket {
  return {
    role: 'agent',
    workflowRunId: 'run-1',
    stepId: 'step-1',
    containerId: 'container-1',
    isSubagent: false,
    emit: vi.fn(),
    ...overrides,
  } as unknown as AuthenticatedSocket;
}

describe('TelemetrySubagentGatewayService', () => {
  describe('handleSpawnSubagentAsync', () => {
    let build: ReturnType<typeof buildService>;
    beforeEach(() => {
      build = buildService({ withTerminalRunGuard: true });
    });

    it('rejects subagent orchestration on a non-agent socket', async () => {
      const client = makeAgentClient({ role: 'ui' });
      await build.service.handleSpawnSubagentAsync(client, {});

      expect(client.emit).toHaveBeenCalledWith(
        'command',
        expect.objectContaining({
          type: 'spawn_subagent_async_result',
          success: false,
          error: expect.stringContaining('require an agent socket'),
        }),
      );
      expect(build.subagentOrchestrator.spawn).not.toHaveBeenCalled();
    });

    it('spawns via the subagent orchestrator on an agent socket', async () => {
      const client = makeAgentClient({ jobId: 'job-1' });
      await build.service.handleSpawnSubagentAsync(client, {
        prompt: 'do the thing',
      });

      expect(client.emit).toHaveBeenCalledWith(
        'command',
        expect.objectContaining({
          type: 'spawn_subagent_async_result',
          success: true,
          execution_id: 'exec-1',
        }),
      );
      expect(build.subagentOrchestrator.spawn).toHaveBeenCalledWith(
        'container-1',
        expect.objectContaining({
          prompt: 'do the thing',
          tier: 'heavy',
          workflowRunId: 'run-1',
          parent_job_id: 'job-1',
        }),
      );
    });

    it('refuses to spawn for a terminal workflow run', async () => {
      const { ConflictException } = await import('@nestjs/common');
      const client = makeAgentClient();
      build.terminalRunGuard!.assertRunIsActive.mockRejectedValueOnce(
        new ConflictException('run is terminal'),
      );

      await build.service.handleSpawnSubagentAsync(client, {});

      expect(client.emit).toHaveBeenCalledWith(
        'command',
        expect.objectContaining({
          type: 'spawn_subagent_async_result',
          success: false,
          executionStatus: 'terminated',
        }),
      );
      expect(build.subagentOrchestrator.spawn).not.toHaveBeenCalled();
    });
  });

  describe('handleWaitForSubagents', () => {
    it('forwards to the orchestrator with the resolved timeout', async () => {
      const { service, subagentOrchestrator } = buildService();
      const client = makeAgentClient();

      await service.handleWaitForSubagents(client, {
        execution_ids: ['e1', 'e2'],
        timeout_seconds: 30,
      });

      expect(subagentOrchestrator.waitForSubagents).toHaveBeenCalledWith(
        'container-1',
        expect.objectContaining({
          executionIds: ['e1', 'e2'],
          timeoutSeconds: 30,
        }),
      );
      expect(client.emit).toHaveBeenCalledWith(
        'command',
        expect.objectContaining({
          type: 'wait_for_subagents_result',
          success: true,
        }),
      );
    });
  });

  describe('handleCheckSubagentStatus', () => {
    it('forwards to the orchestrator with the given execution id', async () => {
      const { service, subagentOrchestrator } = buildService();
      const client = makeAgentClient();

      await service.handleCheckSubagentStatus(client, {
        execution_id: 'exec-1',
      });

      expect(subagentOrchestrator.checkStatus).toHaveBeenCalledWith(
        'container-1',
        'exec-1',
        'run-1',
      );
      expect(client.emit).toHaveBeenCalledWith(
        'command',
        expect.objectContaining({
          type: 'check_subagent_status_result',
          success: true,
        }),
      );
    });
  });
});
