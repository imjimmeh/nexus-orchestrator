import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowLaunchPresetRepository } from '../database/repositories/workflow-launch-preset.repository';
import { WorkflowLaunchOrchestrationService } from './workflow-launch-orchestration.service';
import { WorkflowLaunchController } from './workflow-launch.controller';
import type { WorkflowLaunchPreset } from '../database/entities/workflow-launch-preset.entity';
import type { IWorkflow, WorkflowLaunchDescriptor } from '@nexus/core';

// Helper to build a minimal IWorkflow for testing
function createMockWorkflow(overrides: Partial<IWorkflow> = {}): IWorkflow {
  return {
    id: 'workflow-1',
    name: 'Test Workflow',
    is_active: true,
    yaml_definition: 'name: Test Workflow',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

// Helper to build mock launch descriptors
function createMockDescriptor(
  overrides: Partial<WorkflowLaunchDescriptor> = {},
): WorkflowLaunchDescriptor {
  return {
    workflowRowId: 'workflow-1',
    workflowDefinitionId: 'wf-def-1',
    workflowName: 'Test Workflow',
    isActive: true,
    contract: {
      workflowId: 'wf-def-1',
      workflowName: 'Test Workflow',
      triggerType: 'manual',
      launchable: true,
      context: 'none',
      inputs: [],
      allowRawJson: true,
    },
    eligibility: { eligible: true, reasons: [] },
    ...overrides,
  };
}

// Helper to build a mock preset
function createMockPreset(
  overrides: Partial<WorkflowLaunchPreset> = {},
): WorkflowLaunchPreset {
  return {
    id: 'preset-1',
    workflow_id: 'workflow-1',
    scopeId: null,
    name: 'My Preset',
    trigger_data: { objective: 'Do something' },
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('WorkflowLaunchController', () => {
  let controller: WorkflowLaunchController;
  let persistence: Mocked<IWorkflowPersistenceService>;
  let presets: Mocked<WorkflowLaunchPresetRepository>;
  let orchestration: Mocked<WorkflowLaunchOrchestrationService>;

  beforeEach(async () => {
    vi.clearAllMocks();

    persistence = {
      createWorkflow: vi.fn(),
      getWorkflow: vi.fn(),
      getAllWorkflows: vi.fn(),
      getAllWorkflowsPaged: vi.fn(),
      getWorkflowRuns: vi.fn(),
      getWorkflowRunsPaged: vi.fn(),
      getWorkflowRun: vi.fn(),
      getActiveWorkflowRunsByScopeId: vi.fn(),
      getRunningWorkflowSummariesByScopeId: vi.fn(),
      updateWorkflow: vi.fn(),
      deleteWorkflow: vi.fn(),
      createScopedOverride: vi.fn(),
      findWorkflowsByName: vi.fn(),
    };

    presets = {
      findById: vi.fn(),
      findByIdAndWorkflow: vi.fn(),
      findByWorkflow: vi.fn(),
      findByWorkflowProjectAndName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };

    orchestration = {
      resolveLaunchContext: vi.fn(),
      buildWorkflowLaunchDescriptor: vi.fn(),
      executeWorkflowInternal: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowLaunchController],
      providers: [
        {
          provide: WORKFLOW_PERSISTENCE_SERVICE,
          useValue: persistence,
        },
        {
          provide: WorkflowLaunchPresetRepository,
          useValue: presets,
        },
        {
          provide: WorkflowLaunchOrchestrationService,
          useValue: orchestration,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<WorkflowLaunchController>(WorkflowLaunchController);
  });

  // ─── Task 2: GET /launch-options ────────────────────────────────────────

  describe('GET /launch-options', () => {
    it('returns workflow descriptors list with success envelope', async () => {
      const workflows = [createMockWorkflow({ id: 'wf-1', name: 'Alpha' })];
      const descriptor1 = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Alpha',
      });
      const context = { scopeId: null, contextId: null };

      persistence.getAllWorkflows.mockResolvedValue(workflows);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor1);

      const result = await controller.getLaunchOptions({});

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].workflowName).toBe('Alpha');
    });

    it('passes query params through to resolveLaunchContext', async () => {
      const query = { scopeId: 'scope-1', contextId: 'ctx-1' };

      persistence.getAllWorkflows.mockResolvedValue([]);
      orchestration.resolveLaunchContext.mockReturnValue({
        scopeId: 'scope-1',
        contextId: 'ctx-1',
      });

      await controller.getLaunchOptions(query);

      expect(orchestration.resolveLaunchContext).toHaveBeenCalledWith(query);
    });

    it('handles empty results gracefully', async () => {
      persistence.getAllWorkflows.mockResolvedValue([]);
      orchestration.resolveLaunchContext.mockReturnValue({
        scopeId: null,
        contextId: null,
      });

      const result = await controller.getLaunchOptions({});

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('filters null descriptors and sorts by name', async () => {
      const workflows = [
        createMockWorkflow({ id: 'wf-1', name: 'Beta' }),
        createMockWorkflow({ id: 'wf-2', name: 'Alpha' }),
        createMockWorkflow({ id: 'wf-3', name: 'Gamma' }),
      ];
      const descriptorBeta = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Beta',
      });
      const descriptorAlpha = createMockDescriptor({
        workflowRowId: 'wf-2',
        workflowName: 'Alpha',
      });
      const context = { scopeId: null, contextId: null };

      persistence.getAllWorkflows.mockResolvedValue(workflows);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor
        .mockReturnValueOnce(descriptorBeta)
        .mockReturnValueOnce(descriptorAlpha)
        .mockReturnValueOnce(null); // wf-3 returns null → filtered out

      const result = await controller.getLaunchOptions({});

      expect(result.data).toHaveLength(2);
      expect(result.data[0].workflowName).toBe('Alpha');
      expect(result.data[1].workflowName).toBe('Beta');
    });

    it('calls getAllWorkflows with includeInactive: false', async () => {
      persistence.getAllWorkflows.mockResolvedValue([]);
      orchestration.resolveLaunchContext.mockReturnValue({
        scopeId: null,
        contextId: null,
      });

      await controller.getLaunchOptions({});

      expect(persistence.getAllWorkflows).toHaveBeenCalledWith({
        includeInactive: false,
      });
    });
  });

  // ─── Task 3: GET /:id/launch-contract ───────────────────────────────────

  describe('GET /:id/launch-contract', () => {
    it('returns contract with presets for a valid workflow id', async () => {
      const workflow = createMockWorkflow({ id: 'wf-1' });
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Test Workflow',
      });
      const presetList = [
        createMockPreset({ id: 'preset-1', name: 'My Preset' }),
      ];
      const context = { scopeId: null, contextId: null };
      const query = {};

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue(presetList);

      const result = await controller.getLaunchContract('wf-1', query);

      expect(result.success).toBe(true);
      expect(result.data.workflowName).toBe('Test Workflow');
      expect(result.data.presets).toEqual(presetList);
    });

    it('passes query context params through', async () => {
      const workflow = createMockWorkflow();
      const descriptor = createMockDescriptor();
      const query = {
        scopeId: 'scope-1',
        contextId: 'ctx-1',
        contextType: 'resource',
      };
      const context = { scopeId: 'scope-1', contextId: 'ctx-1' };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await controller.getLaunchContract('wf-1', query);

      expect(orchestration.resolveLaunchContext).toHaveBeenCalledWith(query);
      expect(persistence.getWorkflow).toHaveBeenCalledWith('wf-1');
      expect(presets.findByWorkflow).toHaveBeenCalledWith('wf-1', 'scope-1');
    });

    it('propagates NotFoundException when workflow not found', async () => {
      persistence.getWorkflow.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await expect(
        controller.getLaunchContract('nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when descriptor is null', async () => {
      const workflow = createMockWorkflow();

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue({
        scopeId: null,
        contextId: null,
      });
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(null);

      await expect(controller.getLaunchContract('wf-1', {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('passes scopeId from context to presets findByWorkflow', async () => {
      const workflow = createMockWorkflow();
      const descriptor = createMockDescriptor();
      const context = { scopeId: 'my-scope', contextId: null };
      const query = { scopeId: 'my-scope' };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await controller.getLaunchContract('wf-1', query);

      expect(presets.findByWorkflow).toHaveBeenCalledWith('wf-1', 'my-scope');
    });

    it('passes undefined when scopeId is null in context', async () => {
      const workflow = createMockWorkflow();
      const descriptor = createMockDescriptor();
      const context = { scopeId: null, contextId: null };
      const query = {};

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await controller.getLaunchContract('wf-1', query);

      expect(presets.findByWorkflow).toHaveBeenCalledWith('wf-1', undefined);
    });
  });

  // ─── Task 4: Preset CRUD ────────────────────────────────────────────────

  describe('GET /:id/launch-presets', () => {
    it('lists presets for a workflow', async () => {
      const workflow = createMockWorkflow();
      const presetList = [
        createMockPreset({ id: 'preset-1', name: 'Preset A' }),
        createMockPreset({ id: 'preset-2', name: 'Preset B' }),
      ];
      const context = { scopeId: null, contextId: null };
      const query = {};

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      presets.findByWorkflow.mockResolvedValue(presetList);

      const result = await controller.listLaunchPresets('wf-1', query);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(presetList);
      expect(presets.findByWorkflow).toHaveBeenCalledWith('wf-1', undefined);
    });

    it('verifies workflow exists before listing presets', async () => {
      persistence.getWorkflow.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await expect(
        controller.listLaunchPresets('nonexistent', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes scopeId from context to presets query', async () => {
      const workflow = createMockWorkflow();
      const presetList = [createMockPreset()];
      const context = { scopeId: 'scope-99', contextId: null };
      const query = { scopeId: 'scope-99' };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      presets.findByWorkflow.mockResolvedValue(presetList);

      await controller.listLaunchPresets('wf-1', query);

      expect(presets.findByWorkflow).toHaveBeenCalledWith('wf-1', 'scope-99');
    });
  });

  describe('POST /:id/launch-presets', () => {
    it('creates a preset with name and trigger_data', async () => {
      const workflow = createMockWorkflow();
      const createdPreset = createMockPreset({
        id: 'preset-new',
        name: 'New Preset',
        trigger_data: { key: 'value' },
      });
      const dto = {
        name: 'New Preset',
        trigger_data: { key: 'value' },
      };
      const mockRequest = {
        user: { id: 'user-1' },
      } as unknown as Request & { user?: { id?: string } };

      persistence.getWorkflow.mockResolvedValue(workflow);
      presets.findByWorkflowProjectAndName.mockResolvedValue(null);
      presets.create.mockResolvedValue(createdPreset);

      const result = await controller.createLaunchPreset(
        'wf-1',
        dto,
        mockRequest,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(createdPreset);
      expect(presets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: 'wf-1',
          name: 'New Preset',
          trigger_data: { key: 'value' },
          created_by: 'user-1',
          updated_by: 'user-1',
        }),
      );
    });

    it('throws BadRequestException when name is missing', async () => {
      const dto = {
        name: '',
        trigger_data: {},
      };
      const req = { user: {} } as unknown as Request & {
        user?: { id?: string };
      };

      await expect(
        controller.createLaunchPreset('wf-1', dto, req),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when preset name already exists', async () => {
      const workflow = createMockWorkflow();
      const existingPreset = createMockPreset({ name: 'Duplicate' });

      persistence.getWorkflow.mockResolvedValue(workflow);
      presets.findByWorkflowProjectAndName.mockResolvedValue(existingPreset);

      await expect(
        controller.createLaunchPreset(
          'wf-1',
          { name: 'Duplicate', trigger_data: {} },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('verifies workflow exists before creating', async () => {
      persistence.getWorkflow.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await expect(
        controller.createLaunchPreset(
          'nonexistent',
          { name: 'Test', trigger_data: {} },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('PATCH /:id/launch-presets/:presetId', () => {
    it('updates preset name and trigger_data', async () => {
      const existingPreset = createMockPreset({
        id: 'preset-1',
        name: 'Old Name',
        trigger_data: { old: true },
      });
      const updatedPreset = createMockPreset({
        id: 'preset-1',
        name: 'New Name',
        trigger_data: { new: true },
      });
      const dto = {
        name: 'New Name',
        trigger_data: { new: true },
      };
      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user?: { id?: string };
      };

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);
      presets.findByWorkflowProjectAndName.mockResolvedValue(null);
      presets.update.mockResolvedValue(updatedPreset);

      const result = await controller.updateLaunchPreset(
        'wf-1',
        'preset-1',
        dto,
        req,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(updatedPreset);
      expect(presets.update).toHaveBeenCalledWith(
        'preset-1',
        expect.objectContaining({
          name: 'New Name',
          trigger_data: { new: true },
          updated_by: 'user-1',
        }),
      );
    });

    it('throws NotFoundException when preset does not exist', async () => {
      presets.findByIdAndWorkflow.mockResolvedValue(null);

      await expect(
        controller.updateLaunchPreset(
          'wf-1',
          'nonexistent',
          { name: 'New Name' },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when name update is empty string', async () => {
      const existingPreset = createMockPreset();

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);

      await expect(
        controller.updateLaunchPreset(
          'wf-1',
          'preset-1',
          { name: '' },
          {
            user: { id: 'user-1' },
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when name update conflicts with existing', async () => {
      const existingPreset = createMockPreset({ name: 'Old Name' });
      const duplicatePreset = createMockPreset({
        id: 'preset-2',
        name: 'Duplicate Name',
      });

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);
      presets.findByWorkflowProjectAndName.mockResolvedValue(duplicatePreset);

      await expect(
        controller.updateLaunchPreset(
          'wf-1',
          'preset-1',
          { name: 'Duplicate Name' },
          { user: { id: 'user-1' } },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('only updates provided fields (partial update)', async () => {
      const existingPreset = createMockPreset({
        name: 'Keep Name',
        trigger_data: { old: true },
      });
      const updatedPreset = createMockPreset({
        name: 'Keep Name',
        trigger_data: { updated: true },
      });
      const dto = { trigger_data: { updated: true } };
      const req = { user: { id: 'user-1' } } as unknown as Request & {
        user?: { id?: string };
      };

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);
      presets.update.mockResolvedValue(updatedPreset);

      const result = await controller.updateLaunchPreset(
        'wf-1',
        'preset-1',
        dto,
        req,
      );

      expect(result.success).toBe(true);
      expect(presets.update).toHaveBeenCalledWith(
        'preset-1',
        expect.objectContaining({
          trigger_data: { updated: true },
          updated_by: 'user-1',
        }),
      );
    });

    it('throws NotFoundException when update returns null', async () => {
      const existingPreset = createMockPreset();

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);
      presets.findByWorkflowProjectAndName.mockResolvedValue(null);
      presets.update.mockResolvedValue(null);

      await expect(
        controller.updateLaunchPreset(
          'wf-1',
          'preset-1',
          { name: 'Updated' },
          {
            user: { id: 'user-1' },
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('DELETE /:id/launch-presets/:presetId', () => {
    it('removes a preset and returns deleted id', async () => {
      const existingPreset = createMockPreset({
        id: 'preset-to-delete',
      });

      presets.findByIdAndWorkflow.mockResolvedValue(existingPreset);
      presets.remove.mockResolvedValue(undefined);

      const result = await controller.deleteLaunchPreset(
        'wf-1',
        'preset-to-delete',
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 'preset-to-delete' });
      expect(presets.remove).toHaveBeenCalledWith('preset-to-delete');
    });

    it('throws NotFoundException when preset does not exist', async () => {
      presets.findByIdAndWorkflow.mockResolvedValue(null);

      await expect(
        controller.deleteLaunchPreset('wf-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Task 5: POST /:id/execute ──────────────────────────────────────────

  describe('POST /:id/execute', () => {
    it('delegates to orchestration service with correct params', async () => {
      const executeDto = {
        trigger_data: { objective: 'test' },
        scopeId: 'scope-1',
        dry_run: false,
      };
      const expectedResult = {
        success: true as const,
        data: { runId: 'run-123' },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(expectedResult);

      const result = await controller.execute('wf-1', executeDto);

      expect(orchestration.executeWorkflowInternal).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        executeDto,
        defaultLaunchSource: 'manual',
      });
      expect(result).toEqual(expectedResult);
    });

    it('returns success envelope with orchestration result data', async () => {
      const executeDto = {
        trigger_data: { objective: 'test' },
      };
      const orchestrationResult = {
        success: true as const,
        data: { runId: 'run-456' },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(
        orchestrationResult,
      );

      const result = await controller.execute('wf-1', executeDto);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ runId: 'run-456' });
    });

    it('propagates BadRequestException from orchestration service', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new BadRequestException('Validation failed'),
      );

      await expect(
        controller.execute('wf-1', { trigger_data: {} }),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates NotFoundException from orchestration service', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await expect(
        controller.execute('nonexistent', { trigger_data: {} }),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes defaultLaunchSource as manual', async () => {
      const executeDto = { trigger_data: {} };

      orchestration.executeWorkflowInternal.mockResolvedValue({
        success: true,
        data: { runId: 'run-789' },
      });

      await controller.execute('wf-1', executeDto);

      const callArg = orchestration.executeWorkflowInternal.mock.calls[0][0];
      expect(callArg.defaultLaunchSource).toBe('manual');
    });

    it('passes dry_run:true to orchestration and returns dry-run result', async () => {
      const executeDto = {
        trigger_data: { objective: 'validate' },
        dry_run: true,
      };
      const dryRunResult = {
        success: true as const,
        data: { validation: 'passed', warnings: [] },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(dryRunResult);

      const result = await controller.execute('wf-1', executeDto);

      expect(orchestration.executeWorkflowInternal).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        executeDto,
        defaultLaunchSource: 'manual',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ validation: 'passed', warnings: [] });
    });

    it('passes preset_id to orchestration with correct launchSource derivation', async () => {
      const executeDto = {
        trigger_data: { objective: 'run from preset' },
        preset_id: 'preset-abc',
      };
      const expectedResult = {
        success: true as const,
        data: { runId: 'run-from-preset' },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(expectedResult);

      const result = await controller.execute('wf-1', executeDto);

      expect(orchestration.executeWorkflowInternal).toHaveBeenCalledWith({
        workflowId: 'wf-1',
        executeDto,
        defaultLaunchSource: 'manual',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ runId: 'run-from-preset' });
    });

    it('lets generic Error propagate for unexpected failures', async () => {
      const genericError = new Error('Unexpected database failure');

      orchestration.executeWorkflowInternal.mockRejectedValue(genericError);

      await expect(
        controller.execute('wf-1', { trigger_data: {} }),
      ).rejects.toThrow(Error);
      await expect(
        controller.execute('wf-1', { trigger_data: {} }),
      ).rejects.toThrow('Unexpected database failure');
    });
  });

  // ─── Task 2A: Execute endpoint with dry_run ────────────────────────────

  describe('POST /:id/execute with dry_run via HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();

      persistence = {
        createWorkflow: vi.fn(),
        getWorkflow: vi.fn(),
        getAllWorkflows: vi.fn(),
        getAllWorkflowsPaged: vi.fn(),
        getWorkflowRuns: vi.fn(),
        getWorkflowRunsPaged: vi.fn(),
        getWorkflowRun: vi.fn(),
        getActiveWorkflowRunsByScopeId: vi.fn(),
        getRunningWorkflowSummariesByScopeId: vi.fn(),
        updateWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
        createScopedOverride: vi.fn(),
        findWorkflowsByName: vi.fn(),
      };

      presets = {
        findById: vi.fn(),
        findByIdAndWorkflow: vi.fn(),
        findByWorkflow: vi.fn(),
        findByWorkflowProjectAndName: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      orchestration = {
        resolveLaunchContext: vi.fn(),
        buildWorkflowLaunchDescriptor: vi.fn(),
        executeWorkflowInternal: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkflowLaunchController],
        providers: [
          {
            provide: WORKFLOW_PERSISTENCE_SERVICE,
            useValue: persistence,
          },
          {
            provide: WorkflowLaunchPresetRepository,
            useValue: presets,
          },
          {
            provide: WorkflowLaunchOrchestrationService,
            useValue: orchestration,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    it('POST /workflows/:id/execute with dry_run=true returns HTTP 201 with dryRun result structure', async () => {
      const dryRunResult = {
        success: true,
        data: {
          dryRun: true,
          workflowId: 'wf-1',
          workflowName: 'Test',
          executionPath: ['job-1'],
          parallelGroups: [['job-1']],
          stateTransitions: [],
          mockJobsApplied: [],
          jobSimulations: [],
        },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(dryRunResult);

      await request(app.getHttpServer())
        .post('/workflows/wf-1/execute')
        .send({ trigger_data: { key: 'val' }, dry_run: true })
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toBeDefined();
          expect(res.body.data.dryRun).toBe(true);
        });
    });

    it('POST /workflows/:id/execute with dry_run=false returns HTTP 201 with success+data structure', async () => {
      const runResult = {
        success: true,
        data: { runId: 'run-http-201' },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue(runResult);

      await request(app.getHttpServer())
        .post('/workflows/wf-1/execute')
        .send({ trigger_data: { key: 'val' }, dry_run: false })
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.runId).toBe('run-http-201');
        });
    });

    it('POST /workflows/:id/execute with dry_run=true returns 404 when workflow not found', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await request(app.getHttpServer())
        .post('/workflows/nonexistent/execute')
        .send({ dry_run: true })
        .expect(404);
    });
  });

  // ─── Task 2B: Execute endpoint validation errors ────────────────────────

  describe('POST /:id/execute validation errors via HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();

      persistence = {
        createWorkflow: vi.fn(),
        getWorkflow: vi.fn(),
        getAllWorkflows: vi.fn(),
        getAllWorkflowsPaged: vi.fn(),
        getWorkflowRuns: vi.fn(),
        getWorkflowRunsPaged: vi.fn(),
        getWorkflowRun: vi.fn(),
        getActiveWorkflowRunsByScopeId: vi.fn(),
        getRunningWorkflowSummariesByScopeId: vi.fn(),
        updateWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
        createScopedOverride: vi.fn(),
        findWorkflowsByName: vi.fn(),
      };

      presets = {
        findById: vi.fn(),
        findByIdAndWorkflow: vi.fn(),
        findByWorkflow: vi.fn(),
        findByWorkflowProjectAndName: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      orchestration = {
        resolveLaunchContext: vi.fn(),
        buildWorkflowLaunchDescriptor: vi.fn(),
        executeWorkflowInternal: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkflowLaunchController],
        providers: [
          {
            provide: WORKFLOW_PERSISTENCE_SERVICE,
            useValue: persistence,
          },
          {
            provide: WorkflowLaunchPresetRepository,
            useValue: presets,
          },
          {
            provide: WorkflowLaunchOrchestrationService,
            useValue: orchestration,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    it('POST /workflows/:id/execute with invalid payload returns HTTP 400 with validation issue details', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new BadRequestException({
          code: 'WORKFLOW_LAUNCH_VALIDATION_FAILED',
          message: 'Workflow launch payload validation failed.',
          issues: [
            {
              code: 'MISSING_REQUIRED_INPUT',
              message: "Required launch input 'objective' is missing.",
              field: 'objective',
            },
          ],
        }),
      );

      await request(app.getHttpServer())
        .post('/workflows/wf-1/execute')
        .send({ trigger_data: {} })
        .expect(400)
        .expect((res) => {
          expect(res.body.message).toBeDefined();
        });
    });

    it('POST /workflows/:id/execute for non-existent workflow returns 404', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new NotFoundException('Workflow not found'),
      );

      await request(app.getHttpServer())
        .post('/workflows/nonexistent/execute')
        .send({ trigger_data: { objective: 'test' } })
        .expect(404);
    });
  });

  // ─── Task 2C: Launch options endpoint via HTTP ──────────────────────────

  describe('GET /launch-options via HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();

      persistence = {
        createWorkflow: vi.fn(),
        getWorkflow: vi.fn(),
        getAllWorkflows: vi.fn(),
        getAllWorkflowsPaged: vi.fn(),
        getWorkflowRuns: vi.fn(),
        getWorkflowRunsPaged: vi.fn(),
        getWorkflowRun: vi.fn(),
        getActiveWorkflowRunsByScopeId: vi.fn(),
        getRunningWorkflowSummariesByScopeId: vi.fn(),
        updateWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
        createScopedOverride: vi.fn(),
        findWorkflowsByName: vi.fn(),
      };

      presets = {
        findById: vi.fn(),
        findByIdAndWorkflow: vi.fn(),
        findByWorkflow: vi.fn(),
        findByWorkflowProjectAndName: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      orchestration = {
        resolveLaunchContext: vi.fn(),
        buildWorkflowLaunchDescriptor: vi.fn(),
        executeWorkflowInternal: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkflowLaunchController],
        providers: [
          {
            provide: WORKFLOW_PERSISTENCE_SERVICE,
            useValue: persistence,
          },
          {
            provide: WorkflowLaunchPresetRepository,
            useValue: presets,
          },
          {
            provide: WorkflowLaunchOrchestrationService,
            useValue: orchestration,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    it('GET /workflows/launch-options returns 200 with array of launch descriptors', async () => {
      const workflows = [
        createMockWorkflow({ id: 'wf-1', name: 'Alpha' }),
        createMockWorkflow({ id: 'wf-2', name: 'Beta' }),
      ];
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Alpha',
      });

      persistence.getAllWorkflows.mockResolvedValue(workflows);
      orchestration.resolveLaunchContext.mockReturnValue({
        scopeId: null,
        contextId: null,
      });
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);

      await request(app.getHttpServer())
        .get('/workflows/launch-options')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThanOrEqual(1);
          expect(res.body.data[0].workflowName).toBe('Alpha');
        });
    });

    it('GET /workflows/launch-options?scopeId=X returns filtered results', async () => {
      const workflows = [
        createMockWorkflow({ id: 'wf-1', name: 'ProjectScoped' }),
      ];
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'ProjectScoped',
      });
      const context = { scopeId: 'scope-42', contextId: null };

      persistence.getAllWorkflows.mockResolvedValue(workflows);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);

      await request(app.getHttpServer())
        .get('/workflows/launch-options?scopeId=scope-42')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(orchestration.resolveLaunchContext).toHaveBeenCalledWith({
            scopeId: 'scope-42',
          });
        });
    });
  });

  // ─── Task 2D: Launch contract endpoint with eligibility states via HTTP ──

  describe('GET /:id/launch-contract eligibility via HTTP', () => {
    let app: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();

      persistence = {
        createWorkflow: vi.fn(),
        getWorkflow: vi.fn(),
        getAllWorkflows: vi.fn(),
        getAllWorkflowsPaged: vi.fn(),
        getWorkflowRuns: vi.fn(),
        getWorkflowRunsPaged: vi.fn(),
        getWorkflowRun: vi.fn(),
        getActiveWorkflowRunsByScopeId: vi.fn(),
        getRunningWorkflowSummariesByScopeId: vi.fn(),
        updateWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
        createScopedOverride: vi.fn(),
        findWorkflowsByName: vi.fn(),
      };

      presets = {
        findById: vi.fn(),
        findByIdAndWorkflow: vi.fn(),
        findByWorkflow: vi.fn(),
        findByWorkflowProjectAndName: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      orchestration = {
        resolveLaunchContext: vi.fn(),
        buildWorkflowLaunchDescriptor: vi.fn(),
        executeWorkflowInternal: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkflowLaunchController],
        providers: [
          {
            provide: WORKFLOW_PERSISTENCE_SERVICE,
            useValue: persistence,
          },
          {
            provide: WorkflowLaunchPresetRepository,
            useValue: presets,
          },
          {
            provide: WorkflowLaunchOrchestrationService,
            useValue: orchestration,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    it('GET /workflows/:id/launch-contract returns 200 with contract + eligibility', async () => {
      const workflow = createMockWorkflow({ id: 'wf-eligible' });
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-eligible',
        workflowName: 'Eligible Workflow',
        eligibility: { eligible: true, reasons: [] },
      });
      const context = { scopeId: null, contextId: null };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/workflows/wf-eligible/launch-contract')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.workflowName).toBe('Eligible Workflow');
          expect(res.body.data.eligibility.eligible).toBe(true);
          expect(res.body.data.eligibility.reasons).toEqual([]);
        });
    });

    it('GET /workflows/:id/launch-contract for ineligible workflow returns eligibility.reasons', async () => {
      const workflow = createMockWorkflow({ id: 'wf-ineligible' });
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-ineligible',
        workflowName: 'Ineligible Workflow',
        eligibility: {
          eligible: false,
          reasons: [
            {
              code: 'CONTEXT_REQUIRED',
              message: 'This workflow requires a context.',
            },
            {
              code: 'CONTEXT_ID_REQUIRED',
              message: 'This workflow requires a target context item.',
            },
          ],
        },
      });
      const context = { scopeId: null, contextId: null };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/workflows/wf-ineligible/launch-contract')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.workflowName).toBe('Ineligible Workflow');
          expect(res.body.data.eligibility.eligible).toBe(false);
          expect(res.body.data.eligibility.reasons).toHaveLength(2);
          expect(res.body.data.eligibility.reasons[0].code).toBe(
            'CONTEXT_REQUIRED',
          );
          expect(res.body.data.eligibility.reasons[1].code).toBe(
            'CONTEXT_ID_REQUIRED',
          );
        });
    });
  });

  // ─── HTTP status code contract responses ───────────────────────────────

  describe('HTTP status code contract responses', () => {
    let app: INestApplication;

    beforeEach(async () => {
      vi.clearAllMocks();

      persistence = {
        createWorkflow: vi.fn(),
        getWorkflow: vi.fn(),
        getAllWorkflows: vi.fn(),
        getAllWorkflowsPaged: vi.fn(),
        getWorkflowRuns: vi.fn(),
        getWorkflowRunsPaged: vi.fn(),
        getWorkflowRun: vi.fn(),
        getActiveWorkflowRunsByScopeId: vi.fn(),
        getRunningWorkflowSummariesByScopeId: vi.fn(),
        updateWorkflow: vi.fn(),
        deleteWorkflow: vi.fn(),
        createScopedOverride: vi.fn(),
        findWorkflowsByName: vi.fn(),
      };

      presets = {
        findById: vi.fn(),
        findByIdAndWorkflow: vi.fn(),
        findByWorkflow: vi.fn(),
        findByWorkflowProjectAndName: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
      };

      orchestration = {
        resolveLaunchContext: vi.fn(),
        buildWorkflowLaunchDescriptor: vi.fn(),
        executeWorkflowInternal: vi.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [WorkflowLaunchController],
        providers: [
          {
            provide: WORKFLOW_PERSISTENCE_SERVICE,
            useValue: persistence,
          },
          {
            provide: WorkflowLaunchPresetRepository,
            useValue: presets,
          },
          {
            provide: WorkflowLaunchOrchestrationService,
            useValue: orchestration,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({ canActivate: () => true })
        .overrideGuard(PermissionsGuard)
        .useValue({ canActivate: () => true })
        .compile();

      app = module.createNestApplication();
      await app.init();
    });

    it('GET /launch-options returns 200', async () => {
      const workflows = [createMockWorkflow({ id: 'wf-1', name: 'Alpha' })];
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Alpha',
      });
      const context = { scopeId: null, contextId: null };

      persistence.getAllWorkflows.mockResolvedValue(workflows);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);

      await request(app.getHttpServer())
        .get('/workflows/launch-options')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('GET /:id/launch-contract returns 200', async () => {
      const workflow = createMockWorkflow({ id: 'wf-1' });
      const descriptor = createMockDescriptor({
        workflowRowId: 'wf-1',
        workflowName: 'Test Workflow',
      });
      const context = { scopeId: null, contextId: null };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      orchestration.buildWorkflowLaunchDescriptor.mockReturnValue(descriptor);
      presets.findByWorkflow.mockResolvedValue([]);

      await request(app.getHttpServer())
        .get('/workflows/wf-1/launch-contract')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.workflowName).toBe('Test Workflow');
          expect(Array.isArray(res.body.data.presets)).toBe(true);
        });
    });

    it('POST /:id/execute returns 201 on success', async () => {
      const executeDto = {
        trigger_data: { objective: 'test' },
      };

      orchestration.executeWorkflowInternal.mockResolvedValue({
        success: true,
        data: { runId: 'run-http-1' },
      });

      await request(app.getHttpServer())
        .post('/workflows/wf-1/execute')
        .send(executeDto)
        .expect(201)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.runId).toBe('run-http-1');
        });
    });

    it('POST /:id/execute returns 400 when orchestration throws BadRequestException', async () => {
      orchestration.executeWorkflowInternal.mockRejectedValue(
        new BadRequestException('Validation failed'),
      );

      await request(app.getHttpServer())
        .post('/workflows/wf-1/execute')
        .send({ trigger_data: {} })
        .expect(400);
    });

    it('GET /:id/launch-presets returns 200', async () => {
      const workflow = createMockWorkflow();
      const presetList = [
        createMockPreset({ id: 'preset-1', name: 'My Preset' }),
      ];
      const context = { scopeId: null, contextId: null };

      persistence.getWorkflow.mockResolvedValue(workflow);
      orchestration.resolveLaunchContext.mockReturnValue(context);
      presets.findByWorkflow.mockResolvedValue(presetList);

      await request(app.getHttpServer())
        .get('/workflows/wf-1/launch-presets')
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toBe('preset-1');
          expect(res.body.data[0].name).toBe('My Preset');
        });
    });
  });
});
