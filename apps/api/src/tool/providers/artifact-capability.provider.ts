import {
  createArtifactInputSchema,
  deleteArtifactFileInputSchema,
  listArtifactFilesInputSchema,
  listArtifactsInputSchema,
  saveScriptAsArtifactInputSchema,
  upsertArtifactFileInputSchema,
} from '@nexus/core';
import { Capability } from '../capability.decorator';

export class ArtifactCapabilityProvider {
  @Capability({
    name: 'create_artifact',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'create_artifact',
    description: 'Create an artifact in the global artifact library.',
    inputSchema: createArtifactInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/artifacts',
      bodyMapping: {
        artifact_id: 'artifact_id',
        name: 'name',
        description: 'description',
        scope: 'scope',
        owner_profile: 'owner_profile',
        metadata: 'metadata',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  createArtifact() {
    return { ok: true };
  }

  @Capability({
    name: 'list_artifacts',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description: 'List artifacts from the global artifact library.',
    inputSchema: listArtifactsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/artifacts/list',
      bodyMapping: {
        query: 'query',
        scope: 'scope',
        owner_profile: 'owner_profile',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  listArtifacts() {
    return { ok: true };
  }

  @Capability({
    name: 'list_artifact_files',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description: 'List files under a global artifact entry.',
    inputSchema: listArtifactFilesInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/artifacts/{artifact_id}/files/list',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  listArtifactFiles() {
    return { ok: true };
  }

  @Capability({
    name: 'upsert_artifact_file',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'upsert_artifact_file',
    description: 'Create or update a file under a global artifact entry.',
    inputSchema: upsertArtifactFileInputSchema,
    apiCallback: {
      method: 'PUT',
      pathTemplate: '/api/workflow-runtime/artifacts/{artifact_id}/files',
      bodyMapping: {
        relative_path: 'relative_path',
        content: 'content',
        content_base64: 'content_base64',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  upsertArtifactFile() {
    return { ok: true };
  }

  @Capability({
    name: 'delete_artifact_file',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'delete_artifact_file',
    description: 'Delete a file from a global artifact entry.',
    inputSchema: deleteArtifactFileInputSchema,
    apiCallback: {
      method: 'DELETE',
      pathTemplate: '/api/workflow-runtime/artifacts/{artifact_id}/files',
      bodyMapping: {
        relative_path: 'relative_path',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  deleteArtifactFile() {
    return { ok: true };
  }

  @Capability({
    name: 'save_script_as_artifact',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'save_script_as_artifact',
    description:
      'Persist a script to the global artifact library with artifact metadata upsert.',
    inputSchema: saveScriptAsArtifactInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/artifacts/save-script',
      bodyMapping: {
        artifact_id: 'artifact_id',
        name: 'name',
        description: 'description',
        script_content: 'script_content',
        relative_path: 'relative_path',
        scope: 'scope',
        owner_profile: 'owner_profile',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  saveScriptAsArtifact() {
    return { ok: true };
  }
}
