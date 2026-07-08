import { BadGatewayException, Injectable, Optional } from '@nestjs/common';
import type {
  ChannelAdapter,
  InboundChannelMessage,
} from '../channel-adapter.types';
import type {
  ChannelOutboundMessage,
  ChannelOutboundSendResult,
} from '../outbound-sender.types';
import type { TelegramUpdatePayload } from './telegram-adapter.types';
import type { TelegramCommandMetadata } from './telegram-command.types';
import { TelegramRuntimeSettingsService } from './telegram-runtime-settings.service';
import { TelegramSenderService } from './telegram-sender.service';

type ParsedTelegramCallbackQuery = {
  callbackQueryId: string;
  externalThreadId: string;
  providerMessageId: string;
  externalUserId: string;
  data: string;
};

type ParsedTelegramMessage = {
  text: string;
  externalThreadId: string;
  externalUserId: string;
  providerMessageId: string;
  correlationId: string;
  username: string | null;
  chatType: string | null;
  command: TelegramCommandMetadata | null;
};

@Injectable()
export class TelegramAdapterService implements ChannelAdapter {
  readonly provider = 'telegram';

  constructor(
    private readonly settings: TelegramRuntimeSettingsService,
    /**
     * Optional so the historical direct-construction test fixture
     * (`new TelegramAdapterService(settings as never)` in
     * `telegram-adapter.service.spec.ts`) keeps compiling and passing without
     * modification. At runtime in NestJS DI the module always provides
     * `TelegramSenderService`, so this is never actually `undefined` in
     * production — `@Optional()` only relaxes the constructor arity for
     * direct-instantiation unit tests while still allowing the
     * `ChannelAdapter` intersection contract to be honoured at the type level.
     */
    @Optional() private readonly sender?: TelegramSenderService,
  ) {}

  async validateWebhookSecret(
    secretHeader: string | undefined,
  ): Promise<boolean> {
    const runtimeSettings = await this.settings.getSettings();
    const expected = runtimeSettings.webhookSecret;
    if (!expected) {
      return true;
    }

    return secretHeader === expected;
  }

  /**
   * Outbound-side of the `ChannelAdapter` intersection. Delegates to
   * `TelegramSenderService` so the actual Telegram API call surface stays
   * in a single, well-tested service (the standalone sender has its own
   * `telegram-sender.service.spec.ts`). When constructed outside of DI
   * (the historical test fixture), the optional sender is `undefined` and
   * we surface a `BadGatewayException` rather than throwing a
   * `TypeError` on `undefined.sendMessage`.
   */
  async sendMessage(
    message: ChannelOutboundMessage,
  ): Promise<ChannelOutboundSendResult> {
    if (!this.sender) {
      throw new BadGatewayException(
        'TelegramAdapterService.sendMessage requires an injected TelegramSenderService',
      );
    }

    return this.sender.sendMessage(message);
  }

  extractInboundMessage(payload: unknown): InboundChannelMessage | null {
    const parsed = this.parseInboundPayload(payload);
    if (!parsed) {
      return null;
    }

    return {
      provider: this.provider,
      channel: this.provider,
      externalUserId: parsed.externalUserId,
      externalThreadId: parsed.externalThreadId,
      providerMessageId: parsed.providerMessageId,
      correlationId: parsed.correlationId,
      text: parsed.text,
      metadata: {
        username: parsed.username,
        chatType: parsed.chatType,
        telegramCommand: parsed.command,
      },
    };
  }

  extractCallbackQuery(payload: unknown): ParsedTelegramCallbackQuery | null {
    const update = payload as TelegramUpdatePayload;
    const callbackQuery = update?.callback_query;
    if (!callbackQuery) {
      return null;
    }

    const callbackQueryId = callbackQuery.id;
    const externalUserId = this.readNumericString(callbackQuery.from?.id);
    const message = callbackQuery.message;
    const externalThreadId = this.readNumericString(message?.chat?.id);
    const providerMessageId = this.readNumericString(message?.message_id);
    const data = this.readText(callbackQuery.data);

    if (
      !this.hasRequiredCallbackFields({
        callbackQueryId,
        externalUserId,
        externalThreadId,
        providerMessageId,
        data,
      })
    ) {
      return null;
    }

    return {
      callbackQueryId,
      externalThreadId: externalThreadId as string,
      providerMessageId: providerMessageId as string,
      externalUserId: externalUserId as string,
      data: data as string,
    };
  }

  private hasRequiredCallbackFields(fields: {
    callbackQueryId?: string;
    externalUserId?: string | null;
    externalThreadId?: string | null;
    providerMessageId?: string | null;
    data?: string | null;
  }): boolean {
    return Boolean(
      fields.callbackQueryId &&
      fields.externalUserId &&
      fields.externalThreadId &&
      fields.providerMessageId &&
      fields.data,
    );
  }

  private parseInboundPayload(payload: unknown): ParsedTelegramMessage | null {
    const update = payload as TelegramUpdatePayload;
    const message = update?.message;
    if (!message) {
      return null;
    }

    const base = this.readRequiredMessageFields(message);
    if (!base) {
      return null;
    }

    const correlationId = this.buildCorrelationId(
      update.update_id,
      base.providerMessageId,
    );
    const command = this.parseCommand(base.text);

    return {
      ...base,
      correlationId,
      username: this.readText(message.from?.username),
      chatType: this.readText(message.chat?.type),
      command,
    };
  }

  private readRequiredMessageFields(message: {
    text?: string;
    chat?: { id?: number };
    from?: { id?: number };
    message_id: number;
  }): Omit<
    ParsedTelegramMessage,
    'correlationId' | 'username' | 'chatType' | 'command'
  > | null {
    const text = this.readText(message.text);
    const externalThreadId = this.readNumericString(message.chat?.id);
    const externalUserId = this.readNumericString(message.from?.id);
    const providerMessageId = this.readNumericString(message.message_id);

    if (!text || !externalThreadId || !externalUserId || !providerMessageId) {
      return null;
    }

    return {
      text,
      externalThreadId,
      externalUserId,
      providerMessageId,
    };
  }

  private buildCorrelationId(
    updateId: number | undefined,
    providerMessageId: string,
  ): string {
    const correlationSeed =
      this.readNumericString(updateId) ?? providerMessageId;
    return `telegram:${correlationSeed}`;
  }

  private readText(value: string | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readNumericString(value: number | undefined): string | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    return `${value}`;
  }

  private parseCommand(text: string): TelegramCommandMetadata | null {
    if (!text.startsWith('/')) {
      return null;
    }

    const [rawCommand, ...args] = text.split(/\s+/u);
    const commandToken = rawCommand.slice(1).trim();
    if (!commandToken) {
      return null;
    }

    const commandName = commandToken.split('@')[0]?.trim().toLowerCase() ?? '';
    if (!/^[a-z][a-z0-9_]*$/u.test(commandName)) {
      return null;
    }

    return {
      name: commandName,
      args,
    };
  }
}
