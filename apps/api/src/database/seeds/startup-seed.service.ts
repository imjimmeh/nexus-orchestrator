import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentSkillAssignmentsSeedService } from './agent/agent-skill-assignments.seed';
import { AgentProfileSeedService } from './agent-profiles';
import { LlmModelSeedService } from './agent/llm-models.seed';
import { LlmProviderSeedService } from './agent/llm-providers.seed';
import { LlmSecretSeedService } from './security/llm-secret.seed';
import { RoleSeedService } from './authorization/roles.seed';
import { seedPermissions } from './authorization/permissions.seed';
import { seedRolePermissions } from './authorization/role-permissions.seed';
import { SkillSeedService } from './skills.seed';
import { SetupConfigSeedService } from './system/setup-config.seed';
import { ToolApprovalRulesSeedService } from './tool/tool-approval-rules.seed';
import { WorkflowSeedService } from './workflow/workflows.seed';
import { ScopedVariableSeedService } from './variables/scoped-variables.seed';
import { FallbackChainSeedService } from './config/fallback-chains.seed';
import { WorkflowRepository } from '../../workflow/database/repositories/workflow.repository';
import { ScheduledJobRepository } from '../../automation/database/repositories/scheduled-job.repository';
import {
  ScheduledJobScope,
  ScheduledJobStatus,
  ScheduledJobTargetType,
  ScheduledJobType,
} from '@nexus/core';
import { parseExpression } from 'cron-parser';

@Injectable()
export class StartupSeedService {
  private readonly logger = new Logger(StartupSeedService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly roleSeedService: RoleSeedService,
    private readonly setupConfigSeedService: SetupConfigSeedService,
    private readonly llmSecretSeedService: LlmSecretSeedService,
    private readonly llmProviderSeedService: LlmProviderSeedService,
    private readonly llmModelSeedService: LlmModelSeedService,
    private readonly skillSeedService: SkillSeedService,
    private readonly agentProfileSeedService: AgentProfileSeedService,
    private readonly agentSkillAssignmentsSeedService: AgentSkillAssignmentsSeedService,
    private readonly toolApprovalRulesSeedService: ToolApprovalRulesSeedService,
    private readonly scopedVariableSeedService: ScopedVariableSeedService,
    private readonly workflowSeedService: WorkflowSeedService,
    private readonly workflowRepo: WorkflowRepository,
    private readonly scheduledJobRepo: ScheduledJobRepository,
    private readonly fallbackChainSeedService: FallbackChainSeedService,
  ) {}

  async seedOnStartup(): Promise<void> {
    this.logger.debug('StartupSeedService: seeding roles...');
    await this.roleSeedService.seed();
    this.logger.debug('StartupSeedService: seeding permissions...');
    await seedPermissions(this.dataSource);
    this.logger.debug(
      'StartupSeedService: seeding role-permission mappings...',
    );
    await seedRolePermissions(this.dataSource);
    this.logger.debug('StartupSeedService: seeding setup config...');
    await this.setupConfigSeedService.seed();

    this.logger.debug('StartupSeedService: seeding LLM secrets...');
    const secretId = await this.llmSecretSeedService.seed();
    this.logger.debug('StartupSeedService: seeding LLM providers...');
    await this.llmProviderSeedService.seed({ secretId });
    this.logger.debug('StartupSeedService: seeding LLM models...');
    await this.llmModelSeedService.seed();
    this.logger.debug('StartupSeedService: seeding fallback chains...');
    await this.fallbackChainSeedService.seed();

    this.logger.debug('StartupSeedService: seeding skills (sync)...');
    this.skillSeedService.seed();
    this.logger.debug('StartupSeedService: seeding agent profiles...');
    await this.agentProfileSeedService.seed();
    this.logger.debug('StartupSeedService: seeding agent skill assignments...');
    await this.agentSkillAssignmentsSeedService.seed();
    this.logger.debug('StartupSeedService: seeding tool approval rules...');
    await this.toolApprovalRulesSeedService.seed();
    // Seed global default variables (orchestration policy defaults) before
    // workflows. These back the CEO cycle's vars.* (gates.*, backlog.*,
    // autonomy.*); without them the gate/promotion conditions render undefined
    // and silently never fire. Idempotent: existing rows are never overwritten.
    this.logger.debug(
      'StartupSeedService: seeding global default variables...',
    );
    await this.scopedVariableSeedService.seed();
    this.logger.debug('StartupSeedService: seeding workflows...');
    await this.workflowSeedService.seed();

    this.logger.debug('StartupSeedService: seeding scheduled jobs...');
    await this.seedScheduledJobs();

    this.logger.debug('StartupSeedService: seeding complete.');
  }

  private async seedScheduledJobs(): Promise<void> {
    try {
      const sweepWorkflow = await this.workflowRepo.findByIdentifier(
        'memory_learning_sweep',
      );
      if (!sweepWorkflow) {
        this.logger.warn(
          'Workflow "memory_learning_sweep" not found in DB. Skipping scheduled job creation.',
        );
        return;
      }

      // Check if scheduled job already exists for this workflow
      const { data: existingJobs } = await this.scheduledJobRepo.findAll(
        { scope: ScheduledJobScope.GLOBAL },
        { limit: 100, offset: 0 },
      );

      const hasSweepJob = existingJobs.some(
        (job) =>
          job.execution_target_type === ScheduledJobTargetType.WORKFLOW &&
          job.execution_target_ref === sweepWorkflow.id,
      );

      if (hasSweepJob) {
        this.logger.debug(
          'Scheduled job for "memory_learning_sweep" already exists, skipping.',
        );
        return;
      }

      // Parse expression to calculate next_run_at
      const cronExpression = '0 2 * * *'; // Run at 2:00 AM every night
      const cron = parseExpression(cronExpression, {
        currentDate: new Date(),
        tz: 'UTC',
      });
      const nextRunAt = cron.next().toDate();

      await this.scheduledJobRepo.create({
        schedule_scope: ScheduledJobScope.GLOBAL,
        scopeId: null,
        name: 'Nightly Memory Learning Sweep',
        status: ScheduledJobStatus.ACTIVE,
        schedule_type: ScheduledJobType.CRON,
        schedule_expression: cronExpression,
        timezone: 'UTC',
        next_run_at: nextRunAt,
        execution_target_type: ScheduledJobTargetType.WORKFLOW,
        execution_target_ref: sweepWorkflow.id,
        payload_json: {},
        created_by: 'system',
        updated_by: 'system',
        paused_at: null,
      });

      this.logger.log(
        'Successfully seeded nightly scheduled job for "memory_learning_sweep".',
      );
    } catch (error) {
      this.logger.error(
        `Failed to seed scheduled job for memory_learning_sweep: ${(error as Error).message}`,
      );
    }
  }
}
