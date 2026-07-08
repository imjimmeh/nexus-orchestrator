import { Inject, Injectable, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { YAMLValidationService } from '../security/yaml-validation.service';
import { WorkflowParserService } from './workflow-parser.service';
import { WorkflowValidationService } from './workflow-validation.service';
import type {
  RepositoryWorkflowDiscoveryRequest,
  RepositoryWorkflowDiscoveryResult,
} from './repository-workflow-discovery.types';
import type { Workflow } from './database/entities/workflow.entity';

@Injectable()
export class RepositoryWorkflowDiscoveryService {
  private static readonly WORKFLOWS_DIR = '.nexus/workflows';
  private static readonly WORKFLOW_FILE_PATTERN = /\.workflow\.yaml$/;

  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly repository: IWorkflowDefinitionRepository,
    private readonly yamlValidator: YAMLValidationService,
    private readonly workflowParser: WorkflowParserService,
    private readonly workflowValidator: WorkflowValidationService,
  ) {}

  async refreshRepositoryWorkflows(
    request: RepositoryWorkflowDiscoveryRequest,
  ): Promise<RepositoryWorkflowDiscoveryResult> {
    const { scopeId, rootPath, sourceRef } = request;
    const workflowsDirPath = path.join(
      rootPath,
      RepositoryWorkflowDiscoveryService.WORKFLOWS_DIR,
    );

    const dirExists = await fsPromises
      .stat(workflowsDirPath)
      .then((stat) => stat.isDirectory())
      .catch((err: unknown) => {
        if (
          err instanceof Error &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return false;
        throw err;
      });

    if (!dirExists) {
      const disabledCount = await this.disableAllRepositoryWorkflows(scopeId);
      return { discovered: 0, upserted: 0, disabled: disabledCount };
    }

    const files = await fsPromises.readdir(workflowsDirPath);
    const workflowFiles = files
      .filter((f) =>
        RepositoryWorkflowDiscoveryService.WORKFLOW_FILE_PATTERN.test(f),
      )
      .sort();

    if (workflowFiles.length === 0) {
      const disabledCount = await this.disableAllRepositoryWorkflows(scopeId);
      return { discovered: 0, upserted: 0, disabled: disabledCount };
    }

    const discoveredSet = new Set<string>();
    let upserted = 0;

    for (const file of workflowFiles) {
      const filePath = path.join(workflowsDirPath, file);
      const yamlContent = await fsPromises.readFile(filePath, 'utf-8');

      this.yamlValidator.validateAndThrow(yamlContent);

      const definition = this.workflowParser.parseWorkflow(yamlContent);

      if (discoveredSet.has(definition.workflow_id)) {
        throw new ConflictException(
          `Duplicate workflow_id "${definition.workflow_id}" in repository discovery`,
        );
      }
      discoveredSet.add(definition.workflow_id);

      await this.workflowValidator.validateAndThrow(definition);

      const collision =
        await this.repository.findActiveNonRepositoryByIdentifier(
          definition.workflow_id,
        );
      if (collision) {
        throw new ConflictException(
          `Workflow "${definition.workflow_id}" already exists as a ${collision.source_type} workflow`,
        );
      }

      // source_path uses repository-relative POSIX separators, not filesystem separators.
      const sourcePath =
        RepositoryWorkflowDiscoveryService.WORKFLOWS_DIR + '/' + file;
      const sourceHash = createHash('sha256').update(yamlContent).digest('hex');

      const existingRepo = await this.repository.findRepositoryDefinitionByPath(
        scopeId,
        sourcePath,
      );

      if (existingRepo) {
        await this.repository.update(existingRepo.id, {
          name: definition.name,
          yaml_definition: yamlContent,
          is_active: true,
          source_type: 'repository',
          scope_id: scopeId,
          source_path: sourcePath,
          source_ref: sourceRef ?? existingRepo.source_ref,
          source_hash: sourceHash,
        });
      } else {
        const createData: Partial<Workflow> = {
          name: definition.name,
          yaml_definition: yamlContent,
          is_active: true,
          source_type: 'repository',
          scope_id: scopeId,
          source_path: sourcePath,
          source_ref: sourceRef ?? null,
          source_hash: sourceHash,
        };
        await this.repository.create(createData);
      }
      upserted++;
    }

    const discoveredPaths = new Set(
      workflowFiles.map(
        (f) => RepositoryWorkflowDiscoveryService.WORKFLOWS_DIR + '/' + f,
      ),
    );

    const activeRepoWorkflows = await this.repository.findActiveBySourceScope(
      'repository',
      scopeId,
    );

    let disabled = 0;
    const removedIds: string[] = [];
    for (const wf of activeRepoWorkflows) {
      if (!discoveredPaths.has(wf.source_path ?? '')) {
        removedIds.push(wf.id);
        disabled++;
      }
    }
    if (removedIds.length > 0) {
      await this.repository.deactivateByIds(removedIds);
    }

    return { discovered: workflowFiles.length, upserted, disabled };
  }

  private async disableAllRepositoryWorkflows(
    scopeId: string,
  ): Promise<number> {
    const activeRepoWorkflows = await this.repository.findActiveBySourceScope(
      'repository',
      scopeId,
    );

    const ids = activeRepoWorkflows.map((wf) => wf.id);
    await this.repository.deactivateByIds(ids);
    return ids.length;
  }
}

export type {
  RepositoryWorkflowDiscoveryRequest,
  RepositoryWorkflowDiscoveryResult,
};
