import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationConsumerService } from './notification-consumer.service';
import type { NotificationRepository } from '../database/repositories/notification.repository';
import type { ChatChannelProvider } from '../channel-adapters/chat-channel-provider.types';
import type { ChannelOutboundSender } from '../channel-adapters/outbound-sender.types';
import type { Redis } from 'ioredis';

describe('NotificationConsumerService', () => {
  let service: NotificationConsumerService;
  const findByIdMock = vi.fn();
  const updateMock = vi.fn();
  const sendMessageMock = vi.fn();
  const emailSendMock = vi.fn();
  const xreadgroupMock = vi.fn();
  const xackMock = vi.fn();
  const xgroupMock = vi.fn();

  const notificationRepo = {
    findById: findByIdMock,
    update: updateMock,
  } as unknown as NotificationRepository;

  const telegramSender: ChannelOutboundSender = {
    sendMessage: sendMessageMock,
  };

  const emailSender: ChannelOutboundSender = {
    sendMessage: emailSendMock,
  };

  /**
   * Outbound sender registry mirroring the `CHAT_OUTBOUND_SENDERS` shape
   * produced by `ChannelAdaptersModule`'s `useFactory`. The notification
   * consumer looks up a sender by `ChatChannelProvider` discriminant and
   * falls through to the "unsupported channel" branch when the map has no
   * entry — building the map explicitly here keeps the tests independent
   * of the real module's factory wiring (and its `TypeOrmModule.forRootAsync()`
   * baggage).
   */
  const buildOutboundSenders = (): Map<
    ChatChannelProvider,
    ChannelOutboundSender
  > =>
    new Map<ChatChannelProvider, ChannelOutboundSender>([
      ['telegram', telegramSender],
      ['email', emailSender],
    ]);

  const redisClient = {
    xreadgroup: xreadgroupMock,
    xack: xackMock,
    xgroup: xgroupMock,
  } as unknown as Redis;

  beforeEach(() => {
    vi.resetAllMocks();
    xgroupMock.mockResolvedValue('OK');
    service = new NotificationConsumerService(
      notificationRepo,
      buildOutboundSenders(),
      redisClient,
    );
  });

  it('sends telegram message and updates notification to sent', async () => {
    findByIdMock.mockResolvedValue({
      id: 'notif-1',
      channel: 'telegram',
      externalRecipientId: 'tg-123',
      subject: 'Hello',
      body: 'World',
    });
    sendMessageMock.mockResolvedValue({ providerMessageId: 'msg-1' });
    xreadgroupMock.mockResolvedValueOnce([
      [
        'stream:notifications',
        [
          [
            '1-0',
            [
              'notification_id',
              'notif-1',
              'channel',
              'telegram',
              'external_recipient_id',
              'tg-123',
              'subject',
              'Hello',
              'body',
              'World',
              'event_type',
              'user_questions.posed',
            ],
          ],
        ],
      ],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(sendMessageMock).toHaveBeenCalledWith({
      channel: 'telegram',
      externalThreadId: 'tg-123',
      text: 'World',
      subject: 'Hello',
    });
    expect(updateMock).toHaveBeenCalledWith(
      'notif-1',
      expect.objectContaining({ status: 'sent' }),
    );
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '1-0',
    );
  });

  it('updates notification to failed when telegram sender throws', async () => {
    findByIdMock.mockResolvedValue({
      id: 'notif-1',
      channel: 'telegram',
      externalRecipientId: 'tg-123',
      subject: 'Hello',
      body: 'World',
    });
    sendMessageMock.mockRejectedValue(new Error('Telegram down'));
    xreadgroupMock.mockResolvedValueOnce([
      [
        'stream:notifications',
        [
          [
            '1-0',
            [
              'notification_id',
              'notif-1',
              'channel',
              'telegram',
              'external_recipient_id',
              'tg-123',
              'subject',
              'Hello',
              'body',
              'World',
              'event_type',
              'user_questions.posed',
            ],
          ],
        ],
      ],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(updateMock).toHaveBeenCalledWith(
      'notif-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Telegram down',
      }),
    );
    expect(xackMock).toHaveBeenCalled();
  });

  it('skips entries with missing notification_id', async () => {
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['2-0', ['channel', 'telegram']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(findByIdMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '2-0',
    );
  });

  it('acks and skips when notification not found in DB', async () => {
    findByIdMock.mockResolvedValue(null);
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['3-0', ['notification_id', 'notif-gone']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(updateMock).not.toHaveBeenCalled();
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '3-0',
    );
  });

  it('logs warning for unsupported channel but still acks', async () => {
    findByIdMock.mockResolvedValue({
      id: 'notif-4',
      channel: 'slack',
      externalRecipientId: 'user@example.com',
      body: 'Hello',
    });
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['4-0', ['notification_id', 'notif-4']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(emailSendMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(xackMock).toHaveBeenCalled();
  });

  it('returns false for an unsupported channel when the map has no entry', async () => {
    /**
     * Mirrors the legacy 'unknown-channel' string case now routed through
     * the `CHAT_OUTBOUND_SENDERS` `Map.get(...)` lookup. The map in this
     * test fixture only contains `'telegram'` and `'email'` senders, so a
     * `'unknown-channel'` notification has no entry and the dispatch
     * returns `false` (which the consumer surfaces as a warning and leaves
     * the row untouched). The behavioural contract — no sender call, no
     * status update, the entry is still acked — is the same as the
     * pre-refactor `switch` default branch.
     */
    const serviceWithUnknownChannel = new NotificationConsumerService(
      notificationRepo,
      buildOutboundSenders(),
      redisClient,
    );

    findByIdMock.mockResolvedValue({
      id: 'notif-unknown',
      channel: 'unknown-channel',
      externalRecipientId: 'whoever',
      body: 'mystery payload',
    });
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['7-0', ['notification_id', 'notif-unknown']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await serviceWithUnknownChannel.pollOnce();

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(emailSendMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '7-0',
    );
  });

  it('delivers email notifications via EmailSenderService', async () => {
    findByIdMock.mockResolvedValue({
      id: 'notif-e',
      channel: 'email',
      externalRecipientId: 'invitee@example.com',
      subject: 'You are invited',
      body: 'Join: https://app/accept-invite?token=…',
    });
    emailSendMock.mockResolvedValue({ providerMessageId: '<id@x>' });
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['5-0', ['notification_id', 'notif-e']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(emailSendMock).toHaveBeenCalledWith({
      channel: 'email',
      externalThreadId: 'invitee@example.com',
      text: 'Join: https://app/accept-invite?token=…',
      subject: 'You are invited',
    });
    expect(updateMock).toHaveBeenCalledWith(
      'notif-e',
      expect.objectContaining({ status: 'sent' }),
    );
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '5-0',
    );
  });

  it('updates notification to failed when email sender throws', async () => {
    findByIdMock.mockResolvedValue({
      id: 'notif-f',
      channel: 'email',
      externalRecipientId: 'invitee@example.com',
      subject: 'You are invited',
      body: 'Join: https://app/accept-invite?token=…',
    });
    emailSendMock.mockRejectedValue(new Error('SMTP is not configured'));
    xreadgroupMock.mockResolvedValueOnce([
      ['stream:notifications', [['6-0', ['notification_id', 'notif-f']]]],
    ]);
    xreadgroupMock.mockResolvedValueOnce([]);

    await service.pollOnce();

    expect(updateMock).toHaveBeenCalledWith(
      'notif-f',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'SMTP is not configured',
      }),
    );
    expect(xackMock).toHaveBeenCalledWith(
      'stream:notifications',
      'chat-notifications',
      '6-0',
    );
  });
});
