import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeartbeatRunStatus } from '@nexus/core';
import { HeartbeatController } from './heartbeat.controller';
import type { HeartbeatService } from './heartbeat.service';
import type { CreateHeartbeatProfileDto } from './dto/create-heartbeat-profile.dto';
import type { ListHeartbeatProfilesDto } from './dto/list-heartbeat-profiles.dto';
import type { ListHeartbeatRunsDto } from './dto/list-heartbeat-runs.dto';
import type { UpdateHeartbeatProfileDto } from './dto/update-heartbeat-profile.dto';
import type {
  HeartbeatProfileSummaryView,
  HeartbeatRunSummaryView,
  ListHeartbeatProfilesResult,
  ListHeartbeatRunsResult,
} from './heartbeat.types';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../auth/authorization/require-permission.decorator';

type HeartbeatServiceMock = Pick<
  HeartbeatService,
  | 'createHeartbeatProfile'
  | 'listHeartbeatProfiles'
  | 'getHeartbeatProfile'
  | 'updateHeartbeatProfile'
  | 'runHeartbeatNow'
  | 'deleteHeartbeatProfile'
  | 'listHeartbeatRuns'
>;

const PROFILE_TIMESTAMP = new Date('2026-07-01T10:00:00.000Z');

function makeProfileSummary(
  overrides: Partial<HeartbeatProfileSummaryView> = {},
): HeartbeatProfileSummaryView {
  return {
    id: overrides.id ?? 'profile-1',
    scopeId: overrides.scopeId ?? 'scope-1',
    name: overrides.name ?? 'nightly-ping',
    enabled: overrides.enabled ?? true,
    interval_seconds: overrides.interval_seconds ?? 60,
    workflow_id:
      overrides.workflow_id ?? '11111111-1111-4111-8111-111111111111',
    payload_json: overrides.payload_json ?? {},
    next_run_at: overrides.next_run_at ?? null,
    last_run_at: overrides.last_run_at ?? null,
    created_by: overrides.created_by ?? null,
    updated_by: overrides.updated_by ?? null,
    created_at: overrides.created_at ?? PROFILE_TIMESTAMP,
    updated_at: overrides.updated_at ?? PROFILE_TIMESTAMP,
    last_run: overrides.last_run ?? null,
  };
}

function makeRunSummary(
  overrides: Partial<HeartbeatRunSummaryView> = {},
): HeartbeatRunSummaryView {
  return {
    id: overrides.id ?? 'run-1',
    heartbeat_profile_id: overrides.heartbeat_profile_id ?? 'profile-1',
    status: overrides.status ?? HeartbeatRunStatus.TRIGGERED,
    due_at: overrides.due_at ?? PROFILE_TIMESTAMP,
    triggered_at: overrides.triggered_at ?? PROFILE_TIMESTAMP,
    started_at: overrides.started_at ?? null,
    finished_at: overrides.finished_at ?? null,
    workflow_run_id: overrides.workflow_run_id ?? null,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
    diagnostics_json: overrides.diagnostics_json ?? null,
    created_at: overrides.created_at ?? PROFILE_TIMESTAMP,
    updated_at: overrides.updated_at ?? PROFILE_TIMESTAMP,
  };
}

function makeListProfilesResult(
  items: HeartbeatProfileSummaryView[],
  overrides: Partial<ListHeartbeatProfilesResult> = {},
): ListHeartbeatProfilesResult {
  return {
    items,
    total: overrides.total ?? items.length,
    limit: overrides.limit ?? 50,
    offset: overrides.offset ?? 0,
  };
}

function makeListRunsResult(
  items: HeartbeatRunSummaryView[],
  overrides: Partial<ListHeartbeatRunsResult> = {},
): ListHeartbeatRunsResult {
  return {
    items,
    total: overrides.total ?? items.length,
    limit: overrides.limit ?? 50,
    offset: overrides.offset ?? 0,
  };
}

function createHeartbeatServiceMock(): HeartbeatServiceMock {
  return {
    createHeartbeatProfile: vi.fn(),
    listHeartbeatProfiles: vi.fn(),
    getHeartbeatProfile: vi.fn(),
    updateHeartbeatProfile: vi.fn(),
    runHeartbeatNow: vi.fn(),
    deleteHeartbeatProfile: vi.fn(),
    listHeartbeatRuns: vi.fn(),
  };
}

function createController(service: HeartbeatServiceMock) {
  return new HeartbeatController(service as unknown as HeartbeatService);
}

describe('HeartbeatController', () => {
  let service: HeartbeatServiceMock;
  let controller: HeartbeatController;

  beforeEach(() => {
    service = createHeartbeatServiceMock();
    controller = createController(service);
  });

  it('creates a heartbeat profile', async () => {
    const dto = {
      scopeId: 'scope-1',
      name: 'nightly-ping',
      interval_seconds: 60,
      workflow_id: '11111111-1111-4111-8111-111111111111',
    } as CreateHeartbeatProfileDto;
    const expected = makeProfileSummary({
      id: 'profile-1',
      scopeId: dto.scopeId,
      name: dto.name,
      interval_seconds: dto.interval_seconds,
      workflow_id: dto.workflow_id,
    });
    vi.mocked(service.createHeartbeatProfile).mockResolvedValue(expected);

    const result = await controller.create(dto);

    expect(service.createHeartbeatProfile).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true, data: expected });
  });

  it('lists heartbeat profiles for a scope', async () => {
    const query = {
      scopeId: 'scope-1',
      limit: 10,
      offset: 0,
    };
    const expected = makeListProfilesResult([
      makeProfileSummary({ id: 'profile-1', scopeId: query.scopeId }),
    ]);
    vi.mocked(service.listHeartbeatProfiles).mockResolvedValue(expected);

    const result = await controller.list(query);

    expect(service.listHeartbeatProfiles).toHaveBeenCalledWith({
      scopeId: query.scopeId,
      pagination: { limit: query.limit, offset: query.offset },
    });
    expect(result).toEqual({ success: true, data: expected });
  });

  it('looks up a heartbeat profile by id', async () => {
    const expected = makeProfileSummary({
      id: 'profile-1',
      name: 'nightly-ping',
    });
    vi.mocked(service.getHeartbeatProfile).mockResolvedValue(expected);

    const result = await controller.getById('profile-1');

    expect(service.getHeartbeatProfile).toHaveBeenCalledWith('profile-1');
    expect(result).toEqual({ success: true, data: expected });
  });

  it('updates a heartbeat profile', async () => {
    const dto = { name: 'renamed' } as UpdateHeartbeatProfileDto;
    const expected = makeProfileSummary({ id: 'profile-1', name: dto.name! });
    vi.mocked(service.updateHeartbeatProfile).mockResolvedValue(expected);

    const result = await controller.update('profile-1', dto);

    expect(service.updateHeartbeatProfile).toHaveBeenCalledWith(
      'profile-1',
      dto,
    );
    expect(result).toEqual({ success: true, data: expected });
  });

  it('runs a heartbeat immediately', async () => {
    const expected = makeRunSummary({
      id: 'run-1',
      heartbeat_profile_id: 'profile-1',
    });
    vi.mocked(service.runHeartbeatNow).mockResolvedValue(expected);

    const result = await controller.runNow('profile-1');

    expect(service.runHeartbeatNow).toHaveBeenCalledWith('profile-1');
    expect(result).toEqual({ success: true, data: expected });
  });

  it('removes a heartbeat profile', async () => {
    vi.mocked(service.deleteHeartbeatProfile).mockResolvedValue(undefined);

    const result = await controller.remove('profile-1');

    expect(service.deleteHeartbeatProfile).toHaveBeenCalledWith('profile-1');
    expect(result).toEqual({ success: true, data: { id: 'profile-1' } });
  });

  it('lists heartbeat run history', async () => {
    const query = { limit: 5, offset: 0 };
    const expected = makeListRunsResult([makeRunSummary({ id: 'run-1' })]);
    vi.mocked(service.listHeartbeatRuns).mockResolvedValue(expected);

    const result = await controller.listRuns('profile-1', query);

    expect(service.listHeartbeatRuns).toHaveBeenCalledWith('profile-1', {
      limit: query.limit,
      offset: query.offset,
    });
    expect(result).toEqual({ success: true, data: expected });
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `heartbeat.controller.ts` from the legacy
 * role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real `PermissionsGuard` against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('HeartbeatController — PermissionsGuard integration', () => {
  const service = createHeartbeatServiceMock() as unknown as HeartbeatService;

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
    controller: HeartbeatController,
    handler: (...args: unknown[]) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => HeartbeatController,
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
    name: keyof HeartbeatController;
    permission: string;
  }> = [
    { name: 'create', permission: 'automation:manage' },
    { name: 'list', permission: 'automation:read' },
    { name: 'getById', permission: 'automation:read' },
    { name: 'update', permission: 'automation:manage' },
    { name: 'runNow', permission: 'automation:manage' },
    { name: 'remove', permission: 'automation:manage' },
    { name: 'listRuns', permission: 'automation:read' },
  ];

  for (const { name, permission } of handlerPermissionExpectations) {
    it(`declares ${permission} as the required permission for ${name}`, () => {
      // Pin the migration: the legacy Admin/Developer role-list
      // decorator is gone and the handler now requires the
      // read/manage-tier automation permission. Read-only GETs use
      // `automation:read`; lifecycle / write actions use
      // `automation:manage`.
      const controller = createController(createHeartbeatServiceMock());
      const reflector = new Reflector();
      const handler = controller[name] as (...args: unknown[]) => unknown;
      const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
      expect(observed).toBe(permission);
    });
  }

  it('binds every handler to a permission via RequirePermission', () => {
    // The migration replaced the legacy role-based decorator on
    // each handler with the explicit `@RequirePermission(...)`
    // declaration above. This sweep asserts that every declared
    // handler now carries a permission (no router-level fallback
    // to a controller-class default that would mask a missing
    // per-handler migration).
    const reflector = new Reflector();
    for (const { name } of handlerPermissionExpectations) {
      const controller = createController(createHeartbeatServiceMock());
      const handler = controller[name] as (...args: unknown[]) => unknown;
      expect(reflector.get(REQUIRED_PERMISSION_KEY, handler)).toBeTruthy();
    }
  });

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission (read)', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = createController(service);

    const handler = controller.list as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'admin-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'admin-seed-1',
      'automation:read',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('automation');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('allows a user that holds the required permission (manage)', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = createController(service);

    const handler = controller.create as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'admin-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'admin-seed-1',
      'automation:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('automation');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = createController(service);

    const handler = controller.remove as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent-seed-1',
      'automation:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService for every handler', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = createController(service);

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
    const controller = createController(service);

    const handler = controller.listRuns as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent-seed-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent-seed-1',
        requiredPermission: 'automation:read',
        enforcementMode: 'audit',
      }),
    );
  });
});
