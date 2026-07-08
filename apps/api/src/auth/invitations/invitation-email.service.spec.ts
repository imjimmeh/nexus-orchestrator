import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { EmailConfigService } from '../../chat/channel-adapters/email/email-config.service';
import type { EmailSenderService } from '../../chat/channel-adapters/email/email-sender.service';
import { InvitationEmailService } from './invitation-email.service';

const ACCEPT_LINK = 'https://app/accept-invite?token=t';
const RAW_TOKEN = 'super-secret-raw-token';

function createEmailConfig(): EmailConfigService {
  return {
    isConfigured: vi.fn(),
    buildAcceptInviteLink: vi.fn(),
  } as unknown as EmailConfigService;
}

function createEmailSender(): EmailSenderService {
  return { sendMessage: vi.fn() } as unknown as EmailSenderService;
}

describe('InvitationEmailService', () => {
  let emailConfig: EmailConfigService;
  let emailSender: EmailSenderService;
  let service: InvitationEmailService;
  let loggerSpies: Array<ReturnType<typeof vi.spyOn>>;

  beforeEach(() => {
    emailConfig = createEmailConfig();
    emailSender = createEmailSender();
    service = new InvitationEmailService(emailConfig, emailSender);
    loggerSpies = [
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
    ];
  });

  it('skips when SMTP not configured', async () => {
    (emailConfig.isConfigured as Mock).mockResolvedValue(false);

    const result = await service.sendInvitationEmail({
      email: 'x@e.com',
      rawToken: 't',
      scopeNodeId: 's',
      roleId: 'r',
    });

    expect(result).toEqual({
      delivered: false,
      skippedReason: 'not_configured',
    });
    expect(emailSender.sendMessage).not.toHaveBeenCalled();
  });

  it('sends the accept link and reports delivered', async () => {
    (emailConfig.isConfigured as Mock).mockResolvedValue(true);
    (emailConfig.buildAcceptInviteLink as Mock).mockReturnValue(ACCEPT_LINK);
    (emailSender.sendMessage as Mock).mockResolvedValue({
      providerMessageId: '<id>',
    });

    const result = await service.sendInvitationEmail({
      email: 'x@e.com',
      rawToken: 't',
      scopeNodeId: 's',
      roleId: 'r',
    });

    expect(emailSender.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'email',
        externalThreadId: 'x@e.com',
        text: expect.stringContaining(ACCEPT_LINK),
        subject: expect.any(String),
      }),
    );
    expect(result).toEqual({ delivered: true });
  });

  it('reports error (not throws) when sender fails', async () => {
    (emailConfig.isConfigured as Mock).mockResolvedValue(true);
    (emailConfig.buildAcceptInviteLink as Mock).mockReturnValue(ACCEPT_LINK);
    (emailSender.sendMessage as Mock).mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    const result = await service.sendInvitationEmail({
      email: 'x@e.com',
      rawToken: 't',
      scopeNodeId: 's',
      roleId: 'r',
    });

    expect(result.delivered).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('never logs the raw invitation token', async () => {
    (emailConfig.isConfigured as Mock).mockResolvedValue(true);
    (emailConfig.buildAcceptInviteLink as Mock).mockReturnValue(ACCEPT_LINK);
    (emailSender.sendMessage as Mock).mockRejectedValue(
      new Error('ECONNREFUSED'),
    );

    await service.sendInvitationEmail({
      email: 'x@e.com',
      rawToken: RAW_TOKEN,
      scopeNodeId: 's',
      roleId: 'r',
    });

    for (const spy of loggerSpies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(RAW_TOKEN);
      }
    }
  });
});
