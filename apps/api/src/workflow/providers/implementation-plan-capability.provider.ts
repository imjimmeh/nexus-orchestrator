import { submitImplementationPlanInputSchema } from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class ImplementationPlanCapabilityProvider {
  @Capability({
    name: 'submit_implementation_plan',
    tierRestriction: 2,
    transport: 'mounted_tool',
    runtimeOwner: 'api',
    policyTags: ['context'],
    description:
      'Capture implementation plan output during planning steps for downstream state.',
    inputSchema: submitImplementationPlanInputSchema,
  })
  submitImplementationPlan() {
    return { ok: true };
  }
}
