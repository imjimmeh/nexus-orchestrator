import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RepositoryWorkflowDiscoveryService } from './repository-workflow-discovery.service';
import type { WorkflowRepository } from './database/repositories/workflow.repository';
import type { YAMLValidationService } from '../security/yaml-validation.service';
import type { WorkflowParserService } from './workflow-parser.service';
import type { WorkflowValidationService } from './workflow-validation.service';
import type { Workflow } from './database/entities/workflow.entity';

const { getStatError, setStatError } = vi.hoisted(() => {
  let error: Error | null = null;
  return {
    getStatError: () => error,
    setStatError: (err: Error | null) => {
      error = err;
    },
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    stat: vi
      .fn()
      .mockImplementation(async (...args: Parameters<typeof actual.stat>) => {
        const err = getStatError();
        if (err) throw err;
        return actual.stat(...args);
      }),
  };
});

const VALID_WORKFLOW_YAML = `workflow_id: pre_merge_quality
name: Pre-merge Quality
trigger:
  type: lifecycle
  phase: pre-merge
  hook: before
  blocking: true
description: Quality gate before merging PRs
jobs:
  - id: lint_check
    type: execution
    tier: light
    steps:
      - run: lint
        type: shell
        command: npm run lint
`;

const VALID_WORKFLOW_YAML_2 = `workflow_id: post_merge_cleanup
name: Post-merge Cleanup
trigger:
  type: lifecycle
  phase: post-merge
  hook: after
description: Cleanup after merging PRs
jobs:
  - id: cleanup
    type: execution
    tier: light
    steps:
      - run: cleanup
        type: shell
        command: echo cleanup
`;

function makeFakeWorkflow(
  overrides: Partial<Workflow> = {},
): Partial<Workflow> {
  return {
    id: 'wf-uuid-1',
    name: 'Pre-merge Quality',
    yaml_definition: VALID_WORKFLOW_YAML,
    is_active: true,
    source_type: 'repository',
    scope_id: 'scope-1',
    source_path: '.nexus/workflows/pre_merge_quality.workflow.yaml',
    source_ref: 'sha-1',
    source_hash: 'abc123',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('RepositoryWorkflowDiscoveryService', () => {
  let service: RepositoryWorkflowDiscoveryService;
  let repo: {
    findRepositoryDefinitionByPath: ReturnType<typeof vi.fn>;
    findActiveBySourceScope: ReturnType<typeof vi.fn>;
    findActiveNonRepositoryByIdentifier: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deactivateByIds: ReturnType<typeof vi.fn>;
  };
  let yamlValidator: { validateAndThrow: ReturnType<typeof vi.fn> };
  let workflowParser: { parseWorkflow: ReturnType<typeof vi.fn> };
  let workflowValidator: { validateAndThrow: ReturnType<typeof vi.fn> };
  let tmpRoot: string;
  let workflowsDir: string;

  beforeEach(async () => {
    repo = {
      findRepositoryDefinitionByPath: vi.fn(),
      findActiveBySourceScope: vi.fn(),
      findActiveNonRepositoryByIdentifier: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deactivateByIds: vi.fn(),
    };
    yamlValidator = { validateAndThrow: vi.fn() };
    workflowParser = { parseWorkflow: vi.fn() };
    workflowValidator = { validateAndThrow: vi.fn() };

    service = new RepositoryWorkflowDiscoveryService(
      repo as unknown as WorkflowRepository,
      yamlValidator as unknown as YAMLValidationService,
      workflowParser as unknown as WorkflowParserService,
      workflowValidator as unknown as WorkflowValidationService,
    );

    tmpRoot = path.join(
      os.tmpdir(),
      `nexus-repo-discovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    workflowsDir = path.join(tmpRoot, '.nexus', 'workflows');
  });

  afterEach(async () => {
    vi.clearAllMocks();
    setStatError(null);
    await fsPromises
      .rm(tmpRoot, { recursive: true, force: true })
      .catch(() => {});
  });

  describe('when .nexus/workflows directory is missing', () => {
    it('disables existing active repository workflows and returns zero discovered', async () => {
      const existingActive: Partial<Workflow>[] = [
        makeFakeWorkflow({
          id: 'wf-1',
          source_path: '.nexus/workflows/old.workflow.yaml',
        }),
        makeFakeWorkflow({
          id: 'wf-2',
          source_path: '.nexus/workflows/old2.workflow.yaml',
        }),
      ];
      repo.findActiveBySourceScope.mockResolvedValue(existingActive);
      repo.deactivateByIds.mockResolvedValue(undefined);

      const result = await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(result).toEqual({ discovered: 0, upserted: 0, disabled: 2 });
      expect(repo.deactivateByIds).toHaveBeenCalledTimes(1);
      expect(repo.deactivateByIds).toHaveBeenCalledWith(['wf-1', 'wf-2']);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('rejects with non-ENOENT filesystem errors instead of silently disabling workflows', async () => {
      setStatError(
        Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
      );

      await expect(
        service.refreshRepositoryWorkflows({
          scopeId: 'scope-1',
          rootPath: tmpRoot,
          sourceRef: 'sha-1',
        }),
      ).rejects.toThrow('Permission denied');

      expect(repo.findActiveBySourceScope).not.toHaveBeenCalled();
    });
  });

  describe('when .nexus/workflows has valid workflow files', () => {
    beforeEach(async () => {
      await fsPromises.mkdir(workflowsDir, { recursive: true });
    });

    it('discovers and creates a valid workflow with source metadata and sha256 hash', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      repo.findRepositoryDefinitionByPath.mockResolvedValue(null);
      repo.findActiveBySourceScope.mockResolvedValue([]);
      repo.create.mockResolvedValue(makeFakeWorkflow());
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        description: 'Quality gate before merging PRs',
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [{ run: 'lint', type: 'shell', command: 'npm run lint' }],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      const result = await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(result.discovered).toBe(1);
      expect(result.upserted).toBe(1);
      expect(result.disabled).toBe(0);
      expect(repo.create).toHaveBeenCalledTimes(1);

      const createCall = repo.create.mock.calls[0]?.[0] as Partial<Workflow>;
      expect(createCall.name).toBe('Pre-merge Quality');
      expect(createCall.yaml_definition).toBe(VALID_WORKFLOW_YAML);
      expect(createCall.is_active).toBe(true);
      expect(createCall.source_type).toBe('repository');
      expect(createCall.scope_id).toBe('scope-1');
      expect(createCall.source_path).toBe(
        '.nexus/workflows/pre_merge_quality.workflow.yaml',
      );
      expect(createCall.source_ref).toBe('sha-1');
      expect(createCall.source_hash).toBeTypeOf('string');
      expect(createCall.source_hash).toHaveLength(64);
    });

    it('updates an existing repository workflow by source path and reactivates it', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      const existing = makeFakeWorkflow({
        id: 'wf-existing',
        is_active: false,
        source_hash: 'old-hash',
      });
      repo.findRepositoryDefinitionByPath.mockResolvedValue(existing);
      repo.findActiveBySourceScope.mockResolvedValue([existing]);
      repo.update.mockResolvedValue(existing);
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        description: 'Quality gate before merging PRs',
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [{ run: 'lint', type: 'shell', command: 'npm run lint' }],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      const result = await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(result.discovered).toBe(1);
      expect(result.upserted).toBe(1);
      expect(result.disabled).toBe(0);
      expect(repo.update).toHaveBeenCalledTimes(1);
      expect(repo.create).not.toHaveBeenCalled();

      const updateCall = repo.update.mock.calls[0] as [
        string,
        Partial<Workflow>,
      ];
      expect(updateCall[0]).toBe('wf-existing');
      expect(updateCall[1].name).toBe('Pre-merge Quality');
      expect(updateCall[1].is_active).toBe(true);
      expect(updateCall[1].source_type).toBe('repository');
      expect(updateCall[1].source_hash).toBeTypeOf('string');
    });

    it('disables active repository workflows removed from the checkout', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      const kept = makeFakeWorkflow({
        id: 'wf-kept',
        source_path: '.nexus/workflows/pre_merge_quality.workflow.yaml',
      });
      const removed = makeFakeWorkflow({
        id: 'wf-removed',
        name: 'Old Workflow',
        source_path: '.nexus/workflows/old.workflow.yaml',
      });

      repo.findRepositoryDefinitionByPath.mockResolvedValue(kept);
      repo.findActiveBySourceScope.mockResolvedValue([kept, removed]);
      repo.update.mockResolvedValue({});
      repo.deactivateByIds.mockResolvedValue(undefined);
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        description: 'Quality gate before merging PRs',
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [{ run: 'lint', type: 'shell', command: 'npm run lint' }],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      const result = await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(result.discovered).toBe(1);
      expect(result.upserted).toBe(1);
      expect(result.disabled).toBe(1);
      expect(repo.deactivateByIds).toHaveBeenCalledTimes(1);
      expect(repo.deactivateByIds).toHaveBeenCalledWith(['wf-removed']);
      expect(repo.update).toHaveBeenCalledWith(
        'wf-kept',
        expect.objectContaining({ is_active: true }),
      );
    });

    it('throws ConflictException for duplicate discovered workflow_id values', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'a.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );
      await fsPromises.writeFile(
        path.join(workflowsDir, 'b.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      repo.findRepositoryDefinitionByPath.mockResolvedValue(null);
      repo.findActiveBySourceScope.mockResolvedValue([]);
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      await expect(
        service.refreshRepositoryWorkflows({
          scopeId: 'scope-1',
          rootPath: tmpRoot,
          sourceRef: 'sha-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when discovered workflow_id collides with active non-repository workflow', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      const collidingGlobal = makeFakeWorkflow({
        id: 'wf-global',
        source_type: 'seed',
        source_path: null,
        scope_id: null,
      });
      repo.findRepositoryDefinitionByPath.mockResolvedValue(null);
      repo.findActiveBySourceScope.mockResolvedValue([]);
      repo.findActiveNonRepositoryByIdentifier.mockResolvedValue(
        collidingGlobal,
      );
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      await expect(
        service.refreshRepositoryWorkflows({
          scopeId: 'scope-1',
          rootPath: tmpRoot,
          sourceRef: 'sha-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException for active non-repository collision even when a scoped repository workflow exists', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      const globalNonRepo = makeFakeWorkflow({
        id: 'wf-global-non-repo',
        source_type: 'seed',
        scope_id: null,
        source_path: null,
      });

      repo.findActiveNonRepositoryByIdentifier.mockResolvedValue(globalNonRepo);
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      await expect(
        service.refreshRepositoryWorkflows({
          scopeId: 'scope-1',
          rootPath: tmpRoot,
          sourceRef: 'sha-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(repo.update).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('calls YAML security validation, parser, and workflow validation services', async () => {
      await fsPromises.writeFile(
        path.join(workflowsDir, 'pre_merge_quality.workflow.yaml'),
        VALID_WORKFLOW_YAML,
        'utf-8',
      );

      repo.findRepositoryDefinitionByPath.mockResolvedValue(null);
      repo.findActiveBySourceScope.mockResolvedValue([]);
      repo.create.mockResolvedValue(makeFakeWorkflow());
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockReturnValue({
        workflow_id: 'pre_merge_quality',
        name: 'Pre-merge Quality',
        trigger: {
          type: 'lifecycle',
          phase: 'pre-merge',
          hook: 'before',
          blocking: true,
        },
        jobs: [
          {
            id: 'lint_check',
            type: 'execution',
            tier: 'light',
            steps: [],
          },
        ],
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(yamlValidator.validateAndThrow).toHaveBeenCalledWith(
        VALID_WORKFLOW_YAML,
      );
      expect(workflowParser.parseWorkflow).toHaveBeenCalledWith(
        VALID_WORKFLOW_YAML,
      );
      expect(workflowValidator.validateAndThrow).toHaveBeenCalledWith(
        expect.objectContaining({ workflow_id: 'pre_merge_quality' }),
      );
    });

    it('sorts discovered files deterministically before processing', async () => {
      await fsPromises.mkdir(path.join(workflowsDir), { recursive: true });
      await fsPromises.writeFile(
        path.join(workflowsDir, 'c.workflow.yaml'),
        `workflow_id: wf_c\nname: C\ntrigger:\n  type: manual\ndescription: C\njobs:\n  - id: j1\n    type: execution\n    tier: light\n    steps: []\n`,
        'utf-8',
      );
      await fsPromises.writeFile(
        path.join(workflowsDir, 'a.workflow.yaml'),
        `workflow_id: wf_a\nname: A\ntrigger:\n  type: manual\ndescription: A\njobs:\n  - id: j1\n    type: execution\n    tier: light\n    steps: []\n`,
        'utf-8',
      );
      await fsPromises.writeFile(
        path.join(workflowsDir, 'b.workflow.yaml'),
        `workflow_id: wf_b\nname: B\ntrigger:\n  type: manual\ndescription: B\njobs:\n  - id: j1\n    type: execution\n    tier: light\n    steps: []\n`,
        'utf-8',
      );

      const processedPaths: string[] = [];
      repo.findRepositoryDefinitionByPath.mockImplementation(
        (_scopeId: string, sourcePath: string) => {
          processedPaths.push(sourcePath);
          return null;
        },
      );
      repo.findActiveBySourceScope.mockResolvedValue([]);
      repo.create.mockResolvedValue(makeFakeWorkflow());
      yamlValidator.validateAndThrow.mockImplementation(() => {});
      workflowParser.parseWorkflow.mockImplementation((yaml: string) => {
        const match = /workflow_id:\s*(\S+)/.exec(yaml);
        return {
          workflow_id: match?.[1] ?? 'unknown',
          name: match?.[1] ?? 'unknown',
          trigger: { type: 'manual' as const },
          jobs: [
            {
              id: 'j1',
              type: 'execution' as const,
              tier: 'light' as const,
              steps: [],
            },
          ],
        };
      });
      workflowValidator.validateAndThrow.mockResolvedValue(undefined);

      await service.refreshRepositoryWorkflows({
        scopeId: 'scope-1',
        rootPath: tmpRoot,
        sourceRef: 'sha-1',
      });

      expect(processedPaths).toEqual([
        '.nexus/workflows/a.workflow.yaml',
        '.nexus/workflows/b.workflow.yaml',
        '.nexus/workflows/c.workflow.yaml',
      ]);
    });
  });
});
