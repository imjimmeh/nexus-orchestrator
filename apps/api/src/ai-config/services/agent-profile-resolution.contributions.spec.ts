import { describe, it, expect, vi } from 'vitest';
import { AgentProfileResolutionService } from './agent-profile-resolution.service';

function makeService(harnessContributions: unknown) {
  const resolver = {
    resolve: vi.fn(async () => ({
      value: { harness_contributions: harnessContributions },
    })),
  };
  return new AgentProfileResolutionService(resolver as never);
}

describe('AgentProfileResolutionService.resolveContributions', () => {
  it("returns the profile's harness_contributions", async () => {
    const svc = makeService({
      hooks: [{ event: 'session_start', command: 'x' }],
    });
    const out = await svc.resolveContributions('p', null);
    const firstHook = out?.hooks?.[0];
    expect(
      firstHook && 'command' in firstHook ? firstHook.command : undefined,
    ).toBe('x');
  });

  it('returns undefined when the profile has none', async () => {
    const svc = makeService(null);
    expect(await svc.resolveContributions('p', null)).toBeUndefined();
  });

  it('returns undefined for an empty name', async () => {
    const svc = makeService({});
    expect(await svc.resolveContributions(undefined, null)).toBeUndefined();
  });
});
