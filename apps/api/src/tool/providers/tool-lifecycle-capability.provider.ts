import {
  createToolCandidateInputSchema,
  publishToolCandidateInputSchema,
  upsertToolInputSchema,
  validateToolCandidateInputSchema,
} from '@nexus/core';
import { Capability } from '../capability.decorator';

export class ToolLifecycleCapabilityProvider {
  @Capability({
    name: 'create_tool_candidate',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'create_tool_candidate',
    description: 'Create a draft tool candidate for sandbox validation.',
    inputSchema: createToolCandidateInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/tools/candidates',
      bodyMapping: {
        tool_name: 'tool_name',
        language: 'language',
        source_code: 'source_code',
        schema: 'schema',
        test_spec: 'test_spec',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  createToolCandidate() {
    return { ok: true };
  }

  @Capability({
    name: 'validate_tool_candidate',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'validate_tool_candidate',
    description: 'Run sandbox validation for a tool candidate artifact.',
    inputSchema: validateToolCandidateInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate:
        '/api/workflow-runtime/tools/candidates/{artifact_id}/validate',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  validateToolCandidate() {
    return { ok: true };
  }

  @Capability({
    name: 'publish_tool_candidate',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    mutatingAction: 'publish_tool_candidate',
    description: 'Publish a validated tool candidate as callable capability.',
    inputSchema: publishToolCandidateInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate:
        '/api/workflow-runtime/tools/candidates/{artifact_id}/publish',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  publishToolCandidate() {
    return { ok: true };
  }

  @Capability({
    name: 'upsert_tool',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'upsert_tool',
    description: 'Request upsert for a tool registry entry.',
    inputSchema: upsertToolInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/tools/upsert',
      bodyMapping: {
        name: 'name',
        schema: 'schema',
        typescript_code: 'typescript_code',
        tier_restriction: 'tier_restriction',
        language: 'language',
        publication_status: 'publication_status',
        published_artifact_id: 'published_artifact_id',
        published_version: 'published_version',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  upsertTool() {
    return { ok: true };
  }
}
