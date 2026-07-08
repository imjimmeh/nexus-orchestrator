import {
  getCapabilitiesSchema,
  getAgentProfilesSchema,
  getAgentProfileSchema,
  listAgentProfileNamesSchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class WorkflowContextCapabilityProvider {
  // --- Runtime Context & Memory ---

  @Capability({
    name: 'get_capabilities',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'diagnostic'],
    description:
      'Discover callable and denied capabilities for the current execution context.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/get-capabilities',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
    inputSchema: getCapabilitiesSchema,
  })
  getCapabilities() {
    return { ok: true };
  }

  @Capability({
    name: 'get_agent_profiles',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description:
      'List active agent profiles and their delegation-relevant metadata.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/get-agent-profiles',
      bodyMapping: {
        include_inactive: 'include_inactive',
      },
    },
    inputSchema: getAgentProfilesSchema,
  })
  getAgentProfiles() {
    return { ok: true };
  }

  @Capability({
    name: 'get_agent_profile',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description:
      'Fetch one active agent profile by name with delegation-relevant fields.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/get-agent-profile',
      bodyMapping: {
        name: 'name',
      },
    },
    inputSchema: getAgentProfileSchema,
  })
  getAgentProfile() {
    return { ok: true };
  }

  @Capability({
    name: 'list_agent_profile_names',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description:
      'List active agent profile names without full profile payloads.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/list-agent-profile-names',
    },
    inputSchema: listAgentProfileNamesSchema,
  })
  listAgentProfileNames() {
    return { ok: true };
  }
}
