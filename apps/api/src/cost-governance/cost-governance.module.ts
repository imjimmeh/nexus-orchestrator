import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { CostGovernanceController } from './cost-governance.controller';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetDecisionService } from './budget-decision.service';
import { CostEstimatorService } from './cost-estimator.service';
import { TurnUsageRecorderService } from './turn-usage-recorder.service';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule],
  providers: [
    BudgetPolicyService,
    BudgetDecisionService,
    CostEstimatorService,
    TurnUsageRecorderService,
  ],
  controllers: [CostGovernanceController],
  // `BudgetPolicyService` is exported so that downstream modules
  // (e.g. `BuiltInMemoryContextProvidersModule` for its
  // `BudgetContextProvider`) can inject the policy store. The previous
  // exports list intentionally hid it because no in-tree consumer
  // existed; the EPIC-202 self-improvement loop introduces one.
  // `TurnUsageRecorderService` is exported for cost-governance consumers
  // (e.g. telemetry turn-usage helpers) added in the unified cost
  // governance work on main.
  exports: [
    BudgetPolicyService,
    BudgetDecisionService,
    CostEstimatorService,
    TurnUsageRecorderService,
  ],
})
export class CostGovernanceModule {}
