import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectRepository(Notification)
    private readonly repository: Repository<Notification>,
  ) {}

  async findById(id: string): Promise<Notification | null> {
    return this.repository.findOne({ where: { id } });
  }

  async update(
    id: string,
    data: Partial<Notification>,
  ): Promise<Notification | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.findById(id);
  }
}
