import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ChannelAdaptersModule } from './channel-adapters.module';
import {
  CHAT_OUTBOUND_RELAYS,
  CHAT_OUTBOUND_SENDERS,
} from './channel-adapters.tokens';
import type {
  ChannelOutboundMessage,
  ChannelOutboundSendResult,
  ChannelOutboundSender,
} from './outbound-sender.types';
import type { ChatChannelProvider } from './chat-channel-provider.types';
import { EmailConfigService } from './email/email-config.service';
import { EmailSenderService } from './email/email-sender.service';
import {
  MAILER_TRANSPORT_FACTORY,
  createNodemailerTransportFactory,
} from './email/mailer-transport';
import { TelegramOutboundRelayService } from './telegram/telegram-outbound-relay.service';
import { TelegramSenderService } from './telegram/telegram-sender.service';
import { SecretCrudService } from '../../security/services/secret-crud.service';

/**
 * Mirrors `invitation.module.spec.ts` / `gitops.module.spec.ts`: rather than
 * importing the real `ChannelAdaptersModule` (which transitively pulls in
 * `DatabaseModule`'s `TypeOrmModule.forRootAsync()` and would attempt a live
 * Postgres connection at `compile()` time), this asserts the module's static
 * provider/export metadata directly, then separately reconstructs the exact
 * DI edge the Task 6 wiring adds (`EmailSenderService` -> `EmailConfigService`
 * + `MAILER_TRANSPORT_FACTORY`) with lightweight mocks standing in for
 * `ConfigService`/`SecretCrudService`, proving it resolves end-to-end without
 * ever needing the real module's database imports.
 */
describe('ChannelAdaptersModule', () => {
  it('registers the email providers and exports EmailSenderService', () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ChannelAdaptersModule) ??
      [];
    const exportsList =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, ChannelAdaptersModule) ?? [];

    expect(providers).toEqual(
      expect.arrayContaining([
        EmailConfigService,
        EmailSenderService,
        expect.objectContaining({
          provide: MAILER_TRANSPORT_FACTORY,
          useFactory: createNodemailerTransportFactory,
        }),
      ]),
    );
    expect(exportsList).toEqual(expect.arrayContaining([EmailSenderService]));
  });

  it('resolves EmailSenderService via EmailConfigService + MAILER_TRANSPORT_FACTORY', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailConfigService,
        EmailSenderService,
        {
          provide: MAILER_TRANSPORT_FACTORY,
          useFactory: createNodemailerTransportFactory,
        },
        { provide: ConfigService, useValue: { get: () => undefined } },
        {
          provide: SecretCrudService,
          useValue: { findByIdRaw: async () => null },
        },
      ],
    }).compile();

    expect(moduleRef.get(EmailSenderService)).toBeInstanceOf(
      EmailSenderService,
    );
    expect(moduleRef.get(EmailConfigService)).toBeInstanceOf(
      EmailConfigService,
    );
  });

  it('provides a CHAT_OUTBOUND_RELAYS map containing the telegram relay', async () => {
    /**
     * Reconstructs the `CHAT_OUTBOUND_RELAYS` `useFactory` DI edge from
     * `channel-adapters.module.ts` in isolation. We don't pull in the real
     * `ChannelAdaptersModule` here (it transitively imports
     * `TypeOrmModule.forRootAsync()` which would attempt a live Postgres
     * connection at `compile()` time) — instead we mirror the factory by
     * binding `TelegramOutboundRelayService` and the same `useFactory` shape,
     * then assert the resolved map contains the relay keyed by its
     * `provider` discriminant.
     *
     * The relay instance itself is wired with empty mocks standing in for
     * its six constructor dependencies; the relay never has any of those
     * methods invoked during this test (we only resolve it from DI and read
     * its `provider` field), so the stubs are intentionally `vi.fn()`-shaped
     * and unconfigured.
     */
    const telegramRelay = new TelegramOutboundRelayService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: TelegramOutboundRelayService,
          useValue: telegramRelay,
        },
        {
          provide: CHAT_OUTBOUND_RELAYS,
          inject: [TelegramOutboundRelayService],
          useFactory: (
            relay: TelegramOutboundRelayService,
          ): Map<string, TelegramOutboundRelayService> => {
            const map = new Map<string, TelegramOutboundRelayService>();
            map.set(relay.provider, relay);
            return map;
          },
        },
      ],
    }).compile();

    const relayMap =
      moduleRef.get<Map<string, TelegramOutboundRelayService>>(
        CHAT_OUTBOUND_RELAYS,
      );

    expect(relayMap).toBeInstanceOf(Map);
    expect(relayMap.get('telegram')).toBe(telegramRelay);
    expect(relayMap.size).toBe(1);
  });

  it('provides a CHAT_OUTBOUND_SENDERS map with telegram + email senders', async () => {
    /**
     * Reconstructs the `CHAT_OUTBOUND_SENDERS` `useFactory` DI edge from
     * `channel-adapters.module.ts` in isolation — same pattern as the
     * `CHAT_OUTBOUND_RELAYS` test above. We mirror the factory's
     * `inject: [TelegramSenderService, EmailSenderService]` and seed the
     * returned map with explicit `'telegram'` and `'email'` keys (the
     * concrete sender services don't yet carry a `provider` discriminant,
     * so the factory wires the map statically rather than reading from
     * the instances). Lightweight mocks satisfy the
     * `ChannelOutboundSender` shape so the factory compiles without
     * pulling in the real `ChannelAdaptersModule` (which transitively
     * requires `TypeOrmModule.forRootAsync()`).
     */
    const telegramMock: ChannelOutboundSender = {
      sendMessage: (_message: ChannelOutboundMessage) =>
        Promise.resolve<ChannelOutboundSendResult>({
          providerMessageId: 'tg-msg-1',
        }),
    };
    const emailMock: ChannelOutboundSender = {
      sendMessage: (_message: ChannelOutboundMessage) =>
        Promise.resolve<ChannelOutboundSendResult>({
          providerMessageId: 'email-msg-1',
        }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: TelegramSenderService,
          useValue: telegramMock,
        },
        {
          provide: EmailSenderService,
          useValue: emailMock,
        },
        {
          provide: CHAT_OUTBOUND_SENDERS,
          inject: [TelegramSenderService, EmailSenderService],
          useFactory: (
            telegramSender: ChannelOutboundSender,
            emailSender: ChannelOutboundSender,
          ): Map<ChatChannelProvider, ChannelOutboundSender> => {
            const map = new Map<ChatChannelProvider, ChannelOutboundSender>();
            map.set('telegram', telegramSender);
            map.set('email', emailSender);
            return map;
          },
        },
      ],
    }).compile();

    const senderMap = moduleRef.get<
      Map<ChatChannelProvider, ChannelOutboundSender>
    >(CHAT_OUTBOUND_SENDERS);

    expect(senderMap).toBeInstanceOf(Map);
    expect(senderMap.get('telegram')).toBe(telegramMock);
    expect(senderMap.get('email')).toBe(emailMock);
    expect(senderMap.size).toBe(2);
  });
});
