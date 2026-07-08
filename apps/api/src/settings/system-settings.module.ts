import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SecurityModule } from '../security/security.module';
import { SystemSettingsService } from './system-settings.service';
import { SystemSettingsRepository } from './system-settings.repository';
import { SystemSettingsController } from './system-settings.controller';
import { TelegramSettingsController } from './telegram-settings.controller';
import { TelegramSettingsInternalController } from './telegram-settings-internal.controller';
import { TelegramSettingsService } from './telegram-settings.service';
import { TelegramToolApprovalNotifier } from './telegram-tool-approval-notifier.service';

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    forwardRef(() => AuthorizationModule),
    forwardRef(() => SecurityModule),
    ObservabilityModule,
  ],
  controllers: [
    TelegramSettingsController,
    TelegramSettingsInternalController,
    SystemSettingsController,
  ],
  providers: [
    SystemSettingsRepository,
    SystemSettingsService,
    TelegramSettingsService,
    TelegramToolApprovalNotifier,
  ],
  exports: [
    SystemSettingsService,
    TelegramSettingsService,
    TelegramToolApprovalNotifier,
  ],
})
export class SystemSettingsModule implements OnModuleInit {
  constructor(private readonly settingsService: SystemSettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.settingsService.seedDefaults();
  }
}
