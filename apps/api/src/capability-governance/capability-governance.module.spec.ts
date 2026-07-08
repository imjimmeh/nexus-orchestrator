import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CapabilityGovernanceModule } from './capability-governance.module';
import { PolicyEngineService } from './policy-engine.service';
import { ApprovalsCapabilityProvider } from './providers/approvals-capability.provider';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import { ToolApprovalRulesController } from './tool-approval-rules.controller';
import { ToolCallApprovalRequestService } from './tool-call-approval-request.service';
import { ToolCallApprovalRequestsController } from './tool-call-approval-requests.controller';
import { ToolPolicyDecisionService } from './tool-policy-decision.service';
import { ToolPolicyEvaluatorService } from './tool-policy-evaluator.service';

const GOVERNANCE_PROVIDERS = [
  ToolApprovalRuleService,
  ToolCallApprovalRequestService,
  ToolPolicyDecisionService,
  ToolPolicyEvaluatorService,
  PolicyEngineService,
  ApprovalsCapabilityProvider,
];

const EXPORTED_GOVERNANCE_PROVIDERS = [
  ToolApprovalRuleService,
  ToolCallApprovalRequestService,
  ToolPolicyDecisionService,
  ToolPolicyEvaluatorService,
  PolicyEngineService,
];

describe('CapabilityGovernanceModule', () => {
  it('owns approval controllers and governance services', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      CapabilityGovernanceModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CapabilityGovernanceModule,
    ) as unknown[];
    const exportsMetadata = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CapabilityGovernanceModule,
    ) as unknown[];

    expect(controllers).toEqual(
      expect.arrayContaining([
        ToolApprovalRulesController,
        ToolCallApprovalRequestsController,
      ]),
    );
    expect(controllers).toHaveLength(2);
    expect(providers).toEqual(expect.arrayContaining(GOVERNANCE_PROVIDERS));
    expect(exportsMetadata).toEqual(
      expect.arrayContaining(EXPORTED_GOVERNANCE_PROVIDERS),
    );
    expect(exportsMetadata).not.toContain(ApprovalsCapabilityProvider);
  });
});
