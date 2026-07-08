import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArtifactLibraryService } from '../../ai-config/services/artifact-library.service';
import type { AgentSkillsService } from '../../ai-config/services/agent-skills.service';
import type { ArtifactFileSummary } from '../../ai-config/services/artifact-library.service.types';
import type { ImprovementProposalDraft } from '../../improvement/improvement-proposal.service.types';
import type { RuntimeContextInput } from './workflow-runtime-capability-lifecycle.types';
import type {
  ArtifactIdParams,
  CreateArtifactParams,
  DeleteArtifactFileParams,
  ListArtifactsParams,
  SaveScriptAsArtifactParams,
  UpsertArtifactFileParams,
} from './workflow-runtime-capability-lifecycle.types';
import type { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';

export const DEFAULT_SCRIPT_RELATIVE_PATH = 'scripts/reusable-script.md';
export const DEFAULT_ARTIFACT_SCRIPT_RELATIVE_PATH =
  'scripts/reusable-script.md';

/**
 * `create_skill`'s self-assignment carries no self-reported confidence
 * signal, so it uses the same fixed default as `suggest_skill_assignment`
 * (`SUGGEST_SKILL_ASSIGNMENT_DEFAULT_CONFIDENCE`) — `ImprovementGovernancePolicy`
 * is what actually bounds how far an `inference`-class proposal can go.
 */
const CREATE_SKILL_SELF_ASSIGNMENT_DEFAULT_CONFIDENCE = 0.5;
const CREATE_SKILL_SELF_ASSIGNMENT_SOURCE_TOOL = 'create_skill';

/**
 * Builds the `skill_assignment` improvement-proposal draft filed when
 * `create_skill` self-assigns the newly materialized skill to its caller's
 * agent profile. Rerouted through governance (Epic B, Task 10) instead of
 * calling `AgentSkillsService.addProfileSkillsByProfileName` directly, so
 * `ImprovementGovernancePolicy` decides auto-apply vs propose exactly like
 * an agent-initiated `suggest_skill_assignment` call.
 */
export function buildSkillAssignmentProposalDraft(params: {
  skillName: string;
  profileName: string;
}): ImprovementProposalDraft {
  return {
    kind: 'skill_assignment',
    payload: {
      skillName: params.skillName,
      assignment_targets: [
        { type: 'agent_profile', profileName: params.profileName },
      ],
    },
    evidence: { evidenceClass: 'inference' },
    confidence: CREATE_SKILL_SELF_ASSIGNMENT_DEFAULT_CONFIDENCE,
    provenance: {
      tool: CREATE_SKILL_SELF_ASSIGNMENT_SOURCE_TOOL,
      profileName: params.profileName,
    },
  };
}

export async function executeLifecycleCapabilityAction<TResult>(params: {
  capabilityExecutor: WorkflowRuntimeCapabilityExecutorService;
  capabilityName: string;
  context: RuntimeContextInput;
  payload: Record<string, unknown>;
  execute: () => TResult | Promise<TResult>;
}): Promise<Record<string, unknown>> {
  return params.capabilityExecutor.execute<TResult>({
    capabilityName: params.capabilityName,
    context: params.context,
    payload: params.payload,
    execute: params.execute,
  });
}

export function upsertSkillFromScript(params: {
  agentSkills: AgentSkillsService;
  name: string;
  description: string;
  skillMarkdown: string;
  overwriteExisting: boolean;
}) {
  if (!params.overwriteExisting) {
    return params.agentSkills.createSkill({
      name: params.name,
      description: params.description,
      skill_markdown: params.skillMarkdown,
    });
  }

  try {
    params.agentSkills.getSkill(params.name);
    return params.agentSkills.updateSkill(params.name, {
      name: params.name,
      skill_markdown: params.skillMarkdown,
    });
  } catch (error) {
    if (!(error instanceof NotFoundException)) {
      throw error;
    }

    return params.agentSkills.createSkill({
      name: params.name,
      description: params.description,
      skill_markdown: params.skillMarkdown,
    });
  }
}

export function resolveScriptRelativePath(relativePath?: string): string {
  const trimmed = relativePath?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  return DEFAULT_SCRIPT_RELATIVE_PATH;
}

export function resolveArtifactScriptRelativePath(
  relativePath?: string,
): string {
  const trimmed = relativePath?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  return DEFAULT_ARTIFACT_SCRIPT_RELATIVE_PATH;
}

export function buildSkillMarkdown(
  name: string,
  description: string,
  relativePath: string,
): string {
  const normalizedDescription = description.trim();
  const title = toTitleFromSlug(name);

  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(normalizedDescription)}`,
    '---',
    '',
    `# ${title}`,
    '',
    `Use this skill to reuse script content stored at ${relativePath}.`,
    '',
    'Follow the script file content as the source of truth.',
    '',
  ].join('\n');
}

export function resolveArtifactFileContent(params: {
  content?: string;
  contentBase64?: string;
}): Buffer {
  const hasRaw =
    typeof params.content === 'string' && params.content.length > 0;
  const hasBase64 =
    typeof params.contentBase64 === 'string' && params.contentBase64.length > 0;

  if (!hasRaw && !hasBase64) {
    throw new BadRequestException(
      'Either content or content_base64 must be provided',
    );
  }

  return hasBase64
    ? Buffer.from(params.contentBase64 ?? '', 'base64')
    : Buffer.from(params.content ?? '', 'utf8');
}

export function buildArtifactFileUpdateResult(params: {
  artifacts: ArtifactLibraryService;
  artifactId: string;
  relativePath: string;
  content: Buffer;
}): { artifact_id: string; files: ArtifactFileSummary[] } {
  return {
    artifact_id: params.artifactId,
    files: params.artifacts.upsertArtifactFile({
      artifactId: params.artifactId,
      relativePath: params.relativePath,
      content: params.content,
    }),
  };
}

export function buildCreateArtifactAction(params: {
  request: CreateArtifactParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  return {
    payload: {
      artifact_id: params.request.artifact_id ?? null,
      name: params.request.name,
      scope: params.request.scope ?? 'global',
    },
    execute: () =>
      params.artifacts.createArtifact({
        artifact_id: params.request.artifact_id,
        name: params.request.name,
        description: params.request.description,
        scope: params.request.scope,
        owner_profile: params.request.owner_profile,
        metadata: params.request.metadata,
      }),
  };
}

export function buildListArtifactsAction(params: {
  request: ListArtifactsParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  return {
    payload: {
      query: params.request.query ?? null,
      scope: params.request.scope ?? null,
      owner_profile: params.request.owner_profile ?? null,
    },
    execute: () => {
      const artifacts = params.artifacts.listArtifacts({
        query: params.request.query,
        scope: params.request.scope,
        owner_profile: params.request.owner_profile,
      });

      return {
        count: artifacts.length,
        artifacts,
      };
    },
  };
}

export function buildListArtifactFilesAction(params: {
  request: ArtifactIdParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  return {
    payload: { artifact_id: params.request.artifact_id },
    execute: () => ({
      artifact_id: params.request.artifact_id,
      files: params.artifacts.listArtifactFiles(params.request.artifact_id),
    }),
  };
}

export function buildUpsertArtifactFileAction(params: {
  request: UpsertArtifactFileParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  return {
    payload: {
      artifact_id: params.request.artifact_id,
      relative_path: params.request.relative_path,
    },
    execute: () => {
      const content = resolveArtifactFileContent({
        content: params.request.content,
        contentBase64: params.request.content_base64,
      });

      return buildArtifactFileUpdateResult({
        artifacts: params.artifacts,
        artifactId: params.request.artifact_id,
        relativePath: params.request.relative_path,
        content,
      });
    },
  };
}

export function buildDeleteArtifactFileAction(params: {
  request: DeleteArtifactFileParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  return {
    payload: {
      artifact_id: params.request.artifact_id,
      relative_path: params.request.relative_path,
    },
    execute: () => ({
      artifact_id: params.request.artifact_id,
      files: params.artifacts.deleteArtifactFile(
        params.request.artifact_id,
        params.request.relative_path,
      ),
    }),
  };
}

export function buildSaveScriptAsArtifactAction(params: {
  request: SaveScriptAsArtifactParams;
  artifacts: ArtifactLibraryService;
}): {
  payload: Record<string, unknown>;
  execute: () => unknown;
} {
  const scriptRelativePath = resolveArtifactScriptRelativePath(
    params.request.relative_path,
  );

  return {
    payload: {
      artifact_id: params.request.artifact_id ?? null,
      name: params.request.name,
      relative_path: scriptRelativePath,
      scope: params.request.scope ?? 'global',
    },
    execute: () => {
      if (params.request.script_content.length === 0) {
        throw new BadRequestException('script_content is required');
      }

      const artifact = params.artifacts.upsertArtifact({
        artifact_id: params.request.artifact_id,
        name: params.request.name,
        description: params.request.description,
        scope: params.request.scope,
        owner_profile: params.request.owner_profile,
      });

      const files = params.artifacts.upsertArtifactFile({
        artifactId: artifact.id,
        relativePath: scriptRelativePath,
        content: Buffer.from(params.request.script_content, 'utf8'),
      });

      return {
        artifact,
        relative_path: scriptRelativePath,
        files,
      };
    },
  };
}

function toTitleFromSlug(value: string): string {
  return value
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment[0].toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}
