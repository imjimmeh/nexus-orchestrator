import { z } from 'zod';
import { Capability } from '../../capability-infra/capability.decorator';

export const stepCompleteInputSchema = z
  .object({
    summary: z.string().trim().min(1).optional(),
    reasoning: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
  })
  .strict();

export class WorkflowCompletionCapabilityProvider {
  @Capability({
    name: 'step_complete',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description: 'Signal that the current agent step has completed.',
    inputSchema: stepCompleteInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/step-complete',
      bodyMapping: {
        summary: 'summary',
        reasoning: 'reasoning',
        status: 'status',
      },
    },
  })
  stepComplete() {
    return { ok: true };
  }
}
