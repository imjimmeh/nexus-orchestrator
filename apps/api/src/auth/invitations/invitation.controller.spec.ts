import { describe, it, expect, vi } from 'vitest';
import { InvitationController } from './invitation.controller';

const fakeReq = (userId = 'user-1') => ({
  user: { userId, email: 'u@example.com', roles: [] },
});

describe('InvitationController.issue', () => {
  it('delegates to createInvitation with invitedByUserId from the JWT subject and returns the raw token once', async () => {
    const invitation = { id: 'inv-1', scopeNodeId: 's1', roleId: 'r1' };
    const service = {
      createInvitation: vi
        .fn()
        .mockResolvedValue({ invitation, rawToken: 'raw-token-abc' }),
    } as any;
    const controller = new InvitationController(service);

    const result = await controller.issue(
      's1',
      { roleId: 'r1', email: 'invitee@example.com' },
      fakeReq('user-1'),
    );

    expect(service.createInvitation).toHaveBeenCalledWith({
      scopeNodeId: 's1',
      roleId: 'r1',
      email: 'invitee@example.com',
      invitedByUserId: 'user-1',
    });
    expect(result).toEqual({
      success: true,
      data: { invitation, inviteToken: 'raw-token-abc' },
    });
  });

  it('never takes invitedByUserId from the request body', async () => {
    const invitation = { id: 'inv-1', scopeNodeId: 's1', roleId: 'r1' };
    const service = {
      createInvitation: vi
        .fn()
        .mockResolvedValue({ invitation, rawToken: 'raw-token-abc' }),
    } as any;
    const controller = new InvitationController(service);

    await controller.issue('s1', { roleId: 'r1' }, fakeReq('actual-actor'));

    const [callArg] = service.createInvitation.mock.calls[0];
    expect(callArg.invitedByUserId).toBe('actual-actor');
  });
});

describe('InvitationController.list', () => {
  it('delegates to listInvitationsAtNode and wraps the result', async () => {
    const invitations = [{ id: 'inv-1' }, { id: 'inv-2' }];
    const service = {
      listInvitationsAtNode: vi.fn().mockResolvedValue(invitations),
    } as any;
    const controller = new InvitationController(service);

    const result = await controller.list('s1');

    expect(service.listInvitationsAtNode).toHaveBeenCalledWith('s1');
    expect(result).toEqual({ success: true, data: invitations });
  });
});

describe('InvitationController.revoke', () => {
  it('delegates to revokeInvitation with the actor id from the JWT subject', async () => {
    const service = {
      revokeInvitation: vi.fn().mockResolvedValue(undefined),
    } as any;
    const controller = new InvitationController(service);

    await controller.revoke('inv-1', fakeReq('actor-1'));

    expect(service.revokeInvitation).toHaveBeenCalledWith('inv-1', 'actor-1');
  });
});
