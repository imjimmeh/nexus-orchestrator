import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ScopeModule } from '../scope/scope.module';
import { PolicyEngineService } from './policy-engine.service';
import { ApprovalsCapabilityProvider } from './providers/approvals-capability.provider';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import { ToolApprovalRulesController } from './tool-approval-rules.controller';
import { ToolCallApprovalRequestService } from './tool-call-approval-request.service';
import { ToolCallApprovalRequestsController } from './tool-call-approval-requests.controller';
import { ToolPolicyDecisionService } from './tool-policy-decision.service';
import { ToolPolicyEvaluatorService } from './tool-policy-evaluator.service';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule, ScopeModule],
  controllers: [
    ToolApprovalRulesController,
    ToolCallApprovalRequestsController,
  ],
  providers: [
    PolicyEngineService,
    ToolPolicyDecisionService,
    ToolPolicyEvaluatorService,
    ToolApprovalRuleService,
    ToolCallApprovalRequestService,
    ApprovalsCapabilityProvider,
  ],
  exports: [
    PolicyEngineService,
    ToolPolicyDecisionService,
    ToolPolicyEvaluatorService,
    ToolApprovalRuleService,
    ToolCallApprovalRequestService,
  ],
})
export class CapabilityGovernanceModule {}
