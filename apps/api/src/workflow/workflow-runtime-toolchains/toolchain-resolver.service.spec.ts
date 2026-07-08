import { describe, it, expect, vi } from 'vitest';
import { ToolchainResolverService } from './toolchain-resolver.service';

describe('ToolchainResolverService.resolve', () => {
  it('prefers step over profile over run input', async () => {
    const detector = { detect: vi.fn().mockResolvedValue([]) } as any;
    const svc = new ToolchainResolverService(detector);
    const out = await svc.resolve({
      stepConfig: { toolchains: [{ tool: 'go', version: '1.23' }] },
      agentProfileConfig: { toolchains: [{ tool: 'python', version: '3.12' }] },
      runInputConfig: { toolchains: [{ tool: 'rust', version: '1.80' }] },
    });
    expect(out.toolchains).toEqual([{ tool: 'go', version: '1.23' }]);
  });

  it('falls back to repo detection when no explicit layer', async () => {
    const detector = {
      detect: vi.fn().mockResolvedValue([{ tool: 'python', version: '3.12' }]),
    } as any;
    const svc = new ToolchainResolverService(detector);
    const out = await svc.resolve({ workspacePath: '/ws' });
    expect(out.toolchains).toEqual([{ tool: 'python', version: '3.12' }]);
  });

  it('throws on an invalid explicit toolchain before merge', async () => {
    const detector = { detect: vi.fn().mockResolvedValue([]) } as any;
    const svc = new ToolchainResolverService(detector);
    await expect(
      svc.resolve({
        stepConfig: { toolchains: [{ tool: 'evil', version: '1' }] },
      }),
    ).rejects.toThrow();
  });

  it('throws when the repo-detected layer contains an unsupported tool', async () => {
    const detector = {
      detect: vi.fn().mockResolvedValue([{ tool: 'evil', version: '1' }]),
    } as any;
    const svc = new ToolchainResolverService(detector);
    await expect(svc.resolve({ workspacePath: '/ws' })).rejects.toThrow(
      'Unsupported toolchain tool: evil',
    );
  });

  it('throws when the repo-detected layer contains a shell-injection version string', async () => {
    const detector = {
      detect: vi
        .fn()
        .mockResolvedValue([{ tool: 'python', version: '1; rm -rf /' }]),
    } as any;
    const svc = new ToolchainResolverService(detector);
    await expect(svc.resolve({ workspacePath: '/ws' })).rejects.toThrow(
      'Invalid version for python: 1; rm -rf /',
    );
  });
});
