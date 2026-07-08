import { describe, expect, it, vi } from 'vitest';
import { SecretsController } from './secrets.controller';

describe('SecretsController.listSecrets default-deny scope filter', () => {
  const REQ = { user: { userId: 'user-1' } } as any;

  function makeController(accessibleIds: string[]) {
    const admin = {
      listSecrets: vi.fn().mockResolvedValue([]),
    } as any;
    const scopeAccess = {
      restrictToAccessibleScopes: vi
        .fn()
        .mockImplementation(
          async (
            _userId: string,
            _permission: string,
            requestedScopeId?: string,
          ) => {
            if (!requestedScopeId) return accessibleIds;
            return accessibleIds.includes(requestedScopeId)
              ? [requestedScopeId]
              : [];
          },
        ),
    } as any;
    return {
      controller: new SecretsController(admin, scopeAccess),
      admin,
      scopeAccess,
    };
  }

  it('with no scopeNodeId, restricts the query to the caller accessible scope set', async () => {
    const { controller, admin, scopeAccess } = makeController([
      'team-a',
      'team-a-child',
    ]);

    await controller.listSecrets(undefined, REQ);

    expect(scopeAccess.restrictToAccessibleScopes).toHaveBeenCalledWith(
      'user-1',
      'secrets:read',
      undefined,
    );
    expect(admin.listSecrets).toHaveBeenCalledWith(['team-a', 'team-a-child']);
  });

  it('with an in-subtree scopeNodeId, confines the query to that scope', async () => {
    const { controller, admin } = makeController(['team-a', 'team-a-child']);

    await controller.listSecrets('team-a-child', REQ);

    expect(admin.listSecrets).toHaveBeenCalledWith(['team-a-child']);
  });

  it('with an out-of-subtree scopeNodeId, returns an empty default-deny result', async () => {
    const { controller, admin } = makeController(['team-a']);

    await controller.listSecrets('team-z', REQ);

    expect(admin.listSecrets).toHaveBeenCalledWith([]);
  });
});
