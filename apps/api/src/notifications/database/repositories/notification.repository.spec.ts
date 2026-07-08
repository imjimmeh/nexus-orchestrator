import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IsNull, Repository } from 'typeorm';
import { NotificationRepository } from './notification.repository';
import { Notification } from '../entities/notification.entity';

type MockTypeormRepository = Pick<
  Repository<Notification>,
  'find' | 'findOne' | 'findAndCount' | 'count' | 'create' | 'save' | 'update'
>;

describe('NotificationRepository', () => {
  let repo: NotificationRepository;
  let typeormRepo: MockTypeormRepository;

  beforeEach(() => {
    typeormRepo = {
      find: vi.fn(),
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
    };

    repo = new NotificationRepository(typeormRepo as Repository<Notification>);
  });

  it('returns unread in-app notifications for user', async () => {
    const notifications = [
      { id: 'notif-1', subject: 'Test' },
    ] as Notification[];
    vi.mocked(typeormRepo.find).mockResolvedValue(notifications);

    const result = await repo.findUnreadInAppByUserId('user-123');

    expect(typeormRepo.find).toHaveBeenCalledWith({
      where: { userId: 'user-123', channel: 'in_app', readAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    expect(result).toEqual(notifications);
  });

  it('returns unread in-app notification count', async () => {
    vi.mocked(typeormRepo.count).mockResolvedValue(5);

    const result = await repo.countUnreadInAppByUserId('user-123');

    expect(typeormRepo.count).toHaveBeenCalledWith({
      where: { userId: 'user-123', channel: 'in_app', readAt: IsNull() },
    });
    expect(result).toBe(5);
  });

  it('marks a notification as read for a user', async () => {
    const updated = {
      id: 'notif-123',
      readAt: new Date(),
      readByUserId: 'user-123',
    } as Notification;
    vi.mocked(typeormRepo.findOne).mockResolvedValue(updated);

    const result = await repo.markAsRead('notif-123', 'user-123');

    expect(typeormRepo.update).toHaveBeenCalledWith(
      { id: 'notif-123', userId: 'user-123', channel: 'in_app' },
      expect.objectContaining({
        readAt: expect.any(Date),
        readByUserId: 'user-123',
      }),
    );
    expect(result).toEqual(updated);
  });

  describe('findUnreadInAppByUserAndCorrelationId', () => {
    it('finds one unread in-app notification by user and correlation id', async () => {
      const notification = { id: 'notif-1' } as Notification;
      typeormRepo.findOne.mockResolvedValue(notification);

      const result = await repo.findUnreadInAppByUserAndCorrelationId(
        'user-1',
        'user_questions.posed:run-1',
      );

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          channel: 'in_app',
          readAt: IsNull(),
          correlationId: 'user_questions.posed:run-1',
        },
      });
      expect(result).toBe(notification);
    });
  });

  describe('markUnreadInAppByCorrelationIdAsRead', () => {
    it('marks all unread in-app notifications with the correlation id as read', async () => {
      typeormRepo.update.mockResolvedValue({ affected: 2 });

      const result = await repo.markUnreadInAppByCorrelationIdAsRead(
        'user_questions.posed:run-1',
      );

      expect(typeormRepo.update).toHaveBeenCalledWith(
        {
          channel: 'in_app',
          readAt: IsNull(),
          correlationId: 'user_questions.posed:run-1',
        },
        expect.objectContaining({ readAt: expect.any(Date) }),
      );
      expect(result).toBe(2);
    });
  });
});
