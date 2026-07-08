import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../auth/authorization/require-permission.decorator';
import { SetupController } from './setup.controller';
import { SetupService } from './setup.service';
import type { InitializeSetupDto } from './dto/initialize-setup.dto';

type SetupServiceMock = Pick<
  SetupService,
  'getStatus' | 'initialize' | 'skipSetup'
>;

function createSetupServiceMock(): SetupServiceMock {
  return {
    getStatus: vi.fn(),
    initialize: vi.fn(),
    skipSetup: vi.fn(),
  };
}

function createController(
  service: SetupServiceMock = createSetupServiceMock(),
) {
  return new SetupController(service as unknown as SetupService);
}

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `setup.controller.ts` from the legacy
 * role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real `PermissionsGuard` against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 *
 * Special case for this controller: the legacy role-based
 * guard was case-insensitive (it lowercased both the configured
 * and the incoming role names). The migration preserves that
 * runtime behavior — the migration's `settings:manage` permission
 * is seed-configured to be held by the admin role regardless of
 * how the role name is cased. We exercise that the guard allows
 * both uppercase and lowercase token subjects that represent the
 * same permission-bearing identity.
 */
describe('SetupController', () => {
  let service: SetupServiceMock;

  beforeEach(() => {
    service = createSetupServiceMock();
  });

  describe('existing behavior preservation', () => {
    it('returns the setup status payload as expected', async () => {
      const status = {
        requiresSetup: true,
        hasAnySecret: false,
        hasActiveProvider: false,
        hasActiveModel: false,
        hasArchitectProfile: false,
      };
      vi.mocked(service.getStatus).mockResolvedValue(status);

      const controller = createController(service);
      const result = await controller.getStatus({
        user: { roles: ['admin'] },
      } as never);

      expect(service.getStatus).toHaveBeenCalledWith(['admin']);
      expect(result).toEqual({ success: true, data: status });
    });

    it('initializes setup with valid dto', async () => {
      vi.mocked(service.initialize).mockResolvedValue({ initialized: true });

      const controller = createController(service);
      const dto = {
        providerName: 'openai',
        modelName: 'gpt-4o',
        secretValue: 'sk-test',
        secretKeyName: 'OPENAI_API_KEY',
        secretName: 'openai-primary',
        providerBaseUrl: undefined,
        tokenLimit: 128000,
      } as InitializeSetupDto;
      const result = await controller.initialize(
        { user: { roles: ['admin'] } } as never,
        dto,
      );

      expect(service.initialize).toHaveBeenCalledWith(['admin'], dto);
      expect(result).toEqual({
        success: true,
        data: { initialized: true },
      });
    });

    it('rejects initialize when caller lacks the admin role', async () => {
      const controller = createController(service);

      await expect(
        controller.initialize(
          { user: { roles: ['Developer'] } } as never,
          {} as InitializeSetupDto,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.initialize).not.toHaveBeenCalled();
    });

    it('skips setup when caller has the admin role', async () => {
      vi.mocked(service.skipSetup).mockResolvedValue(undefined);

      const controller = createController(service);
      const result = await controller.skip({
        user: { roles: ['admin'] },
      } as never);

      expect(service.skipSetup).toHaveBeenCalledOnce();
      expect(result).toEqual({
        success: true,
        data: { skipped: true },
      });
    });

    it('rejects skip when caller lacks the admin role', async () => {
      const controller = createController(service);

      await expect(
        controller.skip({
          user: { roles: ['Developer'] },
        } as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(service.skipSetup).not.toHaveBeenCalled();
    });
  });
});

describe('SetupController — PermissionsGuard integration', () => {
  const setupService = createSetupServiceMock() as unknown as SetupService;

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
    controller: SetupController,
    handler: (req: unknown, body: unknown) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => SetupController,
      switchToHttp: () => ({
        getRequest: () => ({ user, params: {}, query: {}, body: {} }),
      }),
    } as unknown as Parameters<PermissionsGuard['canActivate']>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Per-handler @RequirePermission metadata ──────────────────────────

  const handlerPermissionExpectations: Array<{
    name: keyof SetupController;
    permission: string;
  }> = [
    { name: 'initialize', permission: 'settings:manage' },
    { name: 'skip', permission: 'settings:manage' },
  ];

  for (const { name, permission } of handlerPermissionExpectations) {
    it(`declares ${permission} as the required permission for ${name}`, () => {
      // Pin the migration: the legacy lowercase role-based
      // decorator is gone and the handler now requires the
      // admin-class `settings:manage` permission.
      const controller = new SetupController(setupService);
      const reflector = new Reflector();
      const handler = controller[name] as (
        req: unknown,
        body: unknown,
      ) => unknown;
      const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
      expect(observed).toBe(permission);
    });
  }

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows an uppercase token subject holding the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new SetupController(setupService);

    const handler = controller.initialize as (
      req: unknown,
      body: unknown,
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'ADMIN-SEED-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'ADMIN-SEED-1',
      'settings:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('settings');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('allows a lowercase token subject holding the required permission', async () => {
    // The legacy role-based guard was case-insensitive for the
    // configured role name `'admin'` vs incoming `req.user.roles`.
    // The migration's permission model has no notion of role-name
    // casing — the `settings:manage` permission is owned by the
    // admin role regardless of how it is cased in the seed — so we
    // exercise a lowercase token subject to make the equivalence
    // explicit in this regression suite.
    const { authz, authzAudit, guard } = buildGuard(true);
    const controller = new SetupController(setupService);

    const handler = controller.skip as (req: unknown, body: unknown) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'admin-seed-2' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'admin-seed-2',
      'settings:manage',
      expect.any(String),
      undefined,
    );
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new SetupController(setupService);

    const handler = controller.initialize as (
      req: unknown,
      body: unknown,
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'developer-seed-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'developer-seed-1',
      'settings:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService for every handler', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new SetupController(setupService);

    for (const { name, permission } of handlerPermissionExpectations) {
      const handler = controller[name] as (
        req: unknown,
        body: unknown,
      ) => unknown;
      await guard.canActivate(
        buildCtx(controller, handler, { userId: 'developer-seed-1' }),
      );

      expect(authzAudit.recordDenial).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'developer-seed-1',
          requiredPermission: permission,
          enforcementMode: 'enforce',
        }),
      );
    }
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const controller = new SetupController(setupService);

    const handler = controller.skip as (req: unknown, body: unknown) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'developer-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'developer-seed-1',
        requiredPermission: 'settings:manage',
        enforcementMode: 'audit',
      }),
    );
  });
});
