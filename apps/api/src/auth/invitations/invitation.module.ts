import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DatabaseModule } from '../../database/database.module';
import { ChannelAdaptersModule } from '../../chat/channel-adapters/channel-adapters.module';
import { Invitation } from './database/entities/invitation.entity';
import { InvitationRepository } from './database/repositories/invitation.repository';
import { InvitationService } from './invitation.service';
import { InvitationEmailService } from './invitation-email.service';
import { INVITATION_MAILER } from './invitation-mailer.port';
import { InvitationController } from './invitation.controller';
import { PublicInvitationController } from './public-invitation.controller';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    // Same pattern AuthModule uses to reach `UserRepository`: import
    // `DatabaseModule` directly rather than `UsersModule` (which itself
    // depends on `AuthModule`, and would form a cycle).
    DatabaseModule,
    TypeOrmModule.forFeature([Invitation]),
    // Supplies `EmailConfigService` + `EmailSenderService` (Tasks 4-5) that
    // back the `INVITATION_MAILER` binding below.
    ChannelAdaptersModule,
  ],
  providers: [
    InvitationService,
    InvitationRepository,
    InvitationEmailService,
    { provide: INVITATION_MAILER, useClass: InvitationEmailService },
  ],
  controllers: [InvitationController, PublicInvitationController],
  exports: [InvitationService],
})
export class InvitationModule {
  /** Invitation issuance/acceptance module (authenticated + public routes) */
  protected readonly _moduleName = 'InvitationModule';
}
