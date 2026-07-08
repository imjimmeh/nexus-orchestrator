import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { DatabaseModule } from '../../database/database.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { WorkflowKernelModule } from '../kernel/workflow-kernel.module';
import { WorkflowLaunchContractService } from './workflow-launch-contract.service';
import { WorkflowLaunchOrchestrationService } from './workflow-launch-orchestration.service';

@Module({
  imports: [
    AuthorizationModule,
    CostGovernanceModule,
    DatabaseModule,
    ObservabilityModule,
    WorkflowKernelModule,
  ],
  providers: [
    WorkflowLaunchContractService,
    WorkflowLaunchOrchestrationService,
  ],
  exports: [WorkflowLaunchContractService, WorkflowLaunchOrchestrationService],
})
export class WorkflowLaunchModule {}
