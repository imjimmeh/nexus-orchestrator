import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../../database/database.module';
import { DatabaseModule as ChatDatabaseModule } from '../database/database.module';
import { SecurityModule } from '../../security/security.module';
import { ChatActionsModule } from '../chat-actions/chat-actions.module';
import { ChatMessagesModule } from '../chat-messages/chat-messages.module';
import { ChatSessionsModule } from '../chat-sessions/chat-sessions.module';
import type { ChatOutboundRelay } from './chat-outbound-relay.types';
import type { ChatChannelProvider } from './chat-channel-provider.types';
import type { ChannelOutboundSender } from './outbound-sender.types';
import {
  CHAT_OUTBOUND_RELAYS,
  CHAT_OUTBOUND_SENDERS,
} from './channel-adapters.tokens';
import { EmailConfigService } from './email/email-config.service';
import { EmailSenderService } from './email/email-sender.service';
import {
  MAILER_TRANSPORT_FACTORY,
  createNodemailerTransportFactory,
} from './email/mailer-transport';
import { TelegramAdapterService } from './telegram/telegram-adapter.service';
import { TelegramAgentCommandHandler } from './telegram/telegram-agent-command.handler';
import { TelegramCommandRouterService } from './telegram/telegram-command-router.service';
import { TelegramHelpCommandHandler } from './telegram/telegram-help-command.handler';
import { TelegramIngressService } from './telegram/telegram-ingress.service';
import { TelegramNewCommandHandler } from './telegram/telegram-new-command.handler';
import { TelegramOutboundRelayService } from './telegram/telegram-outbound-relay.service';
import { TelegramPollingService } from './telegram/telegram-polling.service';
import { TelegramResumeCommandHandler } from './telegram/telegram-resume-command.handler';
import { TelegramRuntimeSettingsService } from './telegram/telegram-runtime-settings.service';
import { TelegramSenderService } from './telegram/telegram-sender.service';
import { TelegramSettingsClient } from './telegram/telegram-settings.client';
import { TelegramToolApprovalHandler } from './telegram/telegram-tool-approval.handler';
import { TelegramWebhookController } from './telegram/telegram-webhook.controller';

@Module({
  imports: [
    DatabaseModule,
    ChatDatabaseModule,
    ChatActionsModule,
    ChatSessionsModule,
    ChatMessagesModule,
    ConfigModule,
    SecurityModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramAdapterService,
    TelegramAgentCommandHandler,
    TelegramCommandRouterService,
    TelegramHelpCommandHandler,
    TelegramIngressService,
    TelegramNewCommandHandler,
    TelegramOutboundRelayService,
    TelegramPollingService,
    TelegramResumeCommandHandler,
    TelegramRuntimeSettingsService,
    TelegramSenderService,
    TelegramSettingsClient,
    TelegramToolApprovalHandler,
    EmailConfigService,
    EmailSenderService,
    {
      provide: MAILER_TRANSPORT_FACTORY,
      useFactory: createNodemailerTransportFactory,
    },
    {
      /**
       * Multi-provider registry of long-running outbound relay supervisors
       * (see `chat-outbound-relay.types.ts`). Built once at module
       * construction time from the concrete relay providers currently
       * registered with Nest — only Telegram today, but the map is keyed
       * by the `ChatChannelProvider` discriminant so future channels
       * (email relay, Slack relay, etc.) plug in by adding their relay
       * to the factory's seed list without touching downstream consumers.
       */
      provide: CHAT_OUTBOUND_RELAYS,
      inject: [TelegramOutboundRelayService],
      useFactory: (
        telegramRelay: TelegramOutboundRelayService,
      ): Map<ChatChannelProvider, ChatOutboundRelay> => {
        const map = new Map<ChatChannelProvider, ChatOutboundRelay>();
        map.set(telegramRelay.provider, telegramRelay);
        return map;
      },
    },
    {
      /**
       * Multi-provider registry of single-shot outbound sender
       * implementations (`ChannelOutboundSender` in
       * `outbound-sender.types.ts`). Distinct from `CHAT_OUTBOUND_RELAYS`:
       * senders handle one-shot message dispatch (e.g. the
       * `NotificationConsumerService` delivering a queued notification),
       * while relays own the long-running poll loop that re-publishes
       * workflow-run status updates back to the channel.
       *
       * Today the registry covers Telegram (chat) and Email (invitation
       * delivery); the map is keyed by the curated `ChatChannelProvider`
       * discriminant so downstream consumers look up a sender via a
       * generic `Map.get(channel)` call instead of taking a hard
       * dependency on each provider's concrete class. Adding Slack or
       * Discord is a one-line addition here plus its own `provide:` slot
       * in the factory's seed list — no consumer-side changes required.
       */
      provide: CHAT_OUTBOUND_SENDERS,
      inject: [TelegramSenderService, EmailSenderService],
      useFactory: (
        telegramSender: TelegramSenderService,
        emailSender: EmailSenderService,
      ): Map<ChatChannelProvider, ChannelOutboundSender> => {
        const map = new Map<ChatChannelProvider, ChannelOutboundSender>();
        map.set('telegram', telegramSender);
        map.set('email', emailSender);
        return map;
      },
    },
  ],
  exports: [
    TelegramAdapterService,
    TelegramIngressService,
    TelegramRuntimeSettingsService,
    TelegramSenderService,
    TelegramSettingsClient,
    EmailSenderService,
    EmailConfigService,
    CHAT_OUTBOUND_RELAYS,
    CHAT_OUTBOUND_SENDERS,
  ],
})
export class ChannelAdaptersModule {
  protected readonly _moduleName = 'ChannelAdaptersModule';
}
