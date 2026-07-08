import { describe, it, expect, vi } from 'vitest';
import { AuthorizationController } from './authorization.controller';

describe('AuthorizationController', () => {
  it('returns the caller effective permissions at a scope', async () => {
    const authz = {
      getEffectivePermissions: vi
        .fn()
        .mockResolvedValue(new Set(['workflows:read'])),
    } as any;
    const controller = new AuthorizationController(authz);
    const res = await controller.myPermissions(
      { user: { userId: 'u1' } },
      's1',
    );
    expect(res).toEqual({ scopeNodeId: 's1', permissions: ['workflows:read'] });
  });
});
