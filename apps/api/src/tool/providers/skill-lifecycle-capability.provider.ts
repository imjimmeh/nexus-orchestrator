import {
  addProfileSkillsInputSchema,
  createSkillInputSchema,
  deleteSkillFileInputSchema,
  listSkillFilesInputSchema,
  removeProfileSkillsInputSchema,
  replaceProfileSkillsInputSchema,
  saveScriptAsSkillInputSchema,
  updateSkillInputSchema,
  upsertSkillFileInputSchema,
} from '@nexus/core';
import { Capability } from '../capability.decorator';

export class SkillLifecycleCapabilityProvider {
  @Capability({
    name: 'create_skill',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'create_skill',
    description: 'Create a new skill from markdown frontmatter content.',
    inputSchema: createSkillInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/skills',
      bodyMapping: {
        name: 'name',
        description: 'description',
        skill_markdown: 'skill_markdown',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  createSkill() {
    return { ok: true };
  }

  @Capability({
    name: 'update_skill',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'update_skill',
    description: 'Update an existing skill markdown and optional metadata.',
    inputSchema: updateSkillInputSchema,
    apiCallback: {
      method: 'PATCH',
      pathTemplate: '/api/workflow-runtime/skills/{skill_id}',
      bodyMapping: {
        name: 'name',
        skill_markdown: 'skill_markdown',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  updateSkill() {
    return { ok: true };
  }

  @Capability({
    name: 'list_skill_files',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only', 'context'],
    description: 'List files available under a specific skill directory.',
    inputSchema: listSkillFilesInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/skills/{skill_id}/files/list',
      bodyMapping: {
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  listSkillFiles() {
    return { ok: true };
  }

  @Capability({
    name: 'upsert_skill_file',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'upsert_skill_file',
    description: 'Create or overwrite a file within a skill directory.',
    inputSchema: upsertSkillFileInputSchema,
    apiCallback: {
      method: 'PUT',
      pathTemplate: '/api/workflow-runtime/skills/{skill_id}/files',
      bodyMapping: {
        relative_path: 'relative_path',
        content: 'content',
        content_base64: 'content_base64',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  upsertSkillFile() {
    return { ok: true };
  }

  @Capability({
    name: 'delete_skill_file',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'delete_skill_file',
    description: 'Delete a file from a skill directory.',
    inputSchema: deleteSkillFileInputSchema,
    apiCallback: {
      method: 'DELETE',
      pathTemplate: '/api/workflow-runtime/skills/{skill_id}/files',
      bodyMapping: {
        relative_path: 'relative_path',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  deleteSkillFile() {
    return { ok: true };
  }

  @Capability({
    name: 'replace_profile_skills',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    mutatingAction: 'replace_profile_skills',
    description: 'Replace the complete assigned skill list for a profile.',
    inputSchema: replaceProfileSkillsInputSchema,
    apiCallback: {
      method: 'PUT',
      pathTemplate: '/api/workflow-runtime/profiles/{profile_id}/skills',
      bodyMapping: {
        skill_ids: 'skill_ids',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  replaceProfileSkills() {
    return { ok: true };
  }

  @Capability({
    name: 'add_profile_skills',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    mutatingAction: 'add_profile_skills',
    description:
      'Add one or more skills to a profile without replacing existing assignments.',
    inputSchema: addProfileSkillsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/profiles/{profile_id}/skills/add',
      bodyMapping: {
        skill_ids: 'skill_ids',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  addProfileSkills() {
    return { ok: true };
  }

  @Capability({
    name: 'remove_profile_skills',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating', 'approval_gated'],
    mutatingAction: 'remove_profile_skills',
    description: 'Remove one or more skills from a profile assignment set.',
    inputSchema: removeProfileSkillsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/profiles/{profile_id}/skills/remove',
      bodyMapping: {
        skill_ids: 'skill_ids',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  removeProfileSkills() {
    return { ok: true };
  }

  @Capability({
    name: 'save_script_as_skill',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    mutatingAction: 'save_script_as_skill',
    description:
      'Create or update a skill, persist script content as a skill file, and optionally assign the skill to a profile.',
    inputSchema: saveScriptAsSkillInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/skills/save-script',
      bodyMapping: {
        name: 'name',
        description: 'description',
        script_content: 'script_content',
        relative_path: 'relative_path',
        profile_id: 'profile_id',
        overwrite_existing: 'overwrite_existing',
        workflow_run_id: 'workflow_run_id',
        job_id: 'job_id',
      },
    },
  })
  saveScriptAsSkill() {
    return { ok: true };
  }
}
