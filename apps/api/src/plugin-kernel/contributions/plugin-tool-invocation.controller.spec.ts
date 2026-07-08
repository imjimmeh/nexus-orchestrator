import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../../auth/authorization/require-permission.decorator';
import { PluginToolInvocationController } from './plugin-tool-invocation.controller';
import { PluginToolInvocationService } from './plugin-tool-invocation.service';

type MockPluginToolInvocationService = Pick<
  PluginToolInvocationService,
  'invokeByContribution'
>;

function createInvocationServiceMock(): MockPluginToolInvocationService {
  return {
    invokeByContribution: vi.fn(),
  };
}

function createController(service = createInvocationServiceMock()) {
  return {
    controller: new PluginToolInvocationController(
      service as PluginToolInvocationService,
    ),
    service,
  };
}

function routeMetadata(methodName: keyof PluginToolInvocationController) {
  const handler = PluginToolInvocationController.prototype[methodName];

  return {
    controllerPath: Reflect.getMetadata(
      PATH_METADATA,
      PluginToolInvocationController,
    ),
    guards: Reflect.getMetadata(
      GUARDS_METADATA,
      PluginToolInvocationController,
    ),
    path: Reflect.getMetadata(PATH_METADATA, handler),
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    requiredPermission: Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler),
  };
}

describe('PluginToolInvocationController', () => {
  it('exposes the projected plugin tool callback route', () => {
    expect(routeMetadata('invokeContribution')).toEqual({
      controllerPath: 'plugins',
      guards: [JwtAuthGuard, PermissionsGuard],
      path: ':pluginId/:version/contributions/:contributionId/invoke',
      method: RequestMethod.POST,
      requiredPermission: 'resources:manage',
    });
  });

  it('delegates route params and request body to the invocation service', async () => {
    const { controller, service } = createController();
    const response = {
      ok: true as const,
      output: { summary: 'Short text' },
    };
    vi.mocked(service.invokeByContribution).mockResolvedValue(response);
    const input = { text: 'Long text' };

    const result = await controller.invokeContribution(
      'com.acme/plugin tools',
      '1.2/with space?beta#hash',
      'summarize:deep/report?x#y',
      input,
    );

    expect(service.invokeByContribution).toHaveBeenCalledWith({
      pluginId: 'com.acme/plugin tools',
      version: '1.2/with space?beta#hash',
      contributionId: 'summarize:deep/report?x#y',
      input,
    });
    expect(result).toBe(response);
  });

  it('does not decode route params a second time', async () => {
    const { controller, service } = createController();
    const response = {
      ok: true as const,
      output: { summary: 'Short text' },
    };
    vi.mocked(service.invokeByContribution).mockResolvedValue(response);
    const input = { text: 'Long text' };

    await controller.invokeContribution(
      'literal%2Fplugin%25id',
      '1.2%252Fencoded',
      'tool%253Aname%25',
      input,
    );

    expect(service.invokeByContribution).toHaveBeenCalledWith({
      pluginId: 'literal%2Fplugin%25id',
      version: '1.2%252Fencoded',
      contributionId: 'tool%253Aname%25',
      input,
    });
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `plugin-tool-invocation.controller.ts` from the
 * legacy role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real `PermissionsGuard` against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('PluginToolInvocationController — PermissionsGuard integration', () => {
  const pluginToolInvocation =
    createInvocationServiceMock() as unknown as PluginToolInvocationService;

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
    controller: PluginToolInvocationController,
    handler: (...args: unknown[]) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => PluginToolInvocationController,
      switchToHttp: () => ({
        getRequest: () => ({ user, params: {}, query: {}, body: {} }),
      }),
    } as unknown as Parameters<PermissionsGuard['canActivate']>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Per-handler @RequirePermission metadata ──────────────────────────

  it('declares resources:manage as the required permission for invokeContribution', () => {
    // Pin the migration: the legacy Admin/Developer/Agent role-list
    // decorator is gone and the handler now requires the
    // resource-management permission.
    const controller = new PluginToolInvocationController(pluginToolInvocation);
    const reflector = new Reflector();
    const handler = controller.invokeContribution as (
      ...args: unknown[]
    ) => unknown;
    const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
    expect(observed).toBe('resources:manage');
  });

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new PluginToolInvocationController(pluginToolInvocation);

    const handler = controller.invokeContribution as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'resources:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('resources');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new PluginToolInvocationController(pluginToolInvocation);

    const handler = controller.invokeContribution as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'resources:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new PluginToolInvocationController(pluginToolInvocation);

    const handler = controller.invokeContribution as (
      ...args: unknown[]
    ) => unknown;
    await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent:run-1:job-1',
        requiredPermission: 'resources:manage',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const controller = new PluginToolInvocationController(pluginToolInvocation);

    const handler = controller.invokeContribution as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent:run-1:job-1',
        requiredPermission: 'resources:manage',
        enforcementMode: 'audit',
      }),
    );
  });
});
