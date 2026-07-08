import { describe, it, expect } from 'vitest';
import { generateCompositeDockerfile } from './composite-dockerfile';

describe('generateCompositeDockerfile', () => {
  it('starts FROM the base image ref', () => {
    const df = generateCompositeDockerfile({
      baseImageRef: 'nexus/harness-pi:latest',
      config: { toolchains: [{ tool: 'python', version: '3.12' }] },
    });
    expect(df.split('\n')[0]).toBe('# syntax=docker/dockerfile:1.7');
    expect(df).toContain('FROM nexus/harness-pi:latest');
  });

  it('emits a mise use line for each toolchain (sorted)', () => {
    const df = generateCompositeDockerfile({
      baseImageRef: 'b',
      config: {
        toolchains: [
          { tool: 'go', version: '1.23' },
          { tool: 'python', version: '3.12' },
        ],
      },
    });
    expect(df).toContain('mise use -g go@1.23 python@3.12');
    expect(df).toContain('--mount=type=cache,target=');
  });

  it('emits an apt install line only when aptPackages present', () => {
    const without = generateCompositeDockerfile({
      baseImageRef: 'b',
      config: { toolchains: [{ tool: 'go', version: '1' }] },
    });
    expect(without).not.toContain('apt-get install');
    const withApt = generateCompositeDockerfile({
      baseImageRef: 'b',
      config: {
        toolchains: [{ tool: 'go', version: '1' }],
        aptPackages: ['libpq-dev', 'ffmpeg'],
      },
    });
    expect(withApt).toContain(
      'apt-get install -y --no-install-recommends ffmpeg libpq-dev',
    );
  });
});
