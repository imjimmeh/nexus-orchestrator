import { describe, expect, it, vi } from 'vitest';
import {
  handleCommandStartedGatewayCompat,
  handleCommandOutputGatewayCompat,
  handleCommandFinishedGatewayCompat,
} from './command-output-gateway.helpers';

function deps() {
  return {
    streamService: { persistEvent: vi.fn().mockResolvedValue(undefined) },
    pubsubService: { publishEvent: vi.fn().mockResolvedValue(undefined) },
  };
}
const RUN = 'run-1';

describe('command output gateway compat', () => {
  it('persists and publishes command_started', async () => {
    const d = deps();
    await handleCommandStartedGatewayCompat({
      workflowRunId: RUN,
      payload: { stepId: 'run_gate', command: 'npm test' },
      ...d,
    });
    expect(d.streamService.persistEvent).toHaveBeenCalledOnce();
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
  });

  it('publishes command_output live but does NOT persist it to the replay stream', async () => {
    const d = deps();
    await handleCommandOutputGatewayCompat({
      workflowRunId: RUN,
      payload: {
        stepId: 'run_gate',
        stream: 'stdout',
        chunk: 'PASS\n',
        seq: 1,
      },
      ...d,
    });
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
    expect(d.streamService.persistEvent).not.toHaveBeenCalled();
  });

  it('persists and publishes command_finished', async () => {
    const d = deps();
    await handleCommandFinishedGatewayCompat({
      workflowRunId: RUN,
      payload: {
        stepId: 'run_gate',
        exitCode: 0,
        timedOut: false,
        ok: true,
        outputTail: 'PASS',
      },
      ...d,
    });
    expect(d.streamService.persistEvent).toHaveBeenCalledOnce();
    expect(d.pubsubService.publishEvent).toHaveBeenCalledOnce();
  });
});
