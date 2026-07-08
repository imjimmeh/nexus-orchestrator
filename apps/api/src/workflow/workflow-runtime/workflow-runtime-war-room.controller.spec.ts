import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../../auth/authorization/require-permission.decorator';
import { WarRoomService } from '../../war-room/war-room.service';
import { WorkflowRuntimeWarRoomController } from './workflow-runtime-war-room.controller';

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `workflow-runtime-war-room.controller.ts` from
 * the legacy role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real PermissionsGuard against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('WorkflowRuntimeWarRoomController — PermissionsGuard integration', () => {
  const warRoomService = {
    openSession: vi.fn(),
    inviteParticipant: vi.fn(),
    postMessage: vi.fn(),
    updateBlackboard: vi.fn(),
    submitSignoff: vi.fn(),
    getState: vi.fn(),
    closeSession: vi.fn(),
  } as unknown as WarRoomService;

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
    controller: WorkflowRuntimeWarRoomController,
    handler: (req: unknown, body: unknown) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => WorkflowRuntimeWarRoomController,
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
    name: keyof WorkflowRuntimeWarRoomController;
    permission: string;
  }> = [
    { name: 'openWarRoom', permission: 'workflows:create' },
    { name: 'inviteParticipant', permission: 'agents:update' },
    { name: 'postMessage', permission: 'memory:create' },
    { name: 'updateBlackboard', permission: 'memory:update' },
    { name: 'submitSignoff', permission: 'approvals:manage' },
    { name: 'getState', permission: 'workflows:read' },
    { name: 'closeWarRoom', permission: 'workflows:update' },
  ];

  for (const { name, permission } of handlerPermissionExpectations) {
    it(`declares ${permission} as the required permission for ${name}`, () => {
      // Pin the migration: the legacy Admin/Developer/Agent role-list
      // decorator is gone and the handler now requires the agent role's
      // documented permission (or `*:manage` for the lifecycle handler).
      const controller = new WorkflowRuntimeWarRoomController(warRoomService);
      const reflector = new Reflector();
      // Bind the prototype method so the Reflector metadata read returns
      // the value set by the @RequirePermission decorator.
      const handler = controller[name] as (
        req: unknown,
        body: unknown,
      ) => unknown;
      const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
      expect(observed).toBe(permission);
    });
  }

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new WorkflowRuntimeWarRoomController(warRoomService);

    const handler = controller.openWarRoom as (
      req: unknown,
      body: unknown,
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'workflows:create',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('workflows');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new WorkflowRuntimeWarRoomController(warRoomService);

    const handler = controller.openWarRoom as (
      req: unknown,
      body: unknown,
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'workflows:create',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService for every handler', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new WorkflowRuntimeWarRoomController(warRoomService);

    for (const { name, permission } of handlerPermissionExpectations) {
      const handler = controller[name] as (
        req: unknown,
        body: unknown,
      ) => unknown;
      await guard.canActivate(
        buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
      );

      expect(authzAudit.recordDenial).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'agent:run-1:job-1',
          requiredPermission: permission,
          enforcementMode: 'enforce',
        }),
      );
    }
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const controller = new WorkflowRuntimeWarRoomController(warRoomService);

    const handler = controller.submitSignoff as (
      req: unknown,
      body: unknown,
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent:run-1:job-1',
        requiredPermission: 'approvals:manage',
        enforcementMode: 'audit',
      }),
    );
  });
});
