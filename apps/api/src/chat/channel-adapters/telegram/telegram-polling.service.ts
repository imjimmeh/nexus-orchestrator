import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  TelegramGetUpdatesResponse,
  TelegramUpdatePayload,
} from './telegram-adapter.types';
import { TelegramIngressService } from './telegram-ingress.service';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';

const DEFAULT_DISABLED_WAIT_MS = 1000;

@Injectable()
export class TelegramPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);

  private isRunning = false;
  private waitHandle: NodeJS.Timeout | null = null;
  private nextOffset: number | null = null;
  private missingTokenWarned = false;

  constructor(
    private readonly settings: TelegramRuntimeSettingsService,
    private readonly ingress: TelegramIngressService,
  ) {}

  onModuleInit(): void {
    this.isRunning = true;
    this.logger.log('Telegram polling ingress supervisor started');
    void this.pollLoop();
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    if (!this.waitHandle) {
      return;
    }

    clearTimeout(this.waitHandle);
    this.waitHandle = null;
  }

  private async pollLoop(): Promise<void> {
    let retryDelay = DEFAULT_DISABLED_WAIT_MS;

    while (this.isRunning) {
      const runtimeSettings = await this.settings.getSettings();

      if (!this.isPollingEnabled(runtimeSettings.ingressMode)) {
        retryDelay = runtimeSettings.pollRetryDelayMs;
        await this.wait(runtimeSettings.pollRetryDelayMs);
        continue;
      }

      if (!runtimeSettings.botToken) {
        if (!this.missingTokenWarned) {
          this.logger.warn(
            'Telegram polling is enabled, but bot token is not configured',
          );
          this.missingTokenWarned = true;
        }

        retryDelay = runtimeSettings.pollRetryDelayMs;
        await this.wait(runtimeSettings.pollRetryDelayMs);
        continue;
      }

      this.missingTokenWarned = false;

      try {
        await this.pollOnce(
          runtimeSettings.botToken,
          runtimeSettings.pollTimeoutSeconds,
        );
        retryDelay = runtimeSettings.pollRetryDelayMs;
      } catch (error) {
        this.logger.warn(
          `Telegram polling iteration failed: ${(error as Error).message}`,
        );
        await this.wait(retryDelay);
        retryDelay = Math.min(retryDelay * 2, runtimeSettings.pollBackoffMaxMs);
      }
    }
  }

  private async pollOnce(
    token: string,
    pollTimeoutSeconds = 50,
  ): Promise<void> {
    const { response, body } = await this.fetchUpdates(
      token,
      pollTimeoutSeconds,
    );
    const updates = this.readValidatedUpdates(response, body);

    for (const update of updates) {
      await this.ingress.handlePayload(update, 'telegram_polling');
    }

    const maxUpdateId = this.readMaxUpdateId(updates);

    if (maxUpdateId !== null) {
      this.nextOffset = maxUpdateId + 1;
    }
  }

  private async fetchUpdates(
    token: string,
    pollTimeoutSeconds: number,
  ): Promise<{
    response: Response;
    body: TelegramGetUpdatesResponse;
  }> {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/getUpdates`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          timeout: pollTimeoutSeconds,
          allowed_updates: ['message'],
          ...(typeof this.nextOffset === 'number'
            ? { offset: this.nextOffset }
            : {}),
        }),
      },
    );

    const body = (await response.json()) as TelegramGetUpdatesResponse;
    return { response, body };
  }

  private readValidatedUpdates(
    response: Response,
    body: TelegramGetUpdatesResponse,
  ): TelegramUpdatePayload[] {
    if (response.ok && body.ok === true && Array.isArray(body.result)) {
      return body.result;
    }

    const description =
      typeof body.description === 'string'
        ? body.description
        : response.statusText;
    throw new Error(`Telegram getUpdates failed: ${description}`);
  }

  private readMaxUpdateId(updates: TelegramUpdatePayload[]): number | null {
    return updates.reduce<number | null>((currentMax, update) => {
      if (typeof update.update_id !== 'number') {
        return currentMax;
      }

      return currentMax === null
        ? update.update_id
        : Math.max(currentMax, update.update_id);
    }, null);
  }

  private isPollingEnabled(mode: string): boolean {
    const normalized = mode.toLowerCase();
    return normalized === 'polling' || normalized === 'hybrid';
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.waitHandle = setTimeout(() => {
        this.waitHandle = null;
        resolve();
      }, ms);
    });
  }
}
