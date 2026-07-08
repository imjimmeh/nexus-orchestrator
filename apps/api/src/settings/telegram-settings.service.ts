import { Injectable, Logger } from '@nestjs/common';
import type {
  TelegramRuntimeSettingsV1,
  TelegramSettingsViewV1,
  UpdateTelegramSettingsRequestV1,
} from '@nexus/core';
import { SecretVaultService } from '../security/secret-vault.service';
import type { SecretStore } from '../security/database/entities/secret-store.entity';
import { SecretStoreRepository } from '../security/database/repositories/secret-store.repository';
import { TELEGRAM_SECRET_NAMES } from './telegram-settings.constants';
import { TelegramSettingsBaseReadService } from './telegram-settings-base-read.service';
import { buildTelegramNonSecretSettingUpdates } from './telegram-settings-update-builder';
import {
  buildTelegramSecretMetadata,
  readOptionalEnv,
  readOptionalTrimmedString,
  readTelegramSettingDescription,
  requireTelegramTrimmedString,
  validateTelegramSecretUpdatePayload,
} from './telegram-settings.utils';
import { SystemSettingsService } from './system-settings.service';

@Injectable()
export class TelegramSettingsService {
  private readonly logger = new Logger(TelegramSettingsService.name);
  private readonly baseSettingsReader: TelegramSettingsBaseReadService;

  constructor(
    private readonly settings: SystemSettingsService,
    private readonly secretStore: SecretStoreRepository,
    private readonly secretVault: SecretVaultService,
  ) {
    this.baseSettingsReader = new TelegramSettingsBaseReadService(
      this.settings,
    );
  }

  async getSettingsView(): Promise<TelegramSettingsViewV1> {
    const [baseSettings, botToken, webhookSecret] = await Promise.all([
      this.baseSettingsReader.readBaseSettings(),
      this.readSecretValue(
        TELEGRAM_SECRET_NAMES.botToken,
        'CHAT_TELEGRAM_BOT_TOKEN',
      ),
      this.readSecretValue(
        TELEGRAM_SECRET_NAMES.webhookSecret,
        'CHAT_TELEGRAM_WEBHOOK_SECRET',
      ),
    ]);

    return {
      ...baseSettings,
      hasBotToken: Boolean(botToken),
      hasWebhookSecret: Boolean(webhookSecret),
    };
  }

  async getRuntimeSettings(): Promise<TelegramRuntimeSettingsV1> {
    const [baseSettings, botToken, webhookSecret] = await Promise.all([
      this.baseSettingsReader.readBaseSettings(),
      this.readSecretValue(
        TELEGRAM_SECRET_NAMES.botToken,
        'CHAT_TELEGRAM_BOT_TOKEN',
      ),
      this.readSecretValue(
        TELEGRAM_SECRET_NAMES.webhookSecret,
        'CHAT_TELEGRAM_WEBHOOK_SECRET',
      ),
    ]);

    return {
      ...baseSettings,
      botToken,
      webhookSecret,
    };
  }

  async updateSettings(
    payload: UpdateTelegramSettingsRequestV1,
  ): Promise<TelegramSettingsViewV1> {
    validateTelegramSecretUpdatePayload(payload);

    await this.persistNonSecretSettings(payload);
    await this.persistSecretSettings(payload);

    return this.getSettingsView();
  }

  private async persistNonSecretSettings(
    payload: UpdateTelegramSettingsRequestV1,
  ): Promise<void> {
    const updates = buildTelegramNonSecretSettingUpdates(payload);

    for (const update of updates) {
      await this.settings.set(
        update.key,
        update.value,
        readTelegramSettingDescription(update.key),
      );
    }
  }

  private async persistSecretSettings(
    payload: UpdateTelegramSettingsRequestV1,
  ): Promise<void> {
    await this.updateSecretValue({
      secretName: TELEGRAM_SECRET_NAMES.botToken,
      nextValue: payload.botToken,
      clear: payload.clearBotToken === true,
    });

    await this.updateSecretValue({
      secretName: TELEGRAM_SECRET_NAMES.webhookSecret,
      nextValue: payload.webhookSecret,
      clear: payload.clearWebhookSecret === true,
    });
  }

  private async updateSecretValue(params: {
    secretName: string;
    nextValue: string | undefined;
    clear: boolean;
  }): Promise<void> {
    const existing = await this.secretStore.findByName(params.secretName);

    if (params.clear) {
      if (existing) {
        await this.secretStore.remove(existing.id);
      }
      return;
    }

    if (params.nextValue === undefined) {
      return;
    }

    const trimmedValue = requireTelegramTrimmedString(
      params.nextValue,
      params.secretName,
    );
    const encryptedValue = this.secretVault.encrypt(
      JSON.stringify(trimmedValue),
    );

    if (existing) {
      await this.secretStore.update(existing.id, {
        encrypted_value: encryptedValue,
        metadata: buildTelegramSecretMetadata(existing.metadata),
      });
      return;
    }

    await this.secretStore.create({
      name: params.secretName,
      encrypted_value: encryptedValue,
      metadata: buildTelegramSecretMetadata(),
    });
  }

  private async readSecretValue(
    secretName: string,
    fallbackEnvKey: string,
  ): Promise<string | null> {
    const secret = await this.secretStore.findByName(secretName);
    if (secret) {
      const decrypted = this.decryptSecretValue(secret);
      if (decrypted) {
        return decrypted;
      }
    }

    return readOptionalTrimmedString(readOptionalEnv(fallbackEnvKey));
  }

  private decryptSecretValue(secret: SecretStore): string | null {
    try {
      const decrypted = this.secretVault.decrypt(secret.encrypted_value);
      try {
        const parsed = JSON.parse(decrypted) as unknown;
        return readOptionalTrimmedString(parsed);
      } catch {
        return readOptionalTrimmedString(decrypted);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to decrypt telegram secret ${secret.name}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
