import * as fs from 'node:fs';
import * as path from 'node:path';
import { CAPABILITY_METADATA_KEY } from '../../tool/capability.decorator';
import { OrchestrationSessionCapabilityProvider } from '../../workflow/providers/orchestration-session-capability.provider';
import { WorkflowContextCapabilityProvider } from '../../workflow/providers/workflow-context-capability.provider';
import { WorkflowManagementCapabilityProvider } from '../../workflow/providers/workflow-management-capability.provider';
import { WorkflowRuntimeBrowserCapabilityProvider } from '../../workflow/providers/workflow-runtime-browser-capability.provider';
import { WorkflowUserInteractionCapabilityProvider } from '../../workflow/providers/workflow-user-interaction-capability.provider';
import { DelegationCapabilityProvider } from '../../workflow/providers/delegation-capability.provider';
import { ApprovalsCapabilityProvider } from '../../capability-governance/providers/approvals-capability.provider';
import { JobOutputCapabilityProvider } from '../../workflow/providers/job-output-capability.provider';
import { WarRoomCapabilityProvider } from '../../workflow/providers/war-room-capability.provider';
import { QueryMemoryTool } from '../../workflow/workflow-internal-tools/tools/memory/query-memory.tool';
import { CreateScheduledJobTool } from '../../workflow/workflow-internal-tools/tools/schedule/create-scheduled-job.tool';
import { DeleteScheduledJobTool } from '../../workflow/workflow-internal-tools/tools/schedule/delete-scheduled-job.tool';
import { GetScheduleTool } from '../../workflow/workflow-internal-tools/tools/schedule/get-schedule.tool';
import { ListScheduleRunsTool } from '../../workflow/workflow-internal-tools/tools/schedule/list-schedule-runs.tool';
import { ListSchedulesTool } from '../../workflow/workflow-internal-tools/tools/schedule/list-schedules.tool';
import { PauseScheduledJobTool } from '../../workflow/workflow-internal-tools/tools/schedule/pause-scheduled-job.tool';
import { ResumeScheduledJobTool } from '../../workflow/workflow-internal-tools/tools/schedule/resume-scheduled-job.tool';
import { RunScheduledJobNowTool } from '../../workflow/workflow-internal-tools/tools/schedule/run-scheduled-job-now.tool';
import { UpdateScheduledJobTool } from '../../workflow/workflow-internal-tools/tools/schedule/update-scheduled-job.tool';
import { CreateWorkflowDefinitionTool } from '../../workflow/workflow-internal-tools/tools/workflow/create-workflow-definition.tool';
import { DeleteWorkflowDefinitionTool } from '../../workflow/workflow-internal-tools/tools/workflow/delete-workflow-definition.tool';
import { GetWorkflowTool } from '../../workflow/workflow-internal-tools/tools/workflow/get-workflow.tool';
import { ListWorkflowsTool } from '../../workflow/workflow-internal-tools/tools/workflow/list-workflows.tool';
import { UpdateWorkflowDefinitionTool } from '../../workflow/workflow-internal-tools/tools/workflow/update-workflow-definition.tool';
import { GetTodoListTool } from '../../workflow/workflow-internal-tools/tools/todo/get-todo-list.tool';
import { ManageTodoListTool } from '../../workflow/workflow-internal-tools/tools/todo/manage-todo-list.tool';
import { RecordLearningTool } from '../../workflow/workflow-internal-tools/tools/memory/record-learning.tool';
import { RememberTool } from '../../workflow/workflow-internal-tools/tools/memory/remember.tool';
import { ListPendingLearningCandidatesTool } from '../../workflow/workflow-internal-tools/tools/memory/list-pending-learning-candidates.tool';
import { PromoteLearningCandidateTool } from '../../workflow/workflow-internal-tools/tools/memory/promote-learning-candidate.tool';
import { RejectLearningCandidateTool } from '../../workflow/workflow-internal-tools/tools/memory/reject-learning-candidate.tool';
import { CreateSkillProposalTool } from '../../workflow/workflow-internal-tools/tools/memory/create-skill-proposal.tool';
import { SuggestSkillAssignmentTool } from '../../workflow/workflow-internal-tools/tools/skill/suggest-skill-assignment.tool';
import { SearchWorkflowsTool } from '../../workflow/workflow-internal-tools/tools/workflow/search-workflows.tool';
import { ReadWorkflowSummaryTool } from '../../workflow/workflow-internal-tools/tools/workflow/read-workflow-summary.tool';
import { SearchSkillsTool } from '../../workflow/workflow-internal-tools/tools/skill/search-skills.tool';
import { ReadSkillManifestTool } from '../../workflow/workflow-internal-tools/tools/skill/read-skill-manifest.tool';
import { SearchPlaybooksTool } from '../../workflow/workflow-internal-tools/tools/playbook/search-playbooks.tool';
import { ReadPlaybookTool } from '../../workflow/workflow-internal-tools/tools/playbook/read-playbook.tool';
import { AnalyzeImageTool } from '../../tool/handlers/analyze-image.tool';
import { ReadDocumentTool } from '../../tool/handlers/read-document.tool';
import { FetchUrlTool } from '../../tool/handlers/fetch-url.tool';
import { WebFetchTool } from '../../tool/handlers/web-fetch.tool';
import { WebSearchTool } from '../../tool/handlers/web-search.tool';
import { ExtractFigmaTool } from '../../tool/handlers/extract-figma.tool';
import { CORE_TOOL_ALIASES } from './seed-data-validation.shared';
import { resolveSeedRoot } from './seed-data-validation.shared';

type CapabilityProviderClass = {
  prototype: unknown;
};

/**
 * Capability providers that are registered by the NestJS application.
 * These are the "built-in" capabilities available to all workflows.
 */
const CAPABILITY_PROVIDERS: CapabilityProviderClass[] = [
  OrchestrationSessionCapabilityProvider,
  WorkflowContextCapabilityProvider,
  WorkflowManagementCapabilityProvider,
  WorkflowRuntimeBrowserCapabilityProvider,
  WorkflowUserInteractionCapabilityProvider,
  JobOutputCapabilityProvider,
  DelegationCapabilityProvider,
  ApprovalsCapabilityProvider,
  WarRoomCapabilityProvider,
];

/**
 * Tool handler classes that implement @Capability decorators.
 * These are discovered and validated against capability declarations.
 */
const HANDLER_CLASSES: Array<{ prototype: { getName(): string } }> = [
  QueryMemoryTool,
  RememberTool,
  ListPendingLearningCandidatesTool,
  PromoteLearningCandidateTool,
  RejectLearningCandidateTool,
  CreateSkillProposalTool,
  SuggestSkillAssignmentTool,
  CreateScheduledJobTool,
  DeleteScheduledJobTool,
  GetScheduleTool,
  ListScheduleRunsTool,
  ListSchedulesTool,
  PauseScheduledJobTool,
  ResumeScheduledJobTool,
  RunScheduledJobNowTool,
  UpdateScheduledJobTool,
  CreateWorkflowDefinitionTool,
  DeleteWorkflowDefinitionTool,
  GetWorkflowTool,
  ListWorkflowsTool,
  UpdateWorkflowDefinitionTool,
  SearchWorkflowsTool,
  ReadWorkflowSummaryTool,
  SearchSkillsTool,
  ReadSkillManifestTool,
  SearchPlaybooksTool,
  ReadPlaybookTool,
  GetTodoListTool,
  ManageTodoListTool,
  RecordLearningTool,
  AnalyzeImageTool,
  ReadDocumentTool,
  FetchUrlTool,
  WebFetchTool,
  WebSearchTool,
  ExtractFigmaTool,
];

const TOOL_MANIFEST_DIR = 'tool-manifests';
const TOOL_MANIFEST_SUFFIX = '.seed.json';
const TOOL_MANIFEST_TOOL_NAMES_KEY = 'toolNames';
const WORKFLOW_DELEGATION_TOOLS_DIR = 'workflow-delegation-tools';
const WORKFLOW_DELEGATION_TOOLS_SUFFIX = '.json';

type ManifestContainer = {
  toolNames?: unknown;
};

type WorkflowDelegationToolsContainer = {
  tools?: unknown;
};

function extractSeedManifestToolNames(
  fileName: string,
  manifest: unknown,
): string[] {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(
      `[seed tool manifest] ${fileName} must be an object containing '${TOOL_MANIFEST_TOOL_NAMES_KEY}'`,
    );
  }

  const container = manifest as ManifestContainer;
  const rawNames = container[TOOL_MANIFEST_TOOL_NAMES_KEY];

  if (!Array.isArray(rawNames)) {
    throw new Error(
      `[seed tool manifest] ${fileName} must include '${TOOL_MANIFEST_TOOL_NAMES_KEY}' as an array`,
    );
  }

  if (rawNames.length === 0) {
    throw new Error(
      `[seed tool manifest] ${fileName} must include a non-empty '${TOOL_MANIFEST_TOOL_NAMES_KEY}' array`,
    );
  }

  for (const name of rawNames) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(
        `[seed tool manifest] ${fileName} must include only non-empty string tool names`,
      );
    }

    if (name !== name.trim()) {
      throw new Error(
        `[seed tool manifest] ${fileName} must not include leading or trailing whitespace in tool names (trim required)`,
      );
    }
  }

  return rawNames as string[];
}

export function discoverSeedManifestToolNames(
  seedRoot: string = resolveSeedRoot(),
): string[] {
  const manifestDir = path.join(seedRoot, TOOL_MANIFEST_DIR);

  if (!fs.existsSync(manifestDir)) {
    return [];
  }

  const files = fs
    .readdirSync(manifestDir)
    .filter((entry) => entry.endsWith(TOOL_MANIFEST_SUFFIX));

  const toolNames = new Set<string>();

  for (const fileName of files) {
    const filePath = path.join(manifestDir, fileName);
    const content = fs.readFileSync(filePath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to parse seed tool manifest '${filePath}'`, {
        cause: error,
      });
    }

    for (const name of extractSeedManifestToolNames(fileName, parsed)) {
      toolNames.add(name);
    }
  }

  return [...toolNames].sort();
}

function extractWorkflowDelegationToolNames(
  fileName: string,
  config: unknown,
): string[] {
  if (!config || typeof config !== 'object') {
    throw new Error(
      `[workflow delegation tools] ${fileName} must be an object containing 'tools'`,
    );
  }

  const rawTools = (config as WorkflowDelegationToolsContainer).tools;
  if (!Array.isArray(rawTools)) {
    throw new Error(
      `[workflow delegation tools] ${fileName} must include 'tools' as an array`,
    );
  }

  return rawTools.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(
        `[workflow delegation tools] ${fileName} tools[${index.toString()}] must be an object`,
      );
    }

    const toolName = (entry as { tool_name?: unknown }).tool_name;
    if (typeof toolName !== 'string' || toolName.trim().length === 0) {
      throw new Error(
        `[workflow delegation tools] ${fileName} tools[${index.toString()}].tool_name must be a non-empty string`,
      );
    }

    return toolName.trim();
  });
}

export function discoverWorkflowDelegationToolNames(
  seedRoot: string = resolveSeedRoot(),
): string[] {
  const configDir = path.join(seedRoot, WORKFLOW_DELEGATION_TOOLS_DIR);
  if (!fs.existsSync(configDir)) {
    return [];
  }

  const toolNames = new Set<string>();
  for (const fileName of fs
    .readdirSync(configDir)
    .filter((entry) => entry.endsWith(WORKFLOW_DELEGATION_TOOLS_SUFFIX))) {
    const filePath = path.join(configDir, fileName);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    for (const name of extractWorkflowDelegationToolNames(fileName, parsed)) {
      toolNames.add(name);
    }
  }

  return [...toolNames].sort((a, b) => a.localeCompare(b));
}

/**
 * Discover all known tool names from capability providers and core aliases.
 * This is the dynamic alternative to hardcoding tool names in tests.
 *
 * @returns Set of all known tool names (capabilities + core aliases)
 */
export function discoverKnownToolNames(seedRoot?: string): Set<string> {
  const names = new Set<string>();

  // Collect capability names from all providers
  for (const ProviderClass of CAPABILITY_PROVIDERS) {
    const proto = ProviderClass.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') {
        continue;
      }
      const method = proto[key];
      if (typeof method !== 'function') {
        continue;
      }
      const metadata = Reflect.getMetadata(CAPABILITY_METADATA_KEY, method) as
        | { name?: string }
        | undefined;
      if (metadata?.name) {
        names.add(metadata.name);
      }
    }
  }

  // Add core tool aliases (bash, read, write, etc.)
  for (const alias of CORE_TOOL_ALIASES) {
    names.add(alias);
  }

  for (const handlerName of discoverHandlerNames()) {
    names.add(handlerName);
  }

  for (const toolName of discoverSeedManifestToolNames(seedRoot)) {
    names.add(toolName);
  }

  for (const toolName of discoverWorkflowDelegationToolNames(seedRoot)) {
    names.add(toolName);
  }

  return names;
}

/**
 * Discover all handler names from tool classes.
 * Used for validation that every handler has a matching @Capability declaration.
 *
 * @returns Sorted list of handler tool names
 */
export function discoverHandlerNames(): string[] {
  return HANDLER_CLASSES.map((Cls) => {
    const instance = Object.create(Cls.prototype) as {
      getName(): string;
    };
    return instance.getName();
  }).sort((a, b) => a.localeCompare(b));
}
