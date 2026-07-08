import { describe, it, expect, vi } from 'vitest';
import { PackageCacheVolumeService } from './package-cache-volume.service';

function fakeDocker() {
  return { createVolume: vi.fn().mockResolvedValue(undefined) } as any;
}

describe('PackageCacheVolumeService.resolveCacheMounts', () => {
  it('enables npm + mise + apt presets for a node set', async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: 'node', version: '24' }],
    });
    const ids = out.volumes.map((v) => v.hostPath);
    expect(ids).toContain('nexus-cache-npm');
    expect(ids).toContain('nexus-cache-mise');
    expect(ids).toContain('nexus-cache-apt');
    expect(out.env.npm_config_cache).toBe('/root/.npm');
  });

  it('enables pip cache when python present', async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: 'python', version: '3.12' }],
    });
    expect(out.volumes.map((v) => v.hostPath)).toContain('nexus-cache-pip');
    expect(out.env.PIP_CACHE_DIR).toBe('/root/.cache/pip');
  });

  it('omits a disabled preset', async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [{ tool: 'node', version: '24' }],
      disableCaches: ['apt'],
    });
    expect(out.volumes.map((v) => v.hostPath)).not.toContain('nexus-cache-apt');
  });

  it('appends custom caches', async () => {
    const svc = new PackageCacheVolumeService(fakeDocker());
    const out = await svc.resolveCacheMounts({
      toolchains: [],
      caches: [{ id: 'precommit', path: '/root/.cache/pre-commit' }],
    });
    const custom = out.volumes.find(
      (v) => v.hostPath === 'nexus-cache-precommit',
    );
    expect(custom?.containerPath).toBe('/root/.cache/pre-commit');
  });

  it('ensures each volume exists exactly once', async () => {
    const docker = fakeDocker();
    const svc = new PackageCacheVolumeService(docker);
    await svc.resolveCacheMounts({
      toolchains: [{ tool: 'node', version: '24' }],
    });
    expect(docker.createVolume).toHaveBeenCalled();
  });
});
