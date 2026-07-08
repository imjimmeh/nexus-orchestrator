import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentResponseStoreService } from '../../redis/agent-response-store.service';
import { RedisPubSubService } from '../../redis/redis-pubsub.service';
import { RedisStreamService } from '../../redis/redis-stream.service';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { REQUIRED_PERMISSION_KEY } from '../../auth/authorization/require-permission.decorator';
import { WorkflowRuntimeStepCompleteController } from './workflow-runtime-step-complete.controller';

describe('WorkflowRuntimeStepCompleteController', () => {
  const streamService = {
    persistEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisStreamService;
  const pubsubService = {
    publishEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisPubSubService;
  const agentResponseStore = {
    storeStepComplete: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentResponseStoreService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies step completion when the workflow run is terminal', async () => {
    const terminalRunGuard = {
      assertRunIsActive: vi
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'Workflow run run-1 has terminal status FAILED; step_complete is not allowed',
          ),
        ),
    };
    const controller = new WorkflowRuntimeStepCompleteController(
      streamService,
      pubsubService,
      agentResponseStore,
      undefined,
      undefined,
      terminalRunGuard as never,
    );

    const result = await controller.stepComplete(
      {
        user: { userId: 'agent:run-1:job-1', jobId: 'job-1', stepId: 'step-1' },
      },
      { summary: 'late' },
    );

    expect(result).toEqual({
      success: false,
      ok: false,
      error:
        'Workflow run run-1 has terminal status FAILED; step_complete is not allowed',
      executionStatus: 'terminated',
    });
    expect(streamService.persistEvent).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ event_type: 'step_complete_denied' }),
    );
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
  });

  it('fails closed when a job-scoped agent cannot access the completion guard', async () => {
    const controller = new WorkflowRuntimeStepCompleteController(
      streamService,
      pubsubService,
      agentResponseStore,
    );

    await expect(
      controller.stepComplete(
        {
          user: {
            userId: 'agent:run-1:job-1',
            jobId: 'job-1',
            stepId: 'step-1',
          },
        },
        { summary: 'done' },
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(streamService.persistEvent).not.toHaveBeenCalled();
    expect(pubsubService.publishEvent).not.toHaveBeenCalled();
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
  });

  it('denies step completion when active subagents are still running', async () => {
    const docker = {
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: 'parent-container-1',
          Created: 100,
          Labels: {
            'nexus.managed': 'true',
            'nexus.workflow_run_id': 'run-1',
            'nexus.job_id': 'job-1',
            'nexus.step_id': 'step-1',
          },
        },
      ]),
    };
    const subagentReadModel = {
      findByParentContainerId: vi.fn().mockResolvedValue([
        {
          id: 'subagent-1',
          status: 'Running',
          parent_container_id: 'parent-container-1',
        },
        {
          id: 'subagent-2',
          status: 'Spawning',
          parent_container_id: 'parent-container-1',
        },
      ]),
    };
    const controller = new WorkflowRuntimeStepCompleteController(
      streamService,
      pubsubService,
      agentResponseStore,
      undefined,
      undefined,
      undefined,
      subagentReadModel as never,
      docker,
    );

    const result = await controller.stepComplete(
      {
        user: {
          userId: 'agent:run-1:job-1',
          jobId: 'job-1',
          stepId: 'step-1',
        },
      },
      { summary: 'done' },
    );

    expect(result).toEqual({
      success: false,
      ok: false,
      error: expect.stringContaining('subagent-1') as unknown,
    });
    expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
  });

  it('allows step completion when all subagents are terminal', async () => {
    const docker = {
      listContainers: vi.fn().mockResolvedValue([
        {
          Id: 'parent-container-1',
          Created: 100,
          Labels: {
            'nexus.managed': 'true',
            'nexus.workflow_run_id': 'run-1',
            'nexus.job_id': 'job-1',
            'nexus.step_id': 'step-1',
          },
        },
      ]),
    };
    const subagentReadModel = {
      findByParentContainerId: vi.fn().mockResolvedValue([
        {
          id: 'subagent-1',
          status: 'Completed',
          parent_container_id: 'parent-container-1',
        },
        {
          id: 'subagent-2',
          status: 'Failed',
          parent_container_id: 'parent-container-1',
        },
      ]),
    };
    const stepCompletionGuard = {
      validateStepCompletion: vi
        .fn()
        .mockResolvedValue({ allowed: true, missing: [] }),
    };
    const controller = new WorkflowRuntimeStepCompleteController(
      streamService,
      pubsubService,
      agentResponseStore,
      undefined,
      stepCompletionGuard as never,
      undefined,
      subagentReadModel as never,
      docker,
    );

    const result = await controller.stepComplete(
      {
        user: {
          userId: 'agent:run-1:job-1',
          jobId: 'job-1',
          stepId: 'step-1',
        },
      },
      { summary: 'done' },
    );

    expect(result).toEqual({
      success: true,
      ok: true,
      executionStatus: 'completed',
    });
    expect(agentResponseStore.storeStepComplete).toHaveBeenCalled();
  });

  it('allows step completion when subagent check fails gracefully', async () => {
    const docker = {
      listContainers: vi
        .fn()
        .mockRejectedValue(new Error('Docker daemon unreachable')),
    };
    const subagentReadModel = {
      findByParentContainerId: vi.fn(),
    };
    const stepCompletionGuard = {
      validateStepCompletion: vi
        .fn()
        .mockResolvedValue({ allowed: true, missing: [] }),
    };
    const controller = new WorkflowRuntimeStepCompleteController(
      streamService,
      pubsubService,
      agentResponseStore,
      undefined,
      stepCompletionGuard as never,
      undefined,
      subagentReadModel as never,
      docker,
    );

    const result = await controller.stepComplete(
      {
        user: {
          userId: 'agent:run-1:job-1',
          jobId: 'job-1',
          stepId: 'step-1',
        },
      },
      { summary: 'done' },
    );

    expect(result).toEqual({
      success: true,
      ok: true,
      executionStatus: 'completed',
    });
    expect(agentResponseStore.storeStepComplete).toHaveBeenCalled();
  });

  describe('repair before validation', () => {
    it('repairs reason to reasoning and strips unknown fields', async () => {
      const toolContractRepair = {
        repair: vi.fn().mockResolvedValue({
          payload: { summary: 'Done', reasoning: 'Worked', status: 'ok' },
          repairs: [
            { field: 'reasoning', originalType: 'string' },
            { field: 'extra', originalType: 'extra_field_stripped' },
          ],
        }),
      };
      const stepCompletionGuard = {
        validateStepCompletion: vi
          .fn()
          .mockResolvedValue({ allowed: true, missing: [] }),
      };
      const controller = new WorkflowRuntimeStepCompleteController(
        streamService,
        pubsubService,
        agentResponseStore,
        toolContractRepair as never,
        stepCompletionGuard as never,
      );

      const result = await controller.stepComplete(
        {
          user: {
            userId: 'agent:run-1:job-1',
            jobId: 'job-1',
            stepId: 'step-1',
          },
        },
        { summary: 'Done', reason: 'Worked', extra: 'strip me' },
      );

      expect(result).toEqual({
        success: true,
        ok: true,
        executionStatus: 'completed',
      });
      expect(toolContractRepair.repair).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'step_complete',
          payload: { summary: 'Done', reason: 'Worked', extra: 'strip me' },
        }),
      );
      expect(agentResponseStore.storeStepComplete).toHaveBeenCalled();
    });

    it('rejects bodies with unrepaired extra fields', async () => {
      const toolContractRepair = {
        repair: vi.fn().mockResolvedValue({
          payload: { summary: 'Done', unknown_field: 'still here' },
          repairs: [],
        }),
      };
      const controller = new WorkflowRuntimeStepCompleteController(
        streamService,
        pubsubService,
        agentResponseStore,
        toolContractRepair as never,
      );

      await expect(
        controller.stepComplete(
          {
            user: {
              userId: 'agent:run-1:job-1',
              jobId: 'job-1',
              stepId: 'step-1',
            },
          },
          { summary: 'Done', unknown_field: 'still here' },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
    });

    it('falls through without repair when adapter is absent', async () => {
      const stepCompletionGuard = {
        validateStepCompletion: vi
          .fn()
          .mockResolvedValue({ allowed: true, missing: [] }),
      };
      const controller = new WorkflowRuntimeStepCompleteController(
        streamService,
        pubsubService,
        agentResponseStore,
        undefined,
        stepCompletionGuard as never,
      );

      const result = await controller.stepComplete(
        {
          user: {
            userId: 'agent:run-1:job-1',
            jobId: 'job-1',
            stepId: 'step-1',
          },
        },
        { summary: 'done', reasoning: 'explained' },
      );

      expect(result).toEqual({
        success: true,
        ok: true,
        executionStatus: 'completed',
      });
      expect(agentResponseStore.storeStepComplete).toHaveBeenCalled();
    });

    it('rejects bodies with extra fields when no repair adapter is present', async () => {
      const controller = new WorkflowRuntimeStepCompleteController(
        streamService,
        pubsubService,
        agentResponseStore,
      );

      await expect(
        controller.stepComplete(
          {
            user: {
              userId: 'agent:run-1:job-1',
              jobId: 'job-1',
              stepId: 'step-1',
            },
          },
          { summary: 'Done', unknown_field: 'Should be rejected' },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(agentResponseStore.storeStepComplete).not.toHaveBeenCalled();
    });
  });
});

/**
 * Authorization migration regression tests
 * ----------------------------------------
 * After migrating `workflow-runtime-step-complete.controller.ts`
 * from the legacy role-based guard class to `PermissionsGuard` +
 * `RequirePermission`, exercise the real PermissionsGuard against
 * the migrated controller handler metadata. This pins three
 * behaviors for the audit record:
 *   (a) a permission-bearing user is allowed,
 *   (b) a user lacking the required permission is denied,
 *   (c) the audit service records the denial.
 */
describe('WorkflowRuntimeStepCompleteController — PermissionsGuard integration', () => {
  const guardStreamService = {
    persistEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisStreamService;
  const guardPubsubService = {
    publishEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as RedisPubSubService;
  const guardAgentResponseStore = {
    storeStepComplete: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentResponseStoreService;

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

  function buildCtx(user: unknown) {
    const controller = new WorkflowRuntimeStepCompleteController(
      guardStreamService,
      guardPubsubService,
      guardAgentResponseStore,
    );
    return {
      getHandler: () => controller.stepComplete,
      getClass: () => WorkflowRuntimeStepCompleteController,
      switchToHttp: () => ({
        getRequest: () => ({ user, params: {}, query: {}, body: {} }),
      }),
    } as unknown as Parameters<PermissionsGuard['canActivate']>[0];
  }

  it('declares workflows:update as the required permission for stepComplete', () => {
    // Pin the migration: the legacy Admin/Developer/Agent role-list
    // decorator is gone and the handler now requires the agent role's
    // documented `workflows:update` permission.
    const controller = new WorkflowRuntimeStepCompleteController(
      guardStreamService,
      guardPubsubService,
      guardAgentResponseStore,
    );
    const reflector = new Reflector();
    const permission = reflector.get(
      REQUIRED_PERMISSION_KEY,
      controller.stepComplete,
    );
    expect(permission).toBe('workflows:update');
  });

  it('allows a user that holds workflows:update', async () => {
    const { authz, enforcement, authzAudit, guard } = buildGuard(true);
    const result = await guard.canActivate(buildCtx({ userId: 'agent:run-1' }));
    expect(result).toBe(true);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1',
      'workflows:update',
      expect.any(String),
      undefined,
    );
    expect(enforcement.getMode).toHaveBeenCalledWith('workflows');
    expect(authzAudit.recordDenial).not.toHaveBeenCalled();
  });

  it('denies a user lacking workflows:update and records the denial', async () => {
    const { authz, authzAudit, guard } = buildGuard(false, 'enforce');
    const result = await guard.canActivate(buildCtx({ userId: 'agent:run-1' }));
    expect(result).toBe(false);
    expect(authz.can).toHaveBeenCalledWith(
      'agent:run-1',
      'workflows:update',
      expect.any(String),
      undefined,
    );
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'agent:run-1',
        requiredPermission: 'workflows:update',
        enforcementMode: 'enforce',
      }),
    );
  });

  it('records a would-deny audit under staged-enforcement (audit mode) but still allows', async () => {
    const { authzAudit, guard } = buildGuard(false, 'audit');
    const result = await guard.canActivate(buildCtx({ userId: 'agent:run-1' }));
    expect(result).toBe(true);
    expect(authzAudit.recordDenial).toHaveBeenCalledWith(
      expect.objectContaining({
        requiredPermission: 'workflows:update',
        enforcementMode: 'audit',
      }),
    );
  });
});
