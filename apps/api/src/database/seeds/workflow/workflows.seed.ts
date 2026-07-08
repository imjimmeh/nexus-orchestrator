import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Workflow } from '../../../workflow/database/entities/workflow.entity';
import { WorkflowParserService } from '../../../workflow/workflow-parser.service';
import { WorkflowValidationService } from '../../../workflow/workflow-validation.service';
import { DAGResolverService } from '../../../workflow/dag-resolver.service';
import { ToolRegistryRepository } from '../../../tool/database/repositories/tool-registry.repository';
import { ToolRegistry } from '../../../tool/database/entities/tool-registry.entity';
import type { SpecialStepHandlerLookup } from '../../../workflow/workflow-special-steps/step-special-step.types';
import type { ConfigResolutionCache } from '../../../config-resolution/config-resolution-cache.service';

const WORKFLOW_ID_REGEX = /^workflow_id:\s*(\S+)/m;
const WORKFLOW_NAME_REGEX = /^name:\s*(.+)$/m;
const RETIRED_WORKFLOW_IDS = new Set(['project_retrospective_autorun']);

/**
 * Seed workflows from YAML definition files.
 *
 * Loads all .workflow.yaml files from the seeds directory and populates them
 * into the workflows table if they don't already exist (by workflow_id).
 *
 * This is called:
 * - During SetupService.initialize() when first admin completes setup
 * - Or during bootstrap on app startup if needed
 */
@Injectable()
export class WorkflowSeedService {
  private readonly logger = new Logger(WorkflowSeedService.name);

  private readonly candidateSeedDirs = [
    process.env.NEXUS_WORKFLOWS_SEED_PATH?.trim(),
    path.join(process.cwd(), 'seed', 'workflows'),
    path.join(process.cwd(), '..', 'seed', 'workflows'),
    path.join(process.cwd(), '..', '..', 'seed', 'workflows'),
    path.resolve(__dirname, '../../../../../../seed/workflows'),
    path.join(__dirname),
    path.join(process.cwd(), 'src', 'database', 'seeds'),
    path.join(process.cwd(), 'apps', 'api', 'src', 'database', 'seeds'),
  ].filter((dir): dir is string => Boolean(dir));

  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @Optional()
    private readonly workflowParser?: WorkflowParserService,
    @Optional()
    private readonly workflowValidator?: WorkflowValidationService,
    @Optional()
    private readonly configResolutionCache?: ConfigResolutionCache,
  ) {}

  async seed(): Promise<void> {
    try {
      const seedsDir = this.resolveSeedDirectory();
      if (!seedsDir) {
        this.logger.log(
          `No workflow YAML files found. Checked: ${this.candidateSeedDirs.join(', ')}`,
        );
        return;
      }

      const files = this.listWorkflowSeedFiles(seedsDir);
      if (files.length === 0) {
        this.logger.log('No workflow YAML files found in seeds directory');
        return;
      }

      // Scope lookup to platform defaults: seeded rows with no scope override
      const existingWorkflows = await this.workflowRepo.find({
        where: { source: 'seeded', scope_node_id: IsNull() },
      });
      const canonicalByWorkflowId = new Map<string, string>();
      const canonicalByWorkflowName = new Map<string, string>();

      for (const file of files) {
        await this.seedWorkflowFromFile({
          seedsDir,
          file,
          existingWorkflows,
          canonicalByWorkflowId,
          canonicalByWorkflowName,
        });
      }

      await this.deactivateDuplicateWorkflows({
        canonicalByWorkflowId,
        canonicalByWorkflowName,
      });

      this.logger.log(`Completed seeding ${files.length} workflow file(s)`);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to seed workflows: ${err.message}`);
      throw err;
    }
  }

  private resolveSeedDirectory(): string | undefined {
    return this.candidateSeedDirs.find((dir) => {
      if (!fs.existsSync(dir)) {
        return false;
      }

      return this.listWorkflowSeedFiles(dir).length > 0;
    });
  }

  private listWorkflowSeedFiles(directory: string): string[] {
    return fs
      .readdirSync(directory)
      .filter((file) => file.endsWith('.workflow.yaml'));
  }

  private async seedWorkflowFromFile(params: {
    seedsDir: string;
    file: string;
    existingWorkflows: Workflow[];
    canonicalByWorkflowId: Map<string, string>;
    canonicalByWorkflowName: Map<string, string>;
  }): Promise<void> {
    const filePath = path.join(params.seedsDir, params.file);
    const yamlContent = fs.readFileSync(filePath, 'utf-8');

    await this.validateWorkflowSeed(params.file, yamlContent);

    const workflowIdMatch = WORKFLOW_ID_REGEX.exec(yamlContent);
    if (!workflowIdMatch) {
      this.logger.warn(`No workflow_id found in ${params.file}, skipping`);
      return;
    }

    const workflowId = workflowIdMatch[1];
    const nameMatch = WORKFLOW_NAME_REGEX.exec(yamlContent);
    const workflowName = nameMatch ? nameMatch[1].trim() : workflowId;

    const existingById = params.existingWorkflows.find((workflow) => {
      const idMatch = WORKFLOW_ID_REGEX.exec(workflow.yaml_definition);
      return idMatch?.[1] === workflowId;
    });

    const existingByName = existingById
      ? undefined
      : params.existingWorkflows.find(
          (workflow) => workflow.name === workflowName,
        );

    const existingWorkflow = existingById ?? existingByName;

    if (existingWorkflow) {
      await this.updateExistingWorkflowIfNeeded(
        existingWorkflow,
        yamlContent,
        workflowName,
        params.file,
      );

      params.canonicalByWorkflowId.set(workflowId, existingWorkflow.id);
      params.canonicalByWorkflowName.set(workflowName, existingWorkflow.id);
      return;
    }

    const workflow = this.workflowRepo.create({
      name: workflowName,
      yaml_definition: yamlContent,
      is_active: true,
    });

    await this.workflowRepo.save(workflow);
    this.configResolutionCache?.invalidate('workflow', workflowName);
    params.existingWorkflows.push(workflow);
    params.canonicalByWorkflowId.set(workflowId, workflow.id);
    params.canonicalByWorkflowName.set(workflowName, workflow.id);
    this.logger.log(`Seeded workflow "${workflowName}" from ${params.file}`);
  }

  private async validateWorkflowSeed(
    filename: string,
    yamlContent: string,
  ): Promise<void> {
    if (!this.workflowParser || !this.workflowValidator) {
      this.logger.warn(
        `Skipping workflow seed validation for ${filename} because validator dependencies are unavailable`,
      );
      return;
    }

    try {
      const parsed = this.workflowParser.parseWorkflow(yamlContent);
      await this.workflowValidator.validateAndThrow(parsed);
    } catch (error) {
      const message = (error as Error).message;
      throw new Error(`Invalid workflow seed '${filename}': ${message}`, {
        cause: error,
      });
    }
  }

  private async updateExistingWorkflowIfNeeded(
    existingWorkflow: Workflow,
    yamlContent: string,
    workflowName: string,
    file: string,
  ): Promise<void> {
    // Locked guard: an admin has locked this row — do not overwrite
    if (existingWorkflow.locked) {
      this.logger.log(
        `Workflow "${workflowName}" is locked, skipping reseed (${file})`,
      );
      return;
    }

    // Overrides guard: an admin has customised this row — do not overwrite
    if (
      existingWorkflow.overrides !== null &&
      existingWorkflow.overrides !== undefined
    ) {
      this.logger.log(
        `Workflow "${workflowName}" has admin overrides, skipping reseed (${file})`,
      );
      return;
    }

    if (existingWorkflow.yaml_definition !== yamlContent) {
      existingWorkflow.yaml_definition = yamlContent;
      existingWorkflow.is_active = true;
      await this.workflowRepo.save(existingWorkflow);
      this.configResolutionCache?.invalidate('workflow', workflowName);
      this.logger.log(`Updated workflow "${workflowName}" from ${file}`);
      return;
    }

    this.logger.log(
      `Workflow "${workflowName}" already up-to-date (${file}), skipping`,
    );
  }

  private extractWorkflowIdFromYaml(
    yamlDefinition: string,
  ): string | undefined {
    const idMatch = WORKFLOW_ID_REGEX.exec(yamlDefinition);
    if (!idMatch?.[1]) {
      return undefined;
    }

    return idMatch[1].trim();
  }

  private async deactivateDuplicateWorkflows(params: {
    canonicalByWorkflowId: Map<string, string>;
    canonicalByWorkflowName: Map<string, string>;
  }): Promise<void> {
    const allWorkflows = await this.workflowRepo.find();
    const workflowsToDeactivate: Array<{
      workflow: Workflow;
      reason: 'duplicate' | 'retired';
    }> = [];

    for (const workflow of allWorkflows) {
      const workflowId = this.extractWorkflowIdFromYaml(
        workflow.yaml_definition,
      );

      if (workflowId && RETIRED_WORKFLOW_IDS.has(workflowId)) {
        if (workflow.is_active) {
          workflow.is_active = false;
          workflowsToDeactivate.push({ workflow, reason: 'retired' });
        }
        continue;
      }

      const canonicalIdByWorkflowId = workflowId
        ? params.canonicalByWorkflowId.get(workflowId)
        : undefined;

      const canonicalIdByName = params.canonicalByWorkflowName.get(
        workflow.name,
      );
      const canonicalId = canonicalIdByWorkflowId ?? canonicalIdByName;

      if (!canonicalId || canonicalId === workflow.id) {
        continue;
      }

      if (!workflow.is_active) {
        continue;
      }

      workflow.is_active = false;
      workflowsToDeactivate.push({ workflow, reason: 'duplicate' });
    }

    for (const { workflow, reason } of workflowsToDeactivate) {
      await this.workflowRepo.save(workflow);
      this.logger.warn(
        `Deactivated ${reason} workflow row "${workflow.name}" (${workflow.id})`,
      );
    }
  }
}

export async function seedWorkflows(dataSource: DataSource): Promise<void> {
  const toolRegistryRepository = new ToolRegistryRepository(
    dataSource.getRepository(ToolRegistry),
  );
  const specialStepRegistry: SpecialStepHandlerLookup = {
    getHandler: () => null,
  };
  const workflowValidator = new WorkflowValidationService(
    toolRegistryRepository,
    new DAGResolverService(),
    specialStepRegistry,
  );
  const service = new WorkflowSeedService(
    dataSource.getRepository(Workflow),
    new WorkflowParserService(),
    workflowValidator,
  );
  await service.seed();
}
