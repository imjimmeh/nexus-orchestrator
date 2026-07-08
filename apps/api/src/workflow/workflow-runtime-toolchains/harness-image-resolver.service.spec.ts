import { describe, it, expect, vi } from 'vitest';
import { HarnessImageResolver } from './harness-image-resolver.service';

describe('HarnessImageResolver.resolveImageRef', () => {
  it('returns the base image for a node-only set without building', async () => {
    const builder = { ensureImage: vi.fn() } as any;
    const r = new HarnessImageResolver(builder);
    const ref = await r.resolveImageRef({
      harnessId: 'pi',
      baseImageRef: 'nexus/harness-pi:latest',
      config: { toolchains: [{ tool: 'node', version: '24' }] },
    });
    expect(ref).toBe('nexus/harness-pi:latest');
    expect(builder.ensureImage).not.toHaveBeenCalled();
  });

  it('builds a composite for a non-node set', async () => {
    const builder = {
      ensureImage: vi.fn().mockResolvedValue('nexus-rt/pi:abc123abc123'),
    } as any;
    const r = new HarnessImageResolver(builder);
    const ref = await r.resolveImageRef({
      harnessId: 'pi',
      baseImageRef: 'nexus/harness-pi:latest',
      config: { toolchains: [{ tool: 'python', version: '3.12' }] },
    });
    expect(ref).toBe('nexus-rt/pi:abc123abc123');
    expect(builder.ensureImage).toHaveBeenCalledOnce();
  });
});
