import { BadRequestException, Injectable } from '@nestjs/common';
import { ArtifactLibraryService } from '../../ai-config/services/artifact-library.service';
import { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import { ImprovementProposalService } from '../../improvement/improvement-proposal.service';
import { ToolCandidateService } from '../../tool-runtime/tool-candidate.service';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import type {
  AddProfileSkillsParams,
  ArtifactIdParams,
  CreateArtifactParams,
  CreateSkillParams,
  CreateToolCandidateParams,
  DeleteArtifactFileParams,
  DeleteSkillFileParams,
  ListArtifactsParams,
  RemoveProfileSkillsParams,
  ReplaceProfileSkillsParams,
  SaveScriptAsArtifactParams,
  SkillIdParams,
  SaveScriptAsSkillParams,
  ToolArtifactParams,
  UpdateSkillParams,
  UpsertArtifactFileParams,
  UpsertSkillFileParams,
  UpsertToolParams,
} from './workflow-runtime-capability-lifecycle.types';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import {
  buildCreateArtifactAction,
  buildDeleteArtifactFileAction,
  buildListArtifactFilesAction,
  buildListArtifactsAction,
  buildSaveScriptAsArtifactAction,
  buildSkillAssignmentProposalDraft,
  buildUpsertArtifactFileAction,
  buildSkillMarkdown,
  executeLifecycleCapabilityAction,
  resolveScriptRelativePath,
  upsertSkillFromScript,
} from './workflow-runtime-capability-lifecycle-action.helpers';

@Injectable()
export class WorkflowRuntimeCapabilityLifecycleService {
  constructor(
    private readonly toolCandidates: ToolCandidateService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly agentSkills: AgentSkillsService,
    private readonly artifacts: ArtifactLibraryService,
    private readonly capabilityExecutor: WorkflowRuntimeCapabilityExecutorService,
    private readonly improvementProposals: ImprovementProposalService,
  ) {}

  async createToolCandidate(
    params: CreateToolCandidateParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'create_tool_candidate',
      context: params,
      payload: { tool_name: params.tool_name },
      execute: () =>
        this.toolCandidates.createDraft({
          tool_name: params.tool_name,
          language: params.language,
          source_code: params.source_code,
          schema: params.schema,
          test_spec: params.test_spec,
        }),
    });
  }

  async validateToolCandidate(
    params: ToolArtifactParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'validate_tool_candidate',
      context: params,
      payload: { artifact_id: params.artifact_id },
      execute: () => this.toolCandidates.validateCandidate(params.artifact_id),
    });
  }

  async publishToolCandidate(
    params: ToolArtifactParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'publish_tool_candidate',
      context: params,
      payload: { artifact_id: params.artifact_id },
      execute: () => this.toolCandidates.publishCandidate(params.artifact_id),
    });
  }

  async upsertTool(params: UpsertToolParams): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'upsert_tool',
      context: params,
      payload: { name: params.name },
      execute: () =>
        this.toolRegistry.upsertTool({
          name: params.name,
          schema: params.schema,
          typescript_code: params.typescript_code,
          tier_restriction: params.tier_restriction,
          language: params.language,
          publication_status: params.publication_status,
          published_artifact_id: params.published_artifact_id,
          published_version: params.published_version,
        }),
    });
  }

  async createSkill(
    params: CreateSkillParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'create_skill',
      context: params,
      payload: { name: params.name },
      execute: async () => {
        const skill = this.agentSkills.createSkill({
          name: params.name,
          description: params.description,
          skill_markdown: params.skill_markdown,
        });

        const callerProfileName = params.user?.agentProfileName?.trim();
        if (!callerProfileName) {
          return {
            skill,
            assignment_proposal: null,
          };
        }

        // Governed reroute: self-assignment is no longer applied directly —
        // it is filed as a `skill_assignment` improvement proposal so
        // `ImprovementGovernancePolicy` decides auto-apply vs propose, the
        // same path `suggest_skill_assignment` uses.
        const submission = await this.improvementProposals.submitProposal(
          buildSkillAssignmentProposalDraft({
            skillName: skill.name,
            profileName: callerProfileName,
          }),
        );

        return {
          skill,
          assignment_proposal: {
            profile_name: callerProfileName,
            outcome: submission.outcome,
            proposal_id: submission.proposal?.id ?? null,
          },
        };
      },
    });
  }

  async updateSkill(
    params: UpdateSkillParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'update_skill',
      context: params,
      payload: {
        skill_id: params.skill_id,
        name: params.name,
      },
      execute: () =>
        this.agentSkills.updateSkill(params.skill_id, {
          name: params.name,
          skill_markdown: params.skill_markdown,
        }),
    });
  }

  async listSkillFiles(
    params: SkillIdParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'list_skill_files',
      context: params,
      payload: { skill_id: params.skill_id },
      execute: () => this.agentSkills.listSkillFiles(params.skill_id),
    });
  }

  async upsertSkillFile(
    params: UpsertSkillFileParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'upsert_skill_file',
      context: params,
      payload: {
        skill_id: params.skill_id,
        relative_path: params.relative_path,
      },
      execute: () =>
        this.agentSkills.upsertSkillFile({
          skillId: params.skill_id,
          relativePath: params.relative_path,
          content: params.content ?? '',
          contentBase64: params.content_base64,
        }),
    });
  }

  async deleteSkillFile(
    params: DeleteSkillFileParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'delete_skill_file',
      context: params,
      payload: {
        skill_id: params.skill_id,
        relative_path: params.relative_path,
      },
      execute: () =>
        this.agentSkills.deleteSkillFile(params.skill_id, params.relative_path),
    });
  }

  async replaceProfileSkills(
    params: ReplaceProfileSkillsParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'replace_profile_skills',
      context: params,
      payload: {
        profile_id: params.profile_id,
        skill_ids_count: params.skill_ids.length,
      },
      execute: () =>
        this.agentSkills.replaceProfileSkills(
          params.profile_id,
          params.skill_ids,
        ),
    });
  }

  async addProfileSkills(
    params: AddProfileSkillsParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'add_profile_skills',
      context: params,
      payload: {
        profile_id: params.profile_id,
        skill_ids_count: params.skill_ids.length,
      },
      execute: () =>
        this.agentSkills.addProfileSkills(params.profile_id, params.skill_ids),
    });
  }

  async removeProfileSkills(
    params: RemoveProfileSkillsParams,
  ): Promise<Record<string, unknown>> {
    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'remove_profile_skills',
      context: params,
      payload: {
        profile_id: params.profile_id,
        skill_ids_count: params.skill_ids.length,
      },
      execute: () =>
        this.agentSkills.removeProfileSkills(
          params.profile_id,
          params.skill_ids,
        ),
    });
  }

  async saveScriptAsSkill(
    params: SaveScriptAsSkillParams,
  ): Promise<Record<string, unknown>> {
    const scriptRelativePath = resolveScriptRelativePath(params.relative_path);

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'save_script_as_skill',
      context: params,
      payload: {
        name: params.name,
        relative_path: scriptRelativePath,
        profile_id: params.profile_id ?? null,
        overwrite_existing: params.overwrite_existing === true,
      },
      execute: async () => {
        if (params.script_content.length === 0) {
          throw new BadRequestException('script_content is required');
        }

        const normalizedName = params.name.trim().toLowerCase();
        const skillMarkdown = buildSkillMarkdown(
          normalizedName,
          params.description,
          scriptRelativePath,
        );

        const skill = upsertSkillFromScript({
          agentSkills: this.agentSkills,
          name: normalizedName,
          description: params.description,
          skillMarkdown,
          overwriteExisting: params.overwrite_existing === true,
        });

        const scriptFile = this.agentSkills.upsertSkillFile({
          skillId: skill.name,
          relativePath: scriptRelativePath,
          content: params.script_content,
        });

        const callerProfileName = params.user?.agentProfileName?.trim();
        let profileSkills: Awaited<
          ReturnType<AgentSkillsService['addProfileSkills']>
        > | null = null;

        if (params.profile_id) {
          profileSkills = await this.agentSkills.addProfileSkills(
            params.profile_id,
            [skill.name],
          );
        } else if (callerProfileName) {
          profileSkills = await this.agentSkills.addProfileSkillsByProfileName(
            callerProfileName,
            [skill.name],
          );
        }

        const resolvedProfileId = params.profile_id ?? null;
        const resolvedProfileName = params.profile_id
          ? null
          : (callerProfileName ?? null);

        return {
          skill,
          script_file: scriptFile,
          profile_id: resolvedProfileId,
          profile_name: resolvedProfileName,
          profile_skill_count: profileSkills ? profileSkills.length : null,
        };
      },
    });
  }

  async createArtifact(
    params: CreateArtifactParams,
  ): Promise<Record<string, unknown>> {
    const action = buildCreateArtifactAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'create_artifact',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }

  async listArtifacts(
    params: ListArtifactsParams,
  ): Promise<Record<string, unknown>> {
    const action = buildListArtifactsAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'list_artifacts',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }

  async listArtifactFiles(
    params: ArtifactIdParams,
  ): Promise<Record<string, unknown>> {
    const action = buildListArtifactFilesAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'list_artifact_files',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }

  async upsertArtifactFile(
    params: UpsertArtifactFileParams,
  ): Promise<Record<string, unknown>> {
    const action = buildUpsertArtifactFileAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'upsert_artifact_file',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }

  async deleteArtifactFile(
    params: DeleteArtifactFileParams,
  ): Promise<Record<string, unknown>> {
    const action = buildDeleteArtifactFileAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'delete_artifact_file',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }

  async saveScriptAsArtifact(
    params: SaveScriptAsArtifactParams,
  ): Promise<Record<string, unknown>> {
    const action = buildSaveScriptAsArtifactAction({
      request: params,
      artifacts: this.artifacts,
    });

    return executeLifecycleCapabilityAction({
      capabilityExecutor: this.capabilityExecutor,
      capabilityName: 'save_script_as_artifact',
      context: params,
      payload: action.payload,
      execute: action.execute,
    });
  }
}
