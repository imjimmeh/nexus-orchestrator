import { describe, expect, it, vi } from 'vitest';
import { StepQueueDrainerAdapter } from './step-queue-drainer.adapter';

function buildModuleRef(consumer: unknown) {
  return { get: vi.fn().mockReturnValue(consumer) };
}

describe('StepQueueDrainerAdapter', () => {
  it('calls pauseWorker() on the resolved consumer', async () => {
    const consumer = { pauseWorker: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = buildModuleRef(consumer);
    const adapter = new StepQueueDrainerAdapter(moduleRef);

    await adapter.pauseAll();

    expect(consumer.pauseWorker).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when the consumer is not resolvable (undefined)', async () => {
    const moduleRef = buildModuleRef(undefined);
    const adapter = new StepQueueDrainerAdapter(moduleRef);

    await expect(adapter.pauseAll()).resolves.toBeUndefined();
    // get was still called — the adapter looked it up
    expect(moduleRef.get).toHaveBeenCalledTimes(1);
  });

  it('resolves without throwing when pauseWorker() throws', async () => {
    const consumer = {
      pauseWorker: vi.fn().mockRejectedValue(new Error('worker error')),
    };
    const moduleRef = buildModuleRef(consumer);
    const adapter = new StepQueueDrainerAdapter(moduleRef);

    await expect(adapter.pauseAll()).resolves.toBeUndefined();
    expect(consumer.pauseWorker).toHaveBeenCalledTimes(1);
  });
});
