import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { PaginationQueryRequest, WorkflowSortColumn } from '@nexus/core';
import { In, Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';
import type { WorkflowSourceType } from '../entities/workflow.entity.types';

const WORKFLOW_DEFINITION_ID_REGEX = /^workflow_id:\s*(\S+)/m;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKFLOW_SORT_COLUMN_EXPRESSIONS: Record<WorkflowSortColumn, string> = {
  name: 'workflow.name',
  created_at: 'workflow.created_at',
  is_active: 'workflow.is_active',
};

@Injectable()
export class WorkflowRepository {
  constructor(
    @InjectRepository(Workflow)
    private readonly repository: Repository<Workflow>,
  ) {}

  async findAll(options?: { includeInactive?: boolean }): Promise<Workflow[]> {
    if (options?.includeInactive) {
      return this.repository.find();
    }

    return this.repository.find({ where: { is_active: true } });
  }

  async findById(id: string): Promise<Workflow | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIds(ids: string[]): Promise<Workflow[]> {
    if (ids.length === 0) {
      return [];
    }

    return this.repository.find({ where: { id: In(ids) } });
  }

  async findByIdentifier(
    identifier: string,
    options?: { includeInactive?: boolean },
  ): Promise<Workflow | null> {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      return null;
    }

    if (UUID_PATTERN.test(trimmedIdentifier)) {
      const workflow = await this.findById(trimmedIdentifier);
      if (workflow && (options?.includeInactive || workflow.is_active)) {
        return workflow;
      }

      return null;
    }

    const workflows = await this.findAll({
      includeInactive: options?.includeInactive ?? true,
    });
    const normalizedIdentifier = normalizeWorkflowIdentifier(trimmedIdentifier);

    return (
      workflows.find((workflow) => {
        const definitionWorkflowId = extractWorkflowDefinitionId(
          workflow.yaml_definition,
        );

        const normalizedIdentifiers = [
          workflow.id,
          workflow.name,
          definitionWorkflowId,
        ]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => normalizeWorkflowIdentifier(value));

        return normalizedIdentifiers.includes(normalizedIdentifier);
      }) ?? null
    );
  }

  async findByIdentifierForScope(
    identifier: string,
    scopeId?: string,
  ): Promise<Workflow | null> {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      return null;
    }

    if (scopeId) {
      const scoped = await this.findRepositoryWorkflowByIdentifier(
        trimmedIdentifier,
        scopeId,
      );
      if (scoped) {
        return scoped;
      }
    }

    return this.findGlobalWorkflowByIdentifier(trimmedIdentifier);
  }

  async findActiveBySourceScope(
    sourceType: WorkflowSourceType,
    scopeId: string,
  ): Promise<Workflow[]> {
    return this.repository
      .createQueryBuilder('workflow')
      .where('workflow.is_active = :isActive', { isActive: true })
      .andWhere('workflow.source_type = :sourceType', { sourceType })
      .andWhere('workflow.scope_id = :scopeId', { scopeId })
      .orderBy('workflow.created_at', 'DESC')
      .getMany();
  }

  async findActiveNonRepositoryByIdentifier(
    identifier: string,
  ): Promise<Workflow | null> {
    const trimmedIdentifier = identifier.trim();
    if (!trimmedIdentifier) {
      return null;
    }

    return this.findGlobalWorkflowByIdentifier(trimmedIdentifier);
  }

  async findRepositoryDefinitionByPath(
    scopeId: string,
    sourcePath: string,
  ): Promise<Workflow | null> {
    return this.repository
      .createQueryBuilder('workflow')
      .where('workflow.source_type = :sourceType', {
        sourceType: 'repository',
      })
      .andWhere('workflow.scope_id = :scopeId', { scopeId })
      .andWhere('workflow.source_path = :sourcePath', { sourcePath })
      .getOne();
  }

  async findPaged(
    pagination: { limit: number; offset: number },
    options?: Partial<
      Pick<
        PaginationQueryRequest,
        'includeInactive' | 'isActive' | 'search' | 'sortBy' | 'sortDir'
      >
    > & { scopeIds?: string[] },
  ): Promise<{ data: Workflow[]; total: number }> {
    const queryBuilder = this.repository.createQueryBuilder('workflow');

    if (options?.isActive !== undefined) {
      queryBuilder.where('workflow.is_active = :isActive', {
        isActive: options.isActive,
      });
    } else if (!options?.includeInactive) {
      queryBuilder.where('workflow.is_active = :isActive', { isActive: true });
    }

    if (options?.search) {
      queryBuilder.andWhere(
        '(workflow.name ILIKE :search OR workflow.yaml_definition ILIKE :search)',
        { search: `%${options.search}%` },
      );
    }

    // NULL scope_id denotes platform/global workflows, visible to any
    // workflows:read holder. Scoped workflows are visible only within the
    // caller's accessible scopes.
    if (options?.scopeIds !== undefined) {
      if (options.scopeIds.length > 0) {
        queryBuilder.andWhere(
          '(workflow.scope_id IS NULL OR workflow.scope_id = ANY(:scopeIds))',
          { scopeIds: options.scopeIds },
        );
      } else {
        queryBuilder.andWhere('workflow.scope_id IS NULL');
      }
    }

    const sortColumn =
      WORKFLOW_SORT_COLUMN_EXPRESSIONS[options?.sortBy ?? 'created_at'];
    const sortDirection = options?.sortDir === 'asc' ? 'ASC' : 'DESC';

    queryBuilder
      .orderBy(sortColumn, sortDirection)
      .skip(pagination.offset)
      .take(pagination.limit);

    const [data, total] = await queryBuilder.getManyAndCount();
    return { data, total };
  }

  async findByName(name: string): Promise<Workflow[]> {
    return this.repository.find({ where: { name } });
  }

  async create(data: Partial<Workflow>): Promise<Workflow> {
    const workflow = this.repository.create(data);
    return this.repository.save(workflow);
  }

  async update(id: string, data: Partial<Workflow>): Promise<Workflow | null> {
    await this.repository.update(
      id,
      data as import('typeorm').QueryDeepPartialEntity<Workflow>,
    );
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async deactivateByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.repository.update({ id: In(ids) }, { is_active: false });
  }

  private async findRepositoryWorkflowByIdentifier(
    identifier: string,
    scopeId: string,
  ): Promise<Workflow | null> {
    const normalizedIdentifier = normalizeWorkflowIdentifier(identifier);

    const results = await this.repository
      .createQueryBuilder('workflow')
      .where('workflow.is_active = :isActive', { isActive: true })
      .andWhere('workflow.source_type = :sourceType', {
        sourceType: 'repository',
      })
      .andWhere('workflow.scope_id = :scopeId', { scopeId })
      .getMany();

    return (
      results.find((workflow) => {
        const definitionWorkflowId = extractWorkflowDefinitionId(
          workflow.yaml_definition,
        );

        const candidates = [workflow.id, workflow.name, definitionWorkflowId]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => normalizeWorkflowIdentifier(value));

        return candidates.includes(normalizedIdentifier);
      }) ?? null
    );
  }

  private async findGlobalWorkflowByIdentifier(
    identifier: string,
  ): Promise<Workflow | null> {
    const normalizedIdentifier = normalizeWorkflowIdentifier(identifier);

    if (UUID_PATTERN.test(identifier)) {
      const workflow = await this.findById(identifier);
      if (
        workflow &&
        workflow.is_active &&
        workflow.source_type !== 'repository'
      ) {
        return workflow;
      }
      return null;
    }

    const results = await this.repository
      .createQueryBuilder('workflow')
      .where('workflow.is_active = :isActive', { isActive: true })
      .andWhere(
        '(workflow.source_type IS NULL OR workflow.source_type != :repositoryType)',
        { repositoryType: 'repository' },
      )
      .getMany();

    const nonRepository = results.filter(
      (wf) => wf.source_type !== 'repository',
    );

    return (
      nonRepository.find((workflow) => {
        const definitionWorkflowId = extractWorkflowDefinitionId(
          workflow.yaml_definition,
        );

        const candidates = [workflow.id, workflow.name, definitionWorkflowId]
          .filter((value): value is string => typeof value === 'string')
          .map((value) => normalizeWorkflowIdentifier(value));

        return candidates.includes(normalizedIdentifier);
      }) ?? null
    );
  }
}

function normalizeWorkflowIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

function extractWorkflowDefinitionId(yamlDefinition: unknown): string | null {
  if (typeof yamlDefinition !== 'string') {
    return null;
  }

  const match = WORKFLOW_DEFINITION_ID_REGEX.exec(yamlDefinition);
  if (!match || typeof match[1] !== 'string') {
    return null;
  }

  const workflowId = match[1].trim();
  return workflowId.length > 0 ? workflowId : null;
}
