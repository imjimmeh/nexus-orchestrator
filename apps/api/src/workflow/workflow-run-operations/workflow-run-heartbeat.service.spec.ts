import { describe, it, expect, vi } from 'vitest';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunHeartbeatService } from './workflow-run-heartbeat.service';

describe('WorkflowRunHeartbeatService', () => {
  it('touches on first activity and suppresses within the interval', async () => {
    const touch = vi.fn().mockResolvedValue(undefined);
    let now = 1_000;
    const service = new WorkflowRunHeartbeatService({
      touch,
    } as unknown as IWorkflowRunRepository);
    (service as unknown as { now: () => number }).now = () => now;

    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(1);

    now += 5_000; // inside 15s interval
    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(1);

    now += 15_000; // past interval
    service.recordActivity('run-1');
    await Promise.resolve();
    expect(touch).toHaveBeenCalledTimes(2);
  });

  it('never rejects when touch throws', async () => {
    const touch = vi.fn().mockRejectedValue(new Error('db down'));
    const service = new WorkflowRunHeartbeatService({
      touch,
    } as unknown as IWorkflowRunRepository);
    expect(() => {
      service.recordActivity('run-1');
    }).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
