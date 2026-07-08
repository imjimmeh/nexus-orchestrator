import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { NotificationInboxController } from './notification-inbox.controller';
import type { NotificationRepository } from './database/repositories/notification.repository';

describe('NotificationInboxController', () => {
  let controller: NotificationInboxController;
  const mockRepo = {
    findInAppByUserId: vi.fn(),
    countUnreadInAppByUserId: vi.fn(),
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  } as unknown as NotificationRepository;

  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    controller = new NotificationInboxController(mockRepo);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns notifications with pagination', async () => {
    const notifications = [{ id: '1', subject: 'Test' }];
    vi.mocked(mockRepo.findInAppByUserId).mockResolvedValue({
      notifications: notifications as never[],
      total: 1,
    });

    const result = await controller.getInbox(
      { user: { userId: 'user-123' } },
      10,
      0,
      undefined,
    );

    expect(result).toEqual({
      success: true,
      data: notifications,
      meta: { total: 1, limit: 10, offset: 0 },
    });
  });

  it('returns unread count', async () => {
    vi.mocked(mockRepo.countUnreadInAppByUserId).mockResolvedValue(5);

    const result = await controller.getUnreadCount({
      user: { userId: 'user-123' },
    });

    expect(result).toEqual({ success: true, data: { count: 5 } });
  });

  it('marks notification as read', async () => {
    const updated = { id: '1', readAt: new Date() };
    vi.mocked(mockRepo.markAsRead).mockResolvedValue(updated);

    const result = await controller.markAsRead('1', {
      user: { userId: 'user-123' },
    });

    expect(result).toEqual({ success: true, data: updated });
  });

  it('marks all notifications as read', async () => {
    vi.mocked(mockRepo.markAllAsRead).mockResolvedValue(3);

    const result = await controller.markAllAsRead(
      { user: { userId: 'user-123' } },
      {},
    );

    expect(result).toEqual({ success: true, data: { markedAsRead: 3 } });
  });

  it('throws when no authenticated user is available', async () => {
    await expect(
      controller.getUnreadCount({ user: {} }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  describe('getWebsocketConfig', () => {
    it('returns wsUrl and namespace from TELEMETRY_PUBLIC_WS_URL env var', () => {
      process.env.TELEMETRY_PUBLIC_WS_URL = 'http://localhost:3011';

      const result = controller.getWebsocketConfig();

      expect(result).toEqual({
        success: true,
        data: {
          wsUrl: 'http://localhost:3011',
          namespace: '/notifications',
        },
      });
    });

    it('falls back to host-based URL when no env var is set', () => {
      delete process.env.TELEMETRY_PUBLIC_WS_URL;
      delete process.env.TELEMETRY_WS_URL;
      delete process.env.WEBSOCKET_URL;

      const result = controller.getWebsocketConfig({
        hostname: 'my-host',
        secure: false,
      } as never);

      expect(result.data.wsUrl).toBe('http://my-host:3001');
      expect(result.data.namespace).toBe('/notifications');
    });

    it('falls back to TELEMETRY_WS_URL', () => {
      process.env.TELEMETRY_WS_URL = 'http://telemetry-host:3001';
      delete process.env.TELEMETRY_PUBLIC_WS_URL;

      const result = controller.getWebsocketConfig();

      expect(result.data.wsUrl).toBe('http://telemetry-host:3001');
    });

    it('falls back to WEBSOCKET_URL', () => {
      process.env.WEBSOCKET_URL = 'http://ws-host:3001';
      delete process.env.TELEMETRY_PUBLIC_WS_URL;
      delete process.env.TELEMETRY_WS_URL;

      const result = controller.getWebsocketConfig();

      expect(result.data.wsUrl).toBe('http://ws-host:3001');
    });

    it('uses https when request is secure', () => {
      delete process.env.TELEMETRY_PUBLIC_WS_URL;
      delete process.env.TELEMETRY_WS_URL;
      delete process.env.WEBSOCKET_URL;

      const result = controller.getWebsocketConfig({
        hostname: 'secure-host',
        secure: true,
      } as never);

      expect(result.data.wsUrl).toBe('https://secure-host:3001');
    });
  });
});
