import { submitResourceArtifactInputSchema } from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class ApprovalsCapabilityProvider {
  @Capability({
    name: 'submit_resource_artifact',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    description: 'Submit a resource artifact resolution state.',
    inputSchema: submitResourceArtifactInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/projects/{scope_id}/resources/{context_id}/artifact',
      bodyMapping: {
        status: 'status',
        feedback: 'feedback',
      },
    },
  })
  submitResourceArtifact() {
    return { ok: true };
  }
}
