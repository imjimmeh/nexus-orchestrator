import {
  listPathBodySchema,
  updateOrchestrationStateBodySchema,
  yieldSessionBodySchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

export class OrchestrationSessionCapabilityProvider {
  @Capability({
    name: 'yield_session',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description:
      'Atomically finalize an orchestration session, persist outcome, and release session lock.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/yield-session',
      bodyMapping: {
        scope_id: 'scope_id',
        workflow_run_id: 'workflow_run_id',
        active_playbook: 'active_playbook',
        status: 'status',
        summary: 'summary',
        recommended_next_playbook: 'recommended_next_playbook',
        notes: 'notes',
      },
    },
    inputSchema: yieldSessionBodySchema,
  })
  yieldSession() {
    return { ok: true };
  }

  @Capability({
    name: 'list_path',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description:
      'List project directory entries for imported-repository bootstrap and investigation sessions.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/list-path',
      bodyMapping: {
        scope_id: 'scope_id',
        relative_path: 'relative_path',
      },
    },
    inputSchema: listPathBodySchema,
  })
  listPath() {
    return { ok: true };
  }

  @Capability({
    name: 'update_orchestration_state',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'state'],
    description:
      'Patch persistent orchestration session state using partial update semantics.',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/update-orchestration-state',
      bodyMapping: {
        scope_id: 'scope_id',
        patch: 'patch',
      },
    },
    inputSchema: updateOrchestrationStateBodySchema,
  })
  updateOrchestrationState() {
    return { ok: true };
  }
}
