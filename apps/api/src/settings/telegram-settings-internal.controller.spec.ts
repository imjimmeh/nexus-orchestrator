import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import type { TelegramRuntimeSettingsV1 } from '@nexus/core';
import { TelegramSettingsInternalController } from './telegram-settings-internal.controller';
import type { TelegramSettingsService } from './telegram-settings.service';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../auth/authorization/require-permission.decorator';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from '../auth/internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('TelegramSettingsInternalController', () => {
  let controller: TelegramSettingsInternalController;

  const getRuntimeSettingsMock = vi.fn();

  const service = {
    getRuntimeSettings: getRuntimeSettingsMock,
  } as unknown as TelegramSettingsService;

  beforeEach(() => {
    vi.resetAllMocks();
    controller = new TelegramSettingsInternalController(service);
  });

  it('returns runtime Telegram settings including secrets', async () => {
    const runtimeSettings = {
      ingressMode: 'hybrid',
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
      botToken: 'secret-bot-token',
      webhookSecret: 'secret-webhook',
    } as TelegramRuntimeSettingsV1;
    getRuntimeSettingsMock.mockResolvedValue(runtimeSettings);

    const result = await controller.getRuntimeSettings();

    expect(result).toEqual({ success: true, data: runtimeSettings });
    expect(getRuntimeSettingsMock).toHaveBeenCalledOnce();
  });

  it('protects the internal runtime endpoint with the migrated permission chain', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TelegramSettingsInternalController,
    ) as unknown[];
    const handler =
      TelegramSettingsInternalController.prototype.getRuntimeSettings;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('runtime');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
    expect(guards).toEqual([
      InternalServiceScopeGuard,
      JwtAuthGuard,
      PermissionsGuard,
    ]);
    expect(
      Reflect.getMetadata(INTERNAL_SERVICE_SCOPES_METADATA_KEY, handler),
    ).toEqual(['core.telegram-settings:read']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler)).toBe(
      'settings:manage',
    );
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `telegram-settings-internal.controller.ts` from
 * the legacy role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real `PermissionsGuard` against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('TelegramSettingsInternalController — PermissionsGuard integration', () => {
  const service = {
    getRuntimeSettings: vi.fn(),
  } as unknown as TelegramSettingsService;

  function buildGuard(
    authzResult: boolean,
    mode: 'audit' | 'enforce' | 'warn' = 'enforce',
  ) {
    const reflector = new Reflector();
    const authz = {
      can: vi.fn().mockResolvedValue(authzResult),
    } as unknown as ConstructorParameters<typeof PermissionsGuard>[1];
    const enforcement = {
      getMode: vi.fn().mockResolvedValue(mode),
    } as unknown as ConstructorParameters<typeof PermissionsGuard>[2];
    const authzAudit = {
      recordDenial: vi.fn().mockResolvedValue(undefined),
    } as unknown as NonNullable<
      ConstructorParameters<typeof PermissionsGuard>[3]
    >;
    return {
      reflector,
      authz,
      enforcement,
      authzAudit,
      guard: new PermissionsGuard(reflector, authz, enforcement, authzAudit),
    };
  }

  function buildCtx(
    controller: TelegramSettingsInternalController,
    handler: (...args: unknown[]) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => TelegramSettingsInternalController,
      switchToHttp: () => ({
        getRequest: () => ({ user, params: {}, query: {}, body: {} }),
      }),
    } as unknown as Parameters<PermissionsGuard['canActivate']>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Per-handler @RequirePermission metadata ──────────────────────────

  it('declares settings:manage as the required permission for getRuntimeSettings', () => {
    // Pin the migration: the legacy Admin/Developer role-list
    // decorator is gone and the handler now requires the
    // `settings:manage` permission (no granular read/create/update
    // split for Telegram runtime settings).
    const controller = new TelegramSettingsInternalController(service);
    const reflector = new Reflector();
    const handler = controller.getRuntimeSettings as (
      ...args: unknown[]
    ) => unknown;
    const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
    expect(observed).toBe('settings:manage');
  });

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new TelegramSettingsInternalController(service);

    const handler = controller.getRuntimeSettings as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'admin-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'admin-seed-1',
      'settings:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('settings');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new TelegramSettingsInternalController(service);

    const handler = controller.getRuntimeSettings as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent-seed-1',
      'settings:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new TelegramSettingsInternalController(service);

    const handler = controller.getRuntimeSettings as (
      ...args: unknown[]
    ) => unknown;
    await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent-seed-1',
        requiredPermission: 'settings:manage',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const controller = new TelegramSettingsInternalController(service);

    const handler = controller.getRuntimeSettings as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent-seed-1',
        requiredPermission: 'settings:manage',
        enforcementMode: 'audit',
      }),
    );
  });
});
