import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { NotificationGateway } from './notification.gateway';

describe('NotificationGateway', () => {
  let gateway: NotificationGateway;

  beforeEach(() => {
    gateway = new NotificationGateway({
      get: vi.fn().mockReturnValue('secret'),
    });
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  it('emits event to user room', () => {
    const emitMock = vi.fn();
    gateway.server = {
      to: vi.fn().mockReturnValue({ emit: emitMock }),
    } as never;

    gateway.broadcastToUser('user-123', 'notification:new', { id: '1' });

    expect(gateway.server.to).toHaveBeenCalledWith('user-user-123');
    expect(emitMock).toHaveBeenCalledWith('notification:new', { id: '1' });
  });

  it('disconnects unauthorized clients', () => {
    const client = {
      handshake: { auth: {}, headers: {} },
      disconnect: vi.fn(),
      join: vi.fn(),
    } as unknown as Socket;

    gateway.handleConnection(client);

    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
