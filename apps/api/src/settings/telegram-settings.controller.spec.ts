import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TelegramSettingsViewV1 } from '@nexus/core';
import { TelegramSettingsController } from './telegram-settings.controller';
import type { TelegramSettingsService } from './telegram-settings.service';
import type { UpdateTelegramSettingsDto } from './dto/update-telegram-settings.dto';

describe('TelegramSettingsController', () => {
  let controller: TelegramSettingsController;

  const getSettingsViewMock = vi.fn();
  const updateSettingsMock = vi.fn();

  const service = {
    getSettingsView: getSettingsViewMock,
    updateSettings: updateSettingsMock,
  } as unknown as TelegramSettingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TelegramSettingsController(service);
  });

  it('returns masked Telegram settings in success envelope', async () => {
    const settings = {
      ingressMode: 'webhook',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
      allowedUserIds: ['1001'],
      pollTimeoutSeconds: 50,
      pollRetryDelayMs: 1000,
      pollBackoffMaxMs: 30000,
      outboundRelayEnabled: true,
      outboundRelayIntervalMs: 3000,
      outboundRelayBatchSize: 20,
      commandsEnabled: true,
      enabledCommands: ['help', 'new', 'resume', 'agent'],
      commandResumeListLimit: 8,
      uxTypingEnabled: true,
      uxTypingHeartbeatMs: 4000,
      uxStatusUpdatesEnabled: true,
      uxStatusMode: 'single_message',
      uxHideThinking: true,
      uxExposeToolNames: false,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'tool_execution_start'],
      uxProgressUpdateThrottleMs: 1500,
      uxMaxProgressUpdatesPerRun: 40,
      hasBotToken: true,
      hasWebhookSecret: false,
    } as TelegramSettingsViewV1;
    getSettingsViewMock.mockResolvedValue(settings);

    const result = await controller.findSettings();

    expect(result).toEqual({ success: true, data: settings });
    expect(getSettingsViewMock).toHaveBeenCalledOnce();
  });

  it('updates Telegram settings and returns masked result', async () => {
    const dto: UpdateTelegramSettingsDto = {
      ingressMode: 'polling',
      outboundRelayEnabled: false,
    };
    const updated = {
      ingressMode: 'polling',
      defaultAgentProfile: 'ceo-agent',
      defaultScopeId: null,
      allowedUserIds: ['1001', '1002'],
      pollTimeoutSeconds: 50,
      pollRetryDelayMs: 1000,
      pollBackoffMaxMs: 30000,
      outboundRelayEnabled: false,
      outboundRelayIntervalMs: 3000,
      outboundRelayBatchSize: 20,
      commandsEnabled: true,
      enabledCommands: ['help', 'new', 'resume', 'agent'],
      commandResumeListLimit: 8,
      uxTypingEnabled: true,
      uxTypingHeartbeatMs: 4000,
      uxStatusUpdatesEnabled: true,
      uxStatusMode: 'single_message',
      uxHideThinking: true,
      uxExposeToolNames: false,
      uxCommandMenuSyncEnabled: true,
      uxProgressEventsAllowlist: ['job_start', 'tool_execution_start'],
      uxProgressUpdateThrottleMs: 1500,
      uxMaxProgressUpdatesPerRun: 40,
      hasBotToken: true,
      hasWebhookSecret: true,
    } as TelegramSettingsViewV1;
    updateSettingsMock.mockResolvedValue(updated);

    const result = await controller.updateSettings(dto);

    expect(updateSettingsMock).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true, data: updated });
  });
});
