import { describe, it, expect, vi } from 'vitest';
import { applyRuntimeToolchains } from './step-agent-container-support.runtime-toolchains';

describe('applyRuntimeToolchains', () => {
  it('overrides image and appends cache volumes + env onto the container config', async () => {
    const baseConfig = {
      image: 'nexus/harness-pi:latest',
      tier: 'heavy',
      env: { A: '1' },
      volumes: [
        { hostPath: '/ws', containerPath: '/workspace', readOnly: false },
      ],
    } as any;
    const resolver = {
      resolve: vi.fn().mockResolvedValue({
        toolchains: [{ tool: 'python', version: '3.12' }],
      }),
    };
    const imageResolver = {
      resolveImageRef: vi.fn().mockResolvedValue('nexus-rt/pi:deadbeef0000'),
    };
    const cacheSvc = {
      resolveCacheMounts: vi.fn().mockResolvedValue({
        volumes: [
          {
            hostPath: 'nexus-cache-pip',
            containerPath: '/root/.cache/pip',
            readOnly: false,
          },
        ],
        env: { PIP_CACHE_DIR: '/root/.cache/pip' },
      }),
    };

    const out = await applyRuntimeToolchains({
      config: baseConfig,
      harnessId: 'pi',
      baseImageRef: 'nexus/harness-pi:latest',
      resolverInputs: { workspacePath: '/ws' },
      resolver,
      imageResolver,
      cacheService: cacheSvc,
    });

    expect(out.image).toBe('nexus-rt/pi:deadbeef0000');
    expect(out.env.PIP_CACHE_DIR).toBe('/root/.cache/pip');
    expect(out.volumes).toContainEqual({
      hostPath: 'nexus-cache-pip',
      containerPath: '/root/.cache/pip',
      readOnly: false,
    });
    expect(out.volumes).toContainEqual({
      hostPath: '/ws',
      containerPath: '/workspace',
      readOnly: false,
    });
  });
});
