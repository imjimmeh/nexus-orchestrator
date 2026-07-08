import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserChannelIdentity } from '../entities/user-channel-identity.entity';

@Injectable()
export class UserChannelIdentityRepository {
  constructor(
    @InjectRepository(UserChannelIdentity)
    private readonly repository: Repository<UserChannelIdentity>,
  ) {}

  async findById(id: string): Promise<UserChannelIdentity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByUserIdAndChannel(
    userId: string,
    channel: string,
  ): Promise<UserChannelIdentity | null> {
    return this.repository.findOne({ where: { userId, channel } });
  }

  async findAllByUserId(userId: string): Promise<UserChannelIdentity[]> {
    return this.repository.find({ where: { userId } });
  }

  async findNotificationDestinationsByUserIds(
    userIds: string[],
    channel: string,
  ): Promise<UserChannelIdentity[]> {
    if (userIds.length === 0) return [];
    return this.repository.find({
      where: {
        userId: In(userIds),
        channel,
        isNotificationsDestination: true,
      },
    });
  }

  async create(
    data: Partial<UserChannelIdentity>,
  ): Promise<UserChannelIdentity> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<UserChannelIdentity>,
  ): Promise<UserChannelIdentity | null> {
    await this.repository.update(id, data);
    return this.repository.findOne({ where: { id } });
  }

  async unsetOtherNotificationDestinations(
    userId: string,
    channel: string,
    exceptIdentityId: string,
  ): Promise<void> {
    await this.repository.update(
      {
        userId,
        channel,
        isNotificationsDestination: true,
        id: exceptIdentityId,
      },
      { isNotificationsDestination: false },
    );
  }
}
