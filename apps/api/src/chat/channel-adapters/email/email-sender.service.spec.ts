import { BadGatewayException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { EmailConfigService } from './email-config.service';
import { EmailSenderService } from './email-sender.service';

describe('EmailSenderService', () => {
  let sendMailMock: Mock;
  let transportFactory: Mock;
  let emailConfig: EmailConfigService;
  let service: EmailSenderService;

  beforeEach(() => {
    sendMailMock = vi.fn();
    transportFactory = vi.fn(() => ({ sendMail: sendMailMock }));
    emailConfig = {
      resolveSmtpSettings: vi.fn(),
      isConfigured: vi.fn(),
    } as unknown as EmailConfigService;
    service = new EmailSenderService(emailConfig, transportFactory);
  });

  it('sends an email and returns providerMessageId', async () => {
    (emailConfig.resolveSmtpSettings as Mock).mockResolvedValue({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      from: 'Nexus <no-reply@example.com>',
      auth: { user: 'u', pass: 'p' },
    });
    sendMailMock.mockResolvedValue({ messageId: '<abc@example.com>' });

    const result = await service.sendMessage({
      channel: 'email',
      externalThreadId: 'invitee@example.com',
      text: 'Join: https://app/accept-invite?token=abc',
      subject: 'You are invited',
    });

    expect(transportFactory).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 587 }),
    );
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Nexus <no-reply@example.com>',
        to: 'invitee@example.com',
        subject: 'You are invited',
        text: expect.stringContaining('accept-invite'),
      }),
    );
    expect(result).toEqual({ providerMessageId: '<abc@example.com>' });
  });

  it('throws BadGatewayException when SMTP is not configured', async () => {
    (emailConfig.resolveSmtpSettings as Mock).mockResolvedValue(null);

    await expect(
      service.sendMessage({
        channel: 'email',
        externalThreadId: 'x@example.com',
        text: 'hi',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('propagates a BadGatewayException when the transport send fails', async () => {
    (emailConfig.resolveSmtpSettings as Mock).mockResolvedValue({
      host: 'h',
      port: 587,
      secure: false,
      from: 'f',
    });
    sendMailMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.sendMessage({
        channel: 'email',
        externalThreadId: 'x@example.com',
        text: 'hi',
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('defaults subject when omitted', async () => {
    (emailConfig.resolveSmtpSettings as Mock).mockResolvedValue({
      host: 'h',
      port: 587,
      secure: false,
      from: 'f',
    });
    sendMailMock.mockResolvedValue({});

    const result = await service.sendMessage({
      channel: 'email',
      externalThreadId: 'x@example.com',
      text: 'hi',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.any(String) }),
    );
    expect(result).toEqual({ providerMessageId: null });
  });
});
