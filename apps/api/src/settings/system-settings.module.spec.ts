import { describe, expect, it } from 'vitest';
import { SystemSettingsController } from './system-settings.controller';
import { SystemSettingsModule } from './system-settings.module';
import { TelegramSettingsController } from './telegram-settings.controller';

describe('SystemSettingsModule', () => {
  it('registers telegram settings routes before generic system settings routes', () => {
    const controllers = Reflect.getMetadata(
      'controllers',
      SystemSettingsModule,
    ) as unknown[];

    expect(controllers).toContain(TelegramSettingsController);
    expect(controllers).toContain(SystemSettingsController);
    expect(controllers.indexOf(TelegramSettingsController)).toBeLessThan(
      controllers.indexOf(SystemSettingsController),
    );
  });
});
