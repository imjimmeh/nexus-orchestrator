import type { IWorkflowRun } from '@nexus/core';
import { WorkflowStatus } from '@nexus/core';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import type { GitOpsEditPolicyService } from '../gitops/gitops-edit-policy.service';
import type { GitOpsPendingChangeService } from '../gitops/gitops-pending-change.service';

const parser = { parseWorkflow: vi.fn() };
const validator = { validateAndThrow: vi.fn() };
const yamlValidator = { validateAndThrow: vi.fn() };

type WorkflowFixture = {
  id: string;
  name: string;
  source_type?: 'seed' | 'user' | 'repository';
};

function createWorkflowRunFixture(
  overrides: Partial<IWorkflowRun> = {},
): IWorkflowRun {
  return {
    id: 'run-123456789',
    workflow_id: 'wf-1',
    status: 'RUNNING',
    current_step_id: undefined,
    state_variables: {},
    created_at: new Date('2026-06-04T12:00:00.000Z'),
    updated_at: new Date('2026-06-04T12:00:00.000Z'),
    ...overrides,
  };
}

function createService({
  runs,
  workflows,
  gitops,
}: {
  runs: IWorkflowRun[];
  workflows: WorkflowFixture[];
  gitops?: {
    editPolicy: Partial<GitOpsEditPolicyService>;
    pendingChanges: Partial<GitOpsPendingChangeService>;
  };
}) {
  const repos = {
    runs: {
      findPaged: vi.fn().mockResolvedValue({ data: runs, total: runs.length }),
      findById: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    workflows: {
      findByIdentifier: vi.fn(),
      findByIds: vi.fn().mockResolvedValue(workflows),
      findPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      findById: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    agentProfiles: {},
  };

  return {
    service: new WorkflowPersistenceService(
      repos as never,
      parser as never,
      validator as never,
      yamlValidator as never,
      gitops?.editPolicy as never,
      gitops?.pendingChanges as never,
    ),
    repos,
  };
}

describe('WorkflowPersistenceService', () => {
  describe('getWorkflow', () => {
    it('loads inactive workflow definitions by id for detail views', async () => {
      const workflow = { id: 'workflow-1', name: 'Inactive Workflow' };
      const { service, repos } = createService({
        runs: [],
        workflows: [],
      });

      repos.workflows.findByIdentifier.mockImplementation(
        async (_identifier: string, options?: { includeInactive?: boolean }) =>
          options?.includeInactive ? workflow : null,
      );

      const result = await service.getWorkflow('workflow-1');

      expect(repos.workflows.findByIdentifier).toHaveBeenCalledWith(
        'workflow-1',
        { includeInactive: true },
      );
      expect(result).toBe(workflow);
    });
  });

  describe('getWorkflowRunsPaged', () => {
    it('uses trigger displayName before the workflow definition name', async () => {
      const { service, repos } = createService({
        runs: [
          createWorkflowRunFixture({
            workflow_id: 'wf-1',
            state_variables: { trigger: { displayName: 'Trigger Title' } },
          }),
        ],
        workflows: [{ id: 'wf-1', name: 'Catalog Title' }],
      });

      const result = await service.getWorkflowRunsPaged({
        limit: 10,
        offset: 0,
      });

      expect(repos.workflows.findByIds).toHaveBeenCalledWith(['wf-1']);
      expect(result.data[0]).toMatchObject({
        display_name: 'Trigger Title',
        workflow_name: 'Catalog Title',
      });
    });

    it('uses the workflow definition name when trigger display names are absent', async () => {
      const { service } = createService({
        runs: [
          createWorkflowRunFixture({
            id: 'run-abcdef12',
            workflow_id: 'wf-2',
            status: 'COMPLETED',
          }),
        ],
        workflows: [{ id: 'wf-2', name: 'Catalog Workflow' }],
      });

      const result = await service.getWorkflowRunsPaged({
        limit: 10,
        offset: 0,
      });

      expect(result.data[0]).toMatchObject({
        display_name: 'Catalog Workflow',
        workflow_name: 'Catalog Workflow',
      });
    });

    it('falls back to a deterministic run title when no workflow definition exists', async () => {
      const { service } = createService({
        runs: [
          createWorkflowRunFixture({
            id: 'run-missing-workflow',
            workflow_id: 'wf-missing',
            status: 'FAILED',
            state_variables: { trigger: {} },
          }),
        ],
        workflows: [],
      });

      const result = await service.getWorkflowRunsPaged({
        limit: 10,
        offset: 0,
      });

      expect(result.data[0]).toMatchObject({
        display_name: 'Workflow run run-miss',
        workflow_name: null,
      });
    });

    it('batch-loads each workflow definition only once per page', async () => {
      const { service, repos } = createService({
        runs: [
          createWorkflowRunFixture({ id: 'run-1', workflow_id: 'wf-1' }),
          createWorkflowRunFixture({ id: 'run-2', workflow_id: 'wf-1' }),
          createWorkflowRunFixture({ id: 'run-3', workflow_id: 'wf-2' }),
        ],
        workflows: [
          { id: 'wf-1', name: 'First Workflow' },
          { id: 'wf-2', name: 'Second Workflow' },
        ],
      });

      await service.getWorkflowRunsPaged({ limit: 10, offset: 0 });

      expect(repos.workflows.findByIds).toHaveBeenCalledWith(['wf-1', 'wf-2']);
    });

    it('attaches source_type from the parent workflow', async () => {
      const { service } = createService({
        runs: [createWorkflowRunFixture({ workflow_id: 'wf-1' })],
        workflows: [
          {
            id: 'wf-1',
            name: 'Repository Workflow',
            source_type: 'repository',
          },
        ],
      });

      const result = await service.getWorkflowRunsPaged({
        limit: 10,
        offset: 0,
      });

      expect(result.data[0]).toMatchObject({
        source_type: 'repository',
        workflow_name: 'Repository Workflow',
      });
    });

    it('passes sourceType filters through to the run repository', async () => {
      const { service, repos } = createService({
        runs: [],
        workflows: [],
      });

      await service.getWorkflowRunsPaged(
        { limit: 10, offset: 0 },
        { sourceType: 'repository' },
      );

      expect(repos.runs.findPaged).toHaveBeenCalledWith(
        { limit: 10, offset: 0 },
        { sourceType: 'repository' },
      );
    });
  });

  describe('getAllWorkflowsPaged', () => {
    it('still queries the repository for platform (NULL-scoped) workflows when scopeIds is empty', async () => {
      const { service, repos } = createService({ runs: [], workflows: [] });

      await service.getAllWorkflowsPaged(
        { limit: 20, offset: 0 },
        { scopeIds: [] },
      );

      expect(repos.workflows.findPaged).toHaveBeenCalledWith(
        { limit: 20, offset: 0 },
        expect.objectContaining({ scopeIds: [] }),
      );
    });
  });

  describe('GitOps edit policy', () => {
    it('blocks updates to git-to-app managed workflows', async () => {
      parser.parseWorkflow.mockReturnValue({ name: 'deploy' });
      const editPolicy = {
        evaluateExisting: vi.fn().mockResolvedValue({
          action: 'block',
          reason: 'GitOps git-to-app binding blocks app-side edits',
        }),
        assertAllowed: vi.fn().mockImplementation(() => {
          throw new BadRequestException('blocked');
        }),
      };
      const pendingChanges = { recordConfigObjectChange: vi.fn() };
      const { service, repos } = createService({
        runs: [],
        workflows: [],
        gitops: { editPolicy, pendingChanges },
      });
      repos.workflows.findById.mockResolvedValue({
        id: 'workflow-1',
        name: 'deploy',
        scope_node_id: 'scope-1',
        managedBy: 'gitops',
        managedBindingId: 'binding-1',
        locked: false,
      });

      await expect(
        service.updateWorkflow('workflow-1', 'name: deploy', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repos.workflows.update).not.toHaveBeenCalled();
      expect(pendingChanges.recordConfigObjectChange).not.toHaveBeenCalled();
    });

    it('records a pending outbound change for two-way workflow updates', async () => {
      parser.parseWorkflow.mockReturnValue({ name: 'deploy' });
      const binding = { id: 'binding-1', lastAppliedRevision: 'rev-1' };
      const editPolicy = {
        evaluateExisting: vi.fn().mockResolvedValue({
          action: 'allow_with_pending_change',
          binding,
        }),
        assertAllowed: vi.fn().mockResolvedValue(undefined),
      };
      const pendingChanges = { recordConfigObjectChange: vi.fn() };
      const { service, repos } = createService({
        runs: [],
        workflows: [],
        gitops: { editPolicy, pendingChanges },
      });
      repos.workflows.findById.mockResolvedValue({
        id: 'workflow-1',
        name: 'deploy',
        scope_node_id: 'scope-1',
        managedBy: 'gitops',
        managedBindingId: 'binding-1',
        locked: false,
      });
      repos.workflows.update.mockResolvedValue({
        id: 'workflow-1',
        name: 'deploy',
      });

      await service.updateWorkflow('workflow-1', 'name: deploy', 'user-1');

      expect(pendingChanges.recordConfigObjectChange).toHaveBeenCalledWith(
        expect.objectContaining({
          binding,
          objectType: 'workflow',
          scopeNodeId: 'scope-1',
          name: 'deploy',
          changeType: 'update',
          payload: { yaml_definition: 'name: deploy' },
          actorId: 'user-1',
        }),
      );
    });
  });

  describe('updateRunStatus', () => {
    it('stamps completed_at when transitioning a run to a terminal status', async () => {
      const existing = {
        id: 'run-1',
        status: WorkflowStatus.RUNNING,
        started_at: new Date('2026-06-19T09:00:00.000Z'),
        completed_at: null,
      };
      const { service, repos } = createService({ runs: [], workflows: [] });
      repos.runs.findById.mockResolvedValue(existing);
      repos.runs.update.mockResolvedValue({
        ...existing,
        status: WorkflowStatus.COMPLETED,
      });

      await service.updateRunStatus('run-1', WorkflowStatus.COMPLETED);

      const [, patch] = repos.runs.update.mock.calls[0];
      expect(patch.status).toBe(WorkflowStatus.COMPLETED);
      expect(patch.completed_at).toBeInstanceOf(Date);
    });
  });

  describe('createRun', () => {
    it('stamps started_at when creating a run already in RUNNING', async () => {
      const { service, repos } = createService({ runs: [], workflows: [] });
      repos.runs.create.mockImplementation(async (data: unknown) => data);

      await service.createRun({
        workflow_id: 'wf-1',
        status: WorkflowStatus.RUNNING,
      });

      const [created] = repos.runs.create.mock.calls[0];
      expect(created.started_at).toBeInstanceOf(Date);
    });
  });

  describe('getWorkflowRun', () => {
    it('returns API display names for a single workflow run', async () => {
      const run = createWorkflowRunFixture({
        id: 'run-detail-1234',
        workflow_id: 'wf-detail',
        state_variables: {},
      });
      const repos = {
        runs: {
          findById: vi.fn().mockResolvedValue(run),
        },
        workflows: {
          findByIds: vi
            .fn()
            .mockResolvedValue([{ id: 'wf-detail', name: 'Detail Workflow' }]),
        },
        agentProfiles: {},
      };
      const service = new WorkflowPersistenceService(
        repos as never,
        parser as never,
        validator as never,
        yamlValidator as never,
      );

      const result = await service.getWorkflowRun('run-detail-1234');

      expect(repos.workflows.findByIds).toHaveBeenCalledWith(['wf-detail']);
      expect(result).toMatchObject({
        display_name: 'Detail Workflow',
        workflow_name: 'Detail Workflow',
      });
    });
  });
});
