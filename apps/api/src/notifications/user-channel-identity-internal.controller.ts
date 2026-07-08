import { Body, Controller, Post } from '@nestjs/common';
import { UserChannelIdentityRepository } from '../users/database/repositories/user-channel-identity.repository';
import { UserRepository } from '../users/database/repositories/user.repository';

class RegisterIdentityDto {
  userId?: string;
  channel!: string;
  externalUserId!: string;
  label?: string;
  isNotificationsDestination?: boolean;
}

@Controller('internal/notifications/identities')
export class UserChannelIdentityInternalController {
  constructor(
    private readonly repo: UserChannelIdentityRepository,
    private readonly userRepo: UserRepository,
  ) {}

  @Post()
  async register(@Body() dto: RegisterIdentityDto) {
    let userId: string | undefined = dto.userId;
    if (!userId) {
      const users = await this.userRepo.find({ where: { isActive: true } });
      const firstUser = users[0];
      if (!firstUser) {
        return { success: false, message: 'No active user found' };
      }
      userId = firstUser.id;
    }

    // Check if this exact identity already exists
    const allIdentities = await this.repo.findAllByUserId(userId);
    const existingIdentity = allIdentities.find(
      (i) =>
        i.channel === dto.channel && i.externalUserId === dto.externalUserId,
    );

    const shouldBeDestination = dto.isNotificationsDestination ?? true;

    if (existingIdentity) {
      // Update existing identity
      if (dto.label !== undefined) {
        await this.repo.update(existingIdentity.id, { label: dto.label });
      }

      if (shouldBeDestination && !existingIdentity.isNotificationsDestination) {
        // Unset other destinations first, then set this one
        await this.repo.unsetOtherNotificationDestinations(
          userId,
          dto.channel,
          existingIdentity.id,
        );
        await this.repo.update(existingIdentity.id, {
          isNotificationsDestination: true,
        });
      }
    } else {
      // Create new identity
      if (shouldBeDestination) {
        // Unset other destinations first
        await this.repo.unsetOtherNotificationDestinations(
          userId,
          dto.channel,
          '',
        );
      }

      await this.repo.create({
        userId,
        channel: dto.channel,
        externalUserId: dto.externalUserId,
        label: dto.label ?? null,
        isVerified: true,
        isNotificationsDestination: shouldBeDestination,
      });
    }

    return { success: true };
  }
}
