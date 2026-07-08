import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../../auth/authorization/require-permission.decorator';
import { WorkflowRuntimeCapabilityLifecycleController } from './workflow-runtime-capability-lifecycle.controller';
import type { WorkflowRuntimeCapabilityLifecycleService } from './workflow-runtime-capability-lifecycle.service';

describe('WorkflowRuntimeCapabilityLifecycleController', () => {
  it('passes authenticated runtime user context to tool candidate creation', async () => {
    const lifecycleTools = {
      createToolCandidate: vi.fn().mockResolvedValue({ artifact_id: 'tool-1' }),
    } as unknown as WorkflowRuntimeCapabilityLifecycleService;
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    const result = await controller.createToolCandidate(
      {
        user: {
          userId: 'agent:run-1:job-1',
          roles: ['Agent'],
          agentProfileName: 'developer',
        },
      },
      {
        name: 'inspect_project_state',
        description: 'Inspect project state',
        schema: {},
      } as never,
    );

    expect(lifecycleTools.createToolCandidate).toHaveBeenCalledWith({
      name: 'inspect_project_state',
      description: 'Inspect project state',
      schema: {},
      user: {
        userId: 'agent:run-1:job-1',
        roles: ['Agent'],
        agentProfileName: 'developer',
      },
    });
    expect(result).toEqual({ success: true, data: { artifact_id: 'tool-1' } });
  });

  it('passes route artifact id and runtime context to candidate validation', async () => {
    const lifecycleTools = {
      validateToolCandidate: vi.fn().mockResolvedValue({ valid: true }),
    } as unknown as WorkflowRuntimeCapabilityLifecycleService;
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    await controller.validateToolCandidate(
      { user: { userId: 'admin-1', roles: ['Admin'] } },
      'artifact-1',
      { workflow_run_id: 'run-1', job_id: 'job-1' },
    );

    expect(lifecycleTools.validateToolCandidate).toHaveBeenCalledWith({
      artifact_id: 'artifact-1',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: {
        userId: 'admin-1',
        roles: ['Admin'],
        agentProfileName: undefined,
      },
    });
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating
 * `workflow-runtime-capability-lifecycle.controller.ts` from the
 * legacy role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real PermissionsGuard against
 * the migrated handler metadata. This pins three behaviors for the
 * audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('WorkflowRuntimeCapabilityLifecycleController — PermissionsGuard integration', () => {
  const lifecycleTools = {
    createToolCandidate: vi.fn(),
    validateToolCandidate: vi.fn(),
    publishToolCandidate: vi.fn(),
    upsertTool: vi.fn(),
    createSkill: vi.fn(),
    saveScriptAsSkill: vi.fn(),
    updateSkill: vi.fn(),
    listSkillFiles: vi.fn(),
    upsertSkillFile: vi.fn(),
    deleteSkillFile: vi.fn(),
    replaceProfileSkills: vi.fn(),
    addProfileSkills: vi.fn(),
    removeProfileSkills: vi.fn(),
  } as unknown as WorkflowRuntimeCapabilityLifecycleService;

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
    controller: WorkflowRuntimeCapabilityLifecycleController,
    handler: (...args: unknown[]) => unknown,
    user: unknown,
  ) {
    return {
      getHandler: () => handler,
      getClass: () => WorkflowRuntimeCapabilityLifecycleController,
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
    name: keyof WorkflowRuntimeCapabilityLifecycleController;
    permission: string;
  }> = [
    { name: 'createToolCandidate', permission: 'agents:manage' },
    { name: 'validateToolCandidate', permission: 'agents:manage' },
    { name: 'publishToolCandidate', permission: 'agents:manage' },
    { name: 'upsertTool', permission: 'agents:manage' },
    { name: 'createSkill', permission: 'skills:manage' },
    { name: 'saveScriptAsSkill', permission: 'skills:manage' },
    { name: 'updateSkill', permission: 'skills:manage' },
    { name: 'listSkillFiles', permission: 'skills:read' },
    { name: 'upsertSkillFile', permission: 'skills:manage' },
    { name: 'deleteSkillFile', permission: 'skills:manage' },
    { name: 'replaceProfileSkills', permission: 'agents:manage' },
    { name: 'addProfileSkills', permission: 'agents:manage' },
    { name: 'removeProfileSkills', permission: 'agents:manage' },
  ];

  for (const { name, permission } of handlerPermissionExpectations) {
    it(`declares ${permission} as the required permission for ${name}`, () => {
      // Pin the migration: the legacy Admin/Developer/Agent role-list
      // decorator is gone and the handler now requires the
      // developer-class `*:manage` permission (or `skills:read` for
      // the inventory-only `listSkillFiles` handler).
      const controller = new WorkflowRuntimeCapabilityLifecycleController(
        lifecycleTools,
      );
      const reflector = new Reflector();
      const handler = controller[name] as (...args: unknown[]) => unknown;
      const observed = reflector.get(REQUIRED_PERMISSION_KEY, handler);
      expect(observed).toBe(permission);
    });
  }

  // ─── Permission-bearing user is allowed ───────────────────────────────

  it('allows a user that holds the required permission', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    const handler = controller.createToolCandidate as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'agents:manage',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('agents');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  // ─── User lacking permission is denied ────────────────────────────────

  it('denies a user lacking the required permission', async () => {
    const { authz, guard } = buildGuard(false, 'enforce');
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    const handler = controller.createSkill as (...args: unknown[]) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1:job-1',
      'skills:manage',
      expect.any(String),
      undefined,
    );
  });

  // ─── Audit service records the denial ────────────────────────────────

  it('records a denial via AuthorizationAuditService for every handler', async () => {
    const { authzAudit, guard } = buildGuard(false, 'enforce');
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    for (const { name, permission } of handlerPermissionExpectations) {
      const handler = controller[name] as (...args: unknown[]) => unknown;
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
    const controller = new WorkflowRuntimeCapabilityLifecycleController(
      lifecycleTools,
    );

    const handler = controller.listSkillFiles as (
      ...args: unknown[]
    ) => unknown;
    const result = await guard.canActivate(
      buildCtx(controller, handler, { userId: 'agent:run-1:job-1' }),
    );

    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent:run-1:job-1',
        requiredPermission: 'skills:read',
        enforcementMode: 'audit',
      }),
    );
  });
});
