import { describe, it, expect, vi } from 'vitest';
import { CompositeImageBuilderService } from './composite-image-builder.service';
import { CompositeImageBuildError } from './composite-image-build.error';

function dockerWith(opts: { existing: Set<string> }) {
  return {
    getImage: (ref: string) => ({
      inspect: vi.fn().mockImplementation(async () => {
        if (ref.startsWith('nexus/harness')) return { Id: 'sha256:base' };
        if (opts.existing.has(ref)) return { Id: 'sha256:' + ref };
        throw new Error('no such image');
      }),
    }),
    buildImage: vi.fn(),
    modem: { followProgress: vi.fn() },
  } as any;
}

const config = { toolchains: [{ tool: 'python', version: '3.12' }] };

describe('CompositeImageBuilderService.ensureImage', () => {
  it('returns the cached tag without building when image exists', async () => {
    const docker = dockerWith({ existing: new Set() });
    const svc = new CompositeImageBuilderService(docker);
    const tag = 'nexus-rt/pi:' + '0'.repeat(12); // compute via the real fn in impl; here we assert no build for a pre-seeded tag
    // pre-seed: make inspect of the computed tag succeed
    const expectedTag = (svc as any).tagFor('pi', 'sha256:base', config);
    docker.getImage = (ref: string) => ({
      inspect: async () => {
        if (ref === expectedTag) return { Id: 'x' };
        if (ref.startsWith('nexus/harness')) return { Id: 'sha256:base' };
        return Promise.reject(new Error('no'));
      },
    });
    const result = await svc.ensureImage({
      harnessId: 'pi',
      baseImageRef: 'nexus/harness-pi:latest',
      config,
    });
    expect(result).toBe(expectedTag);
    expect(docker.buildImage).not.toHaveBeenCalled();
  });

  it('de-dupes concurrent builds of the same tag (one build)', async () => {
    const docker = dockerWith({ existing: new Set() });
    let builds = 0;
    docker.buildImage = vi.fn(async () => {
      builds++;
      return {};
    });
    docker.modem.followProgress = (_s: unknown, cb: (e: unknown) => void) => {
      cb(null);
    };
    const svc = new CompositeImageBuilderService(docker);
    await Promise.all([
      svc.ensureImage({
        harnessId: 'pi',
        baseImageRef: 'nexus/harness-pi:latest',
        config,
      }),
      svc.ensureImage({
        harnessId: 'pi',
        baseImageRef: 'nexus/harness-pi:latest',
        config,
      }),
    ]);
    expect(builds).toBe(1);
  });

  it('throws CompositeImageBuildError and clears the lock on failure', async () => {
    const docker = dockerWith({ existing: new Set() });
    docker.buildImage = vi.fn(async () => ({}));
    docker.modem.followProgress = (_s: unknown, cb: (e: unknown) => void) => {
      cb(new Error('mise install boom '));
    };
    const svc = new CompositeImageBuilderService(docker);
    await expect(
      svc.ensureImage({
        harnessId: 'pi',
        baseImageRef: 'nexus/harness-pi:latest',
        config,
      }),
    ).rejects.toBeInstanceOf(CompositeImageBuildError);
    // lock cleared: a second call attempts to build again
    await expect(
      svc.ensureImage({
        harnessId: 'pi',
        baseImageRef: 'nexus/harness-pi:latest',
        config,
      }),
    ).rejects.toBeInstanceOf(CompositeImageBuildError);
    expect(docker.buildImage.mock.calls.length).toBe(2);
  });
});
