import { createAgentProfileSchema } from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class WorkflowManagementCapabilityProvider {
  @Capability({
    name: 'create_agent_profile',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    description: 'Create runtime agent profiles with governed tools.',
    mutatingAction: 'create_agent_profile',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/orchestration/create-agent-profile',
      bodyMapping: {
        scope_id: 'scope_id',
        profile_name: 'profile_name',
        system_prompt: 'system_prompt',
        tier_preference: 'tier_preference',
        allowed_tools: 'allowed_tools',
        model_name: 'model_name',
        provider_name: 'provider_name',
        factory_context: 'factory_context',
        reasoning: 'reasoning',
      },
    },
    inputSchema: createAgentProfileSchema,
  })
  createAgentProfile() {
    return { ok: true };
  }
}
