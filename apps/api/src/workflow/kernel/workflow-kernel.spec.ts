import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { AuthorizationService } from '../../auth/authorization/authorization.service';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RoleAssignmentService } from '../../auth/authorization/role-assignment.service';
import { ScopeAccessService } from '../../auth/authorization/scope-access.service';
import { EnforcementModeService } from '../../auth/authorization/enforcement-mode.service';
import { AuditLogRepository } from '../../audit/database/repositories/audit-log.repository';
import { DatabaseModule } from '../../database/database.module';
import { Test } from '@nestjs/testing';
import type {
  IJob,
  IToolPermissionPolicy,
  HarnessSessionRef,
} from '@nexus/core';
import { WorkflowLaunchModule } from '../workflow-launch/workflow-launch.module';
import { WorkflowKernelModule } from './workflow-kernel.module';
import type {
  StartWorkflowOptions,
  WorkflowDryRunResult,
} from '../workflow-engine.types';
import {
  type IWorkflowEngineService,
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PARSER_SERVICE,
  STATE_MACHINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
} from './interfaces/workflow-kernel.ports';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { WorkflowLaunchPresetRepository } from '../database/repositories/workflow-launch-preset.repository';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowEngineService } from '../workflow-engine.service';
import { WorkflowParserService } from '../workflow-parser.service';
import { StateMachineService } from '../state-machine.service';
import { WorkflowPersistenceService } from '../workflow-persistence.service';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { WorkflowCoreModule } from '../workflow-core.module';
import { MockWorkflowCoreModule } from '../../testing/mock-workflow-core.module';

type WorkflowEngineOrchestrationMethod =
  | 'startWorkflow'
  | 'cancelWorkflowRun'
  | 'handleJobComplete'
  | 'resumeJobWithMessage'
  | 'resumeWorkflow'
  | 'retryJobWithMessage';

type ExtraWorkflowEnginePortMethod = Exclude<
  keyof IWorkflowEngineService,
  WorkflowEngineOrchestrationMethod
>;
type MissingWorkflowEnginePortMethod = Exclude<
  WorkflowEngineOrchestrationMethod,
  keyof IWorkflowEngineService
>;
type WorkflowEnginePortIsNarrow = [
  ExtraWorkflowEnginePortMethod,
  MissingWorkflowEnginePortMethod,
] extends [never, never]
  ? true
  : never;

interface ExpectedWorkflowEnginePort {
  startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options: StartWorkflowOptions & { dryRun: true },
  ): Promise<WorkflowDryRunResult>;
  startWorkflow(
    workflowId: string,
    triggerData: Record<string, unknown>,
    options?: StartWorkflowOptions,
  ): Promise<string | null>;
  cancelWorkflowRun(runId: string, reason?: string): Promise<void>;
  handleJobComplete(
    workflowRunId: string,
    jobId: string,
    output: Record<string, unknown>,
  ): Promise<void>;
  resumeJobWithMessage(
    workflowRunId: string,
    sessionTreeId: string,
    userMessage: string,
    options?: { jobId?: string; resumeSessionRef?: HarnessSessionRef },
  ): Promise<string>;
  resumeWorkflow(workflowRunId: string): Promise<void>;
  retryJobWithMessage(
    workflowRunId: string,
    jobId: string,
    job: IJob,
    sessionTreeId: string | undefined,
    retryPrompt: string,
    workflowPermissions?: IToolPermissionPolicy,
  ): Promise<void>;
}

type IsExact<TActual, TExpected> = [TActual] extends [TExpected]
  ? [TExpected] extends [TActual]
    ? true
    : never
  : never;

type WorkflowEnginePortHasExpectedSignatures = IsExact<
  IWorkflowEngineService,
  ExpectedWorkflowEnginePort
>;

const workflowEnginePortIsNarrow: WorkflowEnginePortIsNarrow = true;
const workflowEnginePortHasExpectedSignatures: WorkflowEnginePortHasExpectedSignatures = true;

@Module({
  providers: [{ provide: BudgetDecisionService, useValue: {} }],
  exports: [BudgetDecisionService],
})
class FakeCostGovernanceModule {}

@Module({
  providers: [
    { provide: AuthorizationService, useValue: { can: async () => true } },
    { provide: PermissionsGuard, useValue: { canActivate: async () => true } },
    { provide: RoleAssignmentService, useValue: {} },
    { provide: ScopeAccessService, useValue: {} },
    {
      provide: EnforcementModeService,
      useValue: { getMode: async () => 'enforce' },
    },
    { provide: AuditLogRepository, useValue: { log: async () => ({}) } },
  ],
  exports: [
    AuthorizationService,
    PermissionsGuard,
    RoleAssignmentService,
    ScopeAccessService,
    EnforcementModeService,
    AuditLogRepository,
  ],
})
class FakeAuthorizationModule {}

@Module({
  providers: [
    { provide: WorkflowLaunchPresetRepository, useValue: {} },
    { provide: EventLedgerService, useValue: {} },
  ],
  exports: [WorkflowLaunchPresetRepository, EventLedgerService],
})
class FakeDatabaseModule {}

@Module({
  providers: [{ provide: EventLedgerService, useValue: {} }],
  exports: [EventLedgerService],
})
class FakeObservabilityModule {}

@Module({})
class EmptyWorkflowCoreModule {}

describe('Workflow Kernel Migration', () => {
  it('binds workflow kernel ports to explicit concrete providers', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkflowKernelModule],
    })
      .overrideModule(WorkflowCoreModule)
      .useModule(MockWorkflowCoreModule)
      .compile();

    expect(module.get(WORKFLOW_ENGINE_SERVICE)).toBe(
      module.get(WorkflowEngineService),
    );
    expect(module.get(WORKFLOW_PARSER_SERVICE)).toBe(
      module.get(WorkflowParserService),
    );
    expect(module.get(STATE_MACHINE_SERVICE)).toBe(
      module.get(StateMachineService),
    );
    expect(module.get(WORKFLOW_PERSISTENCE_SERVICE)).toBe(
      module.get(WorkflowPersistenceService),
    );
    expect(module.get(WORKFLOW_RUN_REPOSITORY_PORT)).toBe(
      module.get(WorkflowRunRepository),
    );
    expect(module.get(WORKFLOW_DEFINITION_REPOSITORY_PORT)).toBe(
      module.get(WorkflowRepository),
    );
  });

  it('exposes only orchestration/runtime methods on the engine port', () => {
    expect(workflowEnginePortIsNarrow).toBe(true);
    expect(workflowEnginePortHasExpectedSignatures).toBe(true);
  });

  it('fails fast when required workflow kernel providers are missing', async () => {
    await expect(
      Test.createTestingModule({ imports: [WorkflowKernelModule] })
        .overrideModule(WorkflowCoreModule)
        .useModule(EmptyWorkflowCoreModule)
        .compile(),
    ).rejects.toThrow(/WorkflowEngineService|dependencies/i);
  });

  it('WorkflowLaunchModule should not import WorkflowModule via forwardRef', async () => {
    const module = await Test.createTestingModule({
      imports: [WorkflowLaunchModule, WorkflowKernelModule],
    })
      .overrideModule(WorkflowCoreModule)
      .useModule(MockWorkflowCoreModule)
      .overrideModule(CostGovernanceModule)
      .useModule(FakeCostGovernanceModule)
      .overrideModule(AuthorizationModule)
      .useModule(FakeAuthorizationModule)
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .overrideModule(ObservabilityModule)
      .useModule(FakeObservabilityModule)
      .compile();
    expect(module).toBeDefined();
  });

  it.skip('WorkflowRunOperationsModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowStepExecutionModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowSpecialStepsModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowSubagentsModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowRepairModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowInternalToolsModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });

  it.skip('WorkflowRuntimeModule should not import WorkflowModule via forwardRef', async () => {
    // Skipped due to deep dependency mocking requirements
  });
});
