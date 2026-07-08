import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository, SelectQueryBuilder } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import { WorkflowRepository } from './workflow.repository';

type Qb = Pick<
  SelectQueryBuilder<Workflow>,
  | 'where'
  | 'andWhere'
  | 'orderBy'
  | 'skip'
  | 'take'
  | 'getMany'
  | 'getManyAndCount'
  | 'getOne'
>;

const UUID_V4 = '550e8400-e29b-41d4-a716-446655440000' as const;

describe('WorkflowRepository', () => {
  let queryBuilder: Qb;
  let typeormRepo: Pick<
    Repository<Workflow>,
    'createQueryBuilder' | 'findOne' | 'find' | 'update'
  >;
  let repo: WorkflowRepository;

  beforeEach(() => {
    queryBuilder = {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getManyAndCount: vi.fn().mockResolvedValue([[], 0]),
      getOne: vi.fn().mockResolvedValue(null),
    };
    typeormRepo = {
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    };
    repo = new WorkflowRepository(typeormRepo as Repository<Workflow>);
  });

  describe('findByIdentifierForScope', () => {
    it('returns a scoped repository workflow when scope_id matches', async () => {
      const workflow = {
        id: 'wf-1',
        name: 'pre_merge_quality',
        yaml_definition: '',
        is_active: true,
        source_type: 'repository',
        scope_id: 'scope-1',
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;
      queryBuilder.getMany = vi.fn().mockResolvedValue([workflow]);

      const result = await repo.findByIdentifierForScope(
        'pre_merge_quality',
        'scope-1',
      );

      expect(result).toEqual(workflow);
      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('workflow');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'workflow.is_active = :isActive',
        { isActive: true },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.source_type = :sourceType',
        { sourceType: 'repository' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.scope_id = :scopeId',
        { scopeId: 'scope-1' },
      );
    });

    it('falls back to a global non-repository workflow when no scoped match', async () => {
      const globalWorkflow = {
        id: 'wf-2',
        name: 'pre_merge_quality',
        yaml_definition: '',
        is_active: true,
        source_type: 'user',
        scope_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;

      queryBuilder.getMany = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([globalWorkflow]);

      const result = await repo.findByIdentifierForScope(
        'pre_merge_quality',
        'scope-2',
      );

      expect(result).toEqual(globalWorkflow);
    });

    it('returns null when neither scoped nor global workflow matches', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findByIdentifierForScope(
        'nonexistent',
        'scope-3',
      );

      expect(result).toBeNull();
    });

    it('returns null for empty identifier', async () => {
      const result = await repo.findByIdentifierForScope('   ', 'scope-1');

      expect(result).toBeNull();
      expect(typeormRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('scoped repository workflow wins over global when both share the same YAML workflow_id and scope matches', async () => {
      const yaml = [
        'name: Pre-merge',
        'workflow_id: pre_merge_quality',
        'description: Checks',
      ].join('\n');
      const scopedWorkflow = {
        id: 'wf-scoped',
        name: 'repo_pre_merge',
        yaml_definition: yaml,
        is_active: true,
        source_type: 'repository',
        scope_id: 'scope-1',
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;

      queryBuilder.getMany = vi.fn().mockResolvedValue([scopedWorkflow]);

      const result = await repo.findByIdentifierForScope(
        'pre_merge_quality',
        'scope-1',
      );

      expect(result).toEqual(scopedWorkflow);
      expect(result?.id).toBe('wf-scoped');
    });

    it('falls back to global workflow when YAML workflow_id matches but scope does not', async () => {
      const yaml = [
        'name: Pre-merge',
        'workflow_id: pre_merge_quality',
        'description: Checks',
      ].join('\n');
      const globalWorkflow = {
        id: 'wf-global',
        name: 'global_pre_merge',
        yaml_definition: yaml,
        is_active: true,
        source_type: 'user',
        scope_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;

      queryBuilder.getMany = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([globalWorkflow]);

      const result = await repo.findByIdentifierForScope(
        'pre_merge_quality',
        'scope-2',
      );

      expect(result).toEqual(globalWorkflow);
      expect(result?.id).toBe('wf-global');
    });

    it('matches by YAML workflow_id even when entity name differs from the identifier', async () => {
      const yaml = [
        'name: Custom Quality',
        'workflow_id: pre_merge_quality',
        'description: Checks',
      ].join('\n');
      const scopedWorkflow = {
        id: 'wf-3',
        name: 'custom_name',
        yaml_definition: yaml,
        is_active: true,
        source_type: 'repository',
        scope_id: 'scope-1',
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;

      queryBuilder.getMany = vi.fn().mockResolvedValue([scopedWorkflow]);

      const result = await repo.findByIdentifierForScope(
        'pre_merge_quality',
        'scope-1',
      );

      expect(result).toEqual(scopedWorkflow);
      expect(result?.name).toBe('custom_name');
    });
  });

  describe('findActiveBySourceScope', () => {
    it('returns only active rows for the requested source_type and scope_id', async () => {
      const workflows = [
        { id: 'wf-1', source_type: 'repository', scope_id: 'scope-1' },
        { id: 'wf-2', source_type: 'repository', scope_id: 'scope-1' },
      ] as unknown as Workflow[];
      queryBuilder.getMany = vi.fn().mockResolvedValue(workflows);

      const result = await repo.findActiveBySourceScope(
        'repository',
        'scope-1',
      );

      expect(result).toEqual(workflows);
      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('workflow');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'workflow.is_active = :isActive',
        { isActive: true },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.source_type = :sourceType',
        { sourceType: 'repository' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.scope_id = :scopeId',
        { scopeId: 'scope-1' },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'workflow.created_at',
        'DESC',
      );
    });

    it('returns an empty array when no matches exist', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findActiveBySourceScope(
        'repository',
        'unknown-scope',
      );

      expect(result).toEqual([]);
    });
  });

  describe('findRepositoryDefinitionByPath', () => {
    it('returns a workflow for the given scope_id and source_path', async () => {
      const workflow = {
        id: 'wf-1',
        source_type: 'repository',
        scope_id: 'scope-1',
        source_path: '.nexus/workflows/pr-checks.yml',
      } as unknown as Workflow;
      queryBuilder.getOne = vi.fn().mockResolvedValue(workflow);

      const result = await repo.findRepositoryDefinitionByPath(
        'scope-1',
        '.nexus/workflows/pr-checks.yml',
      );

      expect(result).toEqual(workflow);
      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('workflow');
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'workflow.source_type = :sourceType',
        { sourceType: 'repository' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.scope_id = :scopeId',
        { scopeId: 'scope-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.source_path = :sourcePath',
        { sourcePath: '.nexus/workflows/pr-checks.yml' },
      );
    });

    it('returns null when no workflow matches the path', async () => {
      queryBuilder.getOne = vi.fn().mockResolvedValue(null);

      const result = await repo.findRepositoryDefinitionByPath(
        'scope-1',
        'nonexistent.yml',
      );

      expect(result).toBeNull();
    });
  });

  describe('findActiveNonRepositoryByIdentifier', () => {
    const YAML_WF_ID = 'pre_merge_quality';

    const yaml = [
      'name: Pre-merge',
      'workflow_id: pre_merge_quality',
      'description: Checks',
    ].join('\n');

    it('finds active non-repository by YAML workflow_id', async () => {
      const nonRepoWorkflow = {
        id: 'wf-non-repo-1',
        name: 'Pre-merge Quality',
        yaml_definition: yaml,
        is_active: true,
        source_type: 'seed',
        scope_id: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;
      queryBuilder.getMany = vi.fn().mockResolvedValue([nonRepoWorkflow]);

      const result = await repo.findActiveNonRepositoryByIdentifier(YAML_WF_ID);

      expect(result).toEqual(nonRepoWorkflow);
      expect(result?.source_type).toBe('seed');
      expect(typeormRepo.createQueryBuilder).toHaveBeenCalledWith('workflow');
    });

    it('returns null for repository-sourced workflow with matching YAML workflow_id (JS guard filters repository rows)', async () => {
      const repoWorkflow = {
        id: 'wf-repo-1',
        name: 'Pre-merge Quality',
        yaml_definition: yaml,
        is_active: true,
        source_type: 'repository',
        scope_id: 'scope-1',
        created_at: new Date(),
        updated_at: new Date(),
      } as unknown as Workflow;
      queryBuilder.getMany = vi.fn().mockResolvedValue([repoWorkflow]);

      const result = await repo.findActiveNonRepositoryByIdentifier(YAML_WF_ID);

      expect(result).toBeNull();
    });

    it('returns null when no active non-repository workflow matches', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);

      const result =
        await repo.findActiveNonRepositoryByIdentifier('nonexistent');

      expect(result).toBeNull();
    });

    it('returns null for empty identifier', async () => {
      const result = await repo.findActiveNonRepositoryByIdentifier('   ');

      expect(result).toBeNull();
      expect(typeormRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('returns null for inactive non-repository workflow with matching YAML workflow_id', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findActiveNonRepositoryByIdentifier(YAML_WF_ID);

      expect(result).toBeNull();
    });
  });

  describe('findByIdentifierForScope UUID behaviour', () => {
    const repoWorkflowId = UUID_V4;
    const nonRepoWorkflowId = '660e8400-e29b-41d4-a716-446655440001';

    const repositoryWorkflow = {
      id: repoWorkflowId,
      name: 'repo_wf',
      yaml_definition: '',
      is_active: true,
      source_type: 'repository',
      scope_id: 'scope-1',
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as Workflow;

    const nonRepositoryWorkflow = {
      id: nonRepoWorkflowId,
      name: 'global_wf',
      yaml_definition: '',
      is_active: true,
      source_type: 'seed',
      scope_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    } as unknown as Workflow;

    it('returns the repository workflow by UUID when scope matches', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([repositoryWorkflow]);

      const result = await repo.findByIdentifierForScope(
        repoWorkflowId,
        'scope-1',
      );

      expect(result).toEqual(repositoryWorkflow);
      expect(result?.source_type).toBe('repository');
    });

    it('does NOT return the repository workflow as global fallback by UUID when scope does not match', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);
      (typeormRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        repositoryWorkflow,
      );

      const result = await repo.findByIdentifierForScope(
        repoWorkflowId,
        'scope-2',
      );

      expect(result).toBeNull();
    });

    it('still returns a global non-repository workflow by UUID', async () => {
      queryBuilder.getMany = vi.fn().mockResolvedValue([]);
      (typeormRepo.findOne as ReturnType<typeof vi.fn>).mockResolvedValue(
        nonRepositoryWorkflow,
      );

      const result = await repo.findByIdentifierForScope(
        nonRepoWorkflowId,
        'scope-1',
      );

      expect(result).toEqual(nonRepositoryWorkflow);
      expect(result?.source_type).toBe('seed');
    });
  });

  describe('findPaged', () => {
    it('filters by exact active state when isActive is provided', async () => {
      await repo.findPaged({ limit: 20, offset: 0 }, { isActive: false });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'workflow.is_active = :isActive',
        { isActive: false },
      );
      expect(queryBuilder.skip).toHaveBeenCalledWith(0);
      expect(queryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('applies search and requested sort for workflow table queries', async () => {
      await repo.findPaged(
        { limit: 10, offset: 20 },
        { search: 'triage', sortBy: 'name', sortDir: 'asc' },
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(workflow.name ILIKE :search OR workflow.yaml_definition ILIKE :search)',
        { search: '%triage%' },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('workflow.name', 'ASC');
      expect(queryBuilder.skip).toHaveBeenCalledWith(20);
      expect(queryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('includes NULL-scoped (platform) workflows alongside accessible scopes', async () => {
      await repo.findPaged(
        { limit: 20, offset: 0 },
        { scopeIds: ['team-a', 'team-a-child'] },
      );

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(workflow.scope_id IS NULL OR workflow.scope_id = ANY(:scopeIds))',
        { scopeIds: ['team-a', 'team-a-child'] },
      );
    });

    it('returns only NULL-scoped (platform) workflows when no accessible scopes', async () => {
      await repo.findPaged({ limit: 20, offset: 0 }, { scopeIds: [] });

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'workflow.scope_id IS NULL',
      );
    });
  });

  describe('deactivateByIds', () => {
    it('calls repository.update with In(ids) and is_active: false', async () => {
      await repo.deactivateByIds(['wf-1', 'wf-2']);

      expect(typeormRepo.update).toHaveBeenCalledTimes(1);
      expect(typeormRepo.update).toHaveBeenCalledWith(
        { id: expect.any(Object) },
        { is_active: false },
      );
    });

    it('no-ops on empty array without calling repository.update', async () => {
      await repo.deactivateByIds([]);

      expect(typeormRepo.update).not.toHaveBeenCalled();
    });
  });
});
