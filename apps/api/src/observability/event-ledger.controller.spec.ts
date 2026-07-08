import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';

import {
  emitInternalEventLedgerSchema,
  EventLedgerController,
} from './event-ledger.controller';
import { EventLedgerService } from './event-ledger.service';
import { AUTONOMY_EVENT_NAMES } from './autonomy-observability.types';
import { INTERNAL_SERVICE_SCOPES_METADATA_KEY } from '../auth/internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../auth/authorization/require-permission.decorator';

describe('EventLedgerController', () => {
  it('maps public autonomy query filters to the event ledger service', async () => {
    const events = [{ id: 'event-1' }];
    const service = {
      query: vi.fn().mockResolvedValue({ events, total: 1 }),
    } as unknown as EventLedgerService;
    const controller = new EventLedgerController(service);
    const query = {
      eventName: AUTONOMY_EVENT_NAMES.qaDecisionSubmitted,
      context: {
        scopeId: 'project-1',
        contextId: '11111111-1111-4111-8111-111111111111',
        contextType: 'resource',
      },
      workflowRunId: '22222222-2222-4222-8222-222222222222',
      limit: 25,
      offset: 10,
    };

    const response = await controller.findAll(query);

    expect(service.query).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: AUTONOMY_EVENT_NAMES.qaDecisionSubmitted,
        context: {
          scopeId: 'project-1',
          contextId: '11111111-1111-4111-8111-111111111111',
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
        workflowRunId: '22222222-2222-4222-8222-222222222222',
        limit: 25,
        offset: 10,
      }),
    );
    expect(response).toEqual({
      data: events,
      meta: {
        total: 1,
        limit: 25,
        offset: 10,
      },
    });
  });

  it.each([
    AUTONOMY_EVENT_NAMES.failureClassificationDecided,
    AUTONOMY_EVENT_NAMES.repairDelegationDecided,
  ])('passes %s through as a public event name filter', async (eventName) => {
    const service = {
      query: vi.fn().mockResolvedValue({ events: [], total: 0 }),
    } as unknown as EventLedgerService;
    const controller = new EventLedgerController(service);

    await controller.findAll({
      eventName,
      context: {
        scopeId: 'project-1',
        contextId: '33333333-3333-4333-8333-333333333333',
        contextType: 'resource',
      },
      limit: 100,
      offset: 0,
    });

    expect(service.query).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName,
        context: {
          scopeId: 'project-1',
          contextId: '33333333-3333-4333-8333-333333333333',
          contextType: 'resource',
          scopeNodeId: null,
          scopePath: null,
        },
      }),
    );
  });

  it('emits an internal git event through the event ledger service', async () => {
    const service = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventLedgerService;
    const controller = new EventLedgerController(service);
    const body = {
      domain: 'git',
      eventName: 'git.clone.requested',
      outcome: 'in_progress' as const,
      source: 'external',
      actorType: 'system' as const,
      context: {
        scopeId: '44444444-4444-4444-8444-444444444444',
        contextId: null,
        contextType: null,
      },
      payload: {
        repositoryUrl: 'https://github.com/example/project.git',
        targetPath:
          'G:\\workspace\\clones\\44444444-4444-4444-8444-444444444444',
      },
    };

    const response = await controller.emitInternal(body);

    expect(service.emitBestEffort).toHaveBeenCalledWith(body);
    expect(response).toEqual({ ok: true });
  });

  it('protects internal event ingestion with service scope and the migrated permission', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      EventLedgerController,
    ) as unknown[];
    const handler = EventLedgerController.prototype.emitInternal;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('internal');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(guards).toEqual([
      InternalServiceScopeGuard,
      JwtAuthGuard,
      PermissionsGuard,
    ]);
    expect(
      Reflect.getMetadata(INTERNAL_SERVICE_SCOPES_METADATA_KEY, handler),
    ).toEqual(['core.events:write']);
    expect(Reflect.getMetadata(REQUIRED_PERMISSION_KEY, handler)).toBe(
      'audit:manage',
    );
  });

  /**
   * Authorization migration regression tests
   * ----------------------------------------
   * After migrating `event-ledger.controller.ts` from the legacy
   * role-based guard class to `PermissionsGuard` +
   * `RequirePermission`, exercise the real `PermissionsGuard` against
   * the migrated handler metadata. This pins three behaviors for the
   * audit record:
   *   (a) a permission-bearing user is allowed,
   *   (b) a user lacking the required permission is denied,
   *   (c) the audit service records the denial.
   */
  describe('EventLedgerController — PermissionsGuard integration', () => {
    const eventLedgerService = {
      query: vi.fn(),
      getByCorrelationId: vi.fn(),
      emitBestEffort: vi.fn(),
      getById: vi.fn(),
    } as unknown as EventLedgerService;

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
      controller: EventLedgerController,
      handler: (...args: unknown[]) => unknown,
      user: unknown,
    ) {
      return {
        getHandler: () => handler,
        getClass: () => EventLedgerController,
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
      name: keyof EventLedgerController;
      permission: string;
    }> = [
      // class-level default reads
      { name: 'findAll', permission: 'audit:read' },
      { name: 'findByCorrelationId', permission: 'audit:read' },
      { name: 'findById', permission: 'audit:read' },
      // explicit per-handler override for the write path
      { name: 'emitInternal', permission: 'audit:manage' },
    ];

    for (const { name, permission } of handlerPermissionExpectations) {
      it(`declares ${permission} as the required permission for ${name}`, () => {
        // Pin the migration: the legacy Admin/Developer role-list
        // decorator is gone and the handler now requires the
        // read-class `audit:read` (inherited from the controller
        // default) or the write-class `audit:manage` for the
        // internal-emit endpoint. We read both class- and
        // handler-level metadata because the controller carries the
        // class-level default for read endpoints while the write
        // endpoint overrides it at the method level.
        const controller = new EventLedgerController(eventLedgerService);
        const reflector = new Reflector();
        const handler = controller[name] as (...args: unknown[]) => unknown;
        const observed = reflector.getAllAndOverride<string>(
          REQUIRED_PERMISSION_KEY,
          [handler, EventLedgerController],
        );
        expect(observed).toBe(permission);
      });
    }

    // ─── Permission-bearing user is allowed ───────────────────────────────

    it('allows a user that holds the read permission for the inherited handlers', async () => {
      const { authz, enforcement, authzAudit, guard } = buildGuard(true);
      const controller = new EventLedgerController(eventLedgerService);

      const handler = controller.findAll as (...args: unknown[]) => unknown;
      const result = await guard.canActivate(
        buildCtx(controller, handler, { userId: 'audit-reader-1' }),
      );

      expect(result).toBe(true);
      expect(authz.can).toHaveBeenCalledWith(
        'audit-reader-1',
        'audit:read',
        expect.any(String),
        undefined,
      );
      expect(enforcement.getMode).toHaveBeenCalledWith('audit');
      expect(authzAudit.recordDenial).not.toHaveBeenCalled();
    });

    // ─── User lacking permission is denied ────────────────────────────────

    it('denies a user lacking audit:manage on the write path', async () => {
      const { authz, guard } = buildGuard(false, 'enforce');
      const controller = new EventLedgerController(eventLedgerService);

      const handler = controller.emitInternal as (
        ...args: unknown[]
      ) => unknown;
      const result = await guard.canActivate(
        buildCtx(controller, handler, { userId: 'audit-reader-2' }),
      );

      expect(result).toBe(false);
      expect(authz.can).toHaveBeenCalledWith(
        'audit-reader-2',
        'audit:manage',
        expect.any(String),
        undefined,
      );
    });

    // ─── Audit service records the denial ────────────────────────────────

    it('records a denial via AuthorizationAuditService for every handler', async () => {
      const { authzAudit, guard } = buildGuard(false, 'enforce');
      const controller = new EventLedgerController(eventLedgerService);

      for (const { name, permission } of handlerPermissionExpectations) {
        const handler = controller[name] as (...args: unknown[]) => unknown;
        await guard.canActivate(
          buildCtx(controller, handler, { userId: 'audit-reader-3' }),
        );

        expect(authzAudit.recordDenial).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId: 'audit-reader-3',
            requiredPermission: permission,
            enforcementMode: 'enforce',
          }),
        );
      }
    });

    it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
      const { authzAudit, guard } = buildGuard(false, 'audit');
      const controller = new EventLedgerController(eventLedgerService);

      const handler = controller.findById as (...args: unknown[]) => unknown;
      const result = await guard.canActivate(
        buildCtx(controller, handler, { userId: 'audit-reader-4' }),
      );

      expect(result).toBe(true);
      expect(authzAudit.recordDenial).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'audit-reader-4',
          requiredPermission: 'audit:read',
          enforcementMode: 'audit',
        }),
      );
    });
  });

  it('rejects internal event bodies with invalid outcomes', () => {
    const result = emitInternalEventLedgerSchema.safeParse({
      domain: 'git',
      eventName: 'git.clone.requested',
      outcome: 'queued',
    });

    expect(result.success).toBe(false);
  });

  it('validates internal event UUID context fields and allows payload records', () => {
    const valid = emitInternalEventLedgerSchema.safeParse({
      domain: 'git',
      eventName: 'git.clone.requested',
      outcome: 'in_progress',
      severity: 'info',
      actorType: 'system',
      context: {
        scopeId: '44444444-4444-4444-8444-444444444444',
        contextId: '55555555-5555-4555-8555-555555555555',
        contextType: 'resource',
      },
      workflowId: '66666666-6666-4666-8666-666666666666',
      workflowRunId: '77777777-7777-4777-8777-777777777777',
      payload: { repositoryUrl: 'https://github.com/example/project.git' },
    });
    const invalid = emitInternalEventLedgerSchema.safeParse({
      domain: 'git',
      eventName: 'git.clone.requested',
      outcome: 'in_progress',
      context: {
        scopeId: 'not-a-uuid',
      },
    });

    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
