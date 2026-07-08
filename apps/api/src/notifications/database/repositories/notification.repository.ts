import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';

interface FindInAppByUserOptions {
  limit: number;
  offset: number;
  read?: boolean | null;
}

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  async findById(id: string): Promise<Notification | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Notification[]> {
    return this.repository.find({ where: { userId } });
  }

  async create(data: Partial<Notification>): Promise<Notification> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<Notification>,
  ): Promise<Notification | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.repository.findOne({ where: { id } });
  }

  async findUnreadInAppByUserId(userId: string): Promise<Notification[]> {
    return this.repository.find({
      where: { userId, channel: 'in_app', readAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findInAppByUserId(
    userId: string,
    options: FindInAppByUserOptions = { limit: 20, offset: 0 },
  ): Promise<{ notifications: Notification[]; total: number }> {
    const where: FindOptionsWhere<Notification> = {
      userId,
      channel: 'in_app',
    };

    if (options.read === true) {
      where.readAt = Not(IsNull());
    }

    if (options.read === false) {
      where.readAt = IsNull();
    }

    const [notifications, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: options.limit,
      skip: options.offset,
    });

    return { notifications, total };
  }

  async countUnreadInAppByUserId(userId: string): Promise<number> {
    return this.repository.count({
      where: { userId, channel: 'in_app', readAt: IsNull() },
    });
  }

  async markAsRead(id: string, userId: string): Promise<Notification | null> {
    await this.repository.update(
      { id, userId, channel: 'in_app' },
      {
        readAt: new Date(),
        readByUserId: userId,
      },
    );

    return this.repository.findOne({
      where: { id, userId, channel: 'in_app' },
    });
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.repository.update(
      { userId, channel: 'in_app', readAt: IsNull() },
      {
        readAt: new Date(),
        readByUserId: userId,
      },
    );

    return result.affected ?? 0;
  }

  async findUnreadInAppByUserAndCorrelationId(
    userId: string,
    correlationId: string,
  ): Promise<Notification | null> {
    return this.repository.findOne({
      where: {
        userId,
        channel: 'in_app',
        readAt: IsNull(),
        correlationId,
      },
    });
  }

  async markUnreadInAppByCorrelationIdAsRead(
    correlationId: string,
  ): Promise<number> {
    const result = await this.repository.update(
      { channel: 'in_app', readAt: IsNull(), correlationId },
      { readAt: new Date() },
    );

    return result.affected ?? 0;
  }
}
