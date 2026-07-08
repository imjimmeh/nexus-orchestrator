import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { SecretsInternalController } from './secrets-internal.controller';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../../auth/authorization/require-permission.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InternalServiceScopeGuard } from '../../auth/internal-service-scope.guard';

describe('SecretsInternalController', () => {
  const mockSecretCrud = {
    findByIdRaw: vi.fn(),
  } as unknown as SecretCrudService;

  const controller = new SecretsInternalController(mockSecretCrud);

  it('returns decrypted secret for valid secret ID', async () => {
    vi.mocked(mockSecretCrud.findByIdRaw).mockResolvedValue({
      id: 'secret-1',
      decryptedValue: 'my-secret-value',
    });

    const result = await controller.retrieveSecret({ secretId: 'secret-1' });

    expect(result).toEqual({ secretValue: 'my-secret-value' });
    expect(mockSecretCrud.findByIdRaw).toHaveBeenCalledWith('secret-1');
  });

  it('throws NotFoundException when secret does not exist', async () => {
    vi.mocked(mockSecretCrud.findByIdRaw).mockResolvedValue(null);

    await expect(
      controller.retrieveSecret({ secretId: 'missing-secret' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when secret decryption fails', async () => {
    vi.mocked(mockSecretCrud.findByIdRaw).mockRejectedValue(
      new Error('Decryption failed'),
    );

    await expect(
      controller.retrieveSecret({ secretId: 'secret-1' }),
    ).rejects.toThrow('Decryption failed');
  });

  it('protects the internal secrets surface with the migrated permission chain', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      SecretsInternalController,
    ) as unknown[];

    expect(guards).toEqual([
      InternalServiceScopeGuard,
      JwtAuthGuard,
      PermissionsGuard,
    ]);
    // The legacy role-based decorator at the controller level
    // is gone. The class-level default is now `secrets:manage`
    // and both handlers inherit it.
    expect(
      Reflect.getMetadata(REQUIRED_PERMISSION_KEY, SecretsInternalController),
    ).toBe('secrets:manage');
    expect(Reflect.getMetadata(PATH_METADATA, controller.retrieveSecret)).toBe(
      'retrieve',
    );
    expect(
      Reflect.getMetadata(METHOD_METADATA, controller.retrieveSecret),
    ).toBe(RequestMethod.POST);
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `secrets-internal.controller.ts` from the legacy
 * role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real `PermissionsGuard` against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('SecretsInternalController — PermissionsGuard integration', () => {
  const secretCrud = {
    findByIdRaw: vi.fn(),
    upsertByName: vi.fn(),
  } as unknown as SecretCrudService;

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
    controller: SecretsInternalController,
    handler: (...args: unknown[]) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => SecretsInternalController,
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
    name: keyof SecretsInternalController;
    permission: string;
  }> = [
    { name: 'retrieveSecret', permission: 'secrets:manage' },
    { name: 'upsertSecret', permission: 'secrets:manage' },
  ];

  for (const { name, permission } of handlerPermissionExpectations) {
    it(`declares ${permission} as the required permission for ${name}`, () => {
      // Pin the migration: the legacy Admin/Developer role-list
      // decorator is gone and the handler now requires the
      // management-tier `secrets:manage` permission (class-level
      // default is inherited by both handlers). We read both
      // class- and handler-level metadata since the permission is
      // declared on the controller class.
      const controller = new SecretsInternalController(secretCrud);
      const reflector = new Reflector();
      const handler = controller[name] as (...args: unknown[]) => unknown;
      const observed = reflector.getAllAndOverride<string>(
        REQUIRED_PERMISSION_KEY,
        [handler, SecretsInternalController],
      );
      expect(observed).toBe(permission);
    });
  }

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new SecretsInternalController(secretCrud);

    const handler = controller.retrieveSecret as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'admin-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'admin-seed-1',
      'secrets:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('secrets');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new SecretsInternalController(secretCrud);

    const handler = controller.upsertSecret as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent-seed-1',
      'secrets:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService for every handler', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new SecretsInternalController(secretCrud);

    for (const { name, permission } of handlerPermissionExpectations) {
      const handler = controller[name] as (...args: unknown[]) => unknown;
      await guard.canActivate(
        buildCtx(controller, handler, { userId: 'agent-seed-1' }),
      );

      expect(authzAudit.recordDenial).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'agent-seed-1',
          requiredPermission: permission,
          enforcementMode: 'enforce',
        }),
      );
    }
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const controller = new SecretsInternalController(secretCrud);

    const handler = controller.retrieveSecret as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent-seed-1',
        requiredPermission: 'secrets:manage',
        enforcementMode: 'audit',
      }),
    );
  });
});
