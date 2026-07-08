import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  SeedValidationIssue,
  SeedRoots,
} from './seed-data-validation.types';

export const CORE_TOOL_ALIASES = [
  'bash',
  'edit',
  'ls',
  'find',
  'grep',
  'read',
  'write',
  'ask_user_questions',
  'query_memory',
  'step_complete',
  'open_war_room',
  'invite_war_room_participant',
  'post_war_room_message',
  'update_war_room_blackboard',
  'submit_war_room_signoff',
  'get_war_room_state',
  'close_war_room',
  'mention_agent',
  'check_agent_mentions',
  'resolve_agent_thread',
  'invite_agent_to_chat',
  'spawn_subagent_async',
  'wait_for_subagents',
  'check_subagent_status',
  'invoke_agent_workflow',
  'get_todo_list',
  'manage_todo_list',
  'submit_implementation_plan',
  'submit_qa_decision',
  'submit_merge_result',
  'create_tool_candidate',
  'validate_tool_candidate',
  'publish_tool_candidate',
  'upsert_tool',
  'create_skill',
  'update_skill',
  'list_skill_files',
  'upsert_skill_file',
  'delete_skill_file',
  'replace_profile_skills',
  'add_profile_skills',
  'remove_profile_skills',
  'save_script_as_skill',
  'create_artifact',
  'list_artifacts',
  'list_artifact_files',
  'upsert_artifact_file',
  'delete_artifact_file',
  'save_script_as_artifact',
  'create_delegation_contract',
  'get_delegation_contract',
  'dispatch_delegation_contracts',
  'get_delegation_replay',
] as const;

export const WORKFLOW_FILE_SUFFIX = '.workflow.yaml';
export const AGENT_CONFIG_FILENAME = 'agent.json';
export const AGENT_PROMPT_FILENAME = 'PROMPT.md';
export const SKILL_MARKDOWN_FILENAME = 'SKILL.md';

export function resolveSeedRoot(): string {
  const candidates = [
    path.join(process.cwd(), 'seed'),
    path.join(process.cwd(), '..', 'seed'),
    path.join(process.cwd(), '..', '..', 'seed'),
    path.resolve(__dirname, '../../../../../seed'),
  ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error(
      `Unable to resolve seed root. Checked: ${candidates.join(', ')}`,
    );
  }

  return match;
}

export function listDirectories(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function listFiles(root: string, suffix: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export function isLiteralReference(value: string): boolean {
  return !value.includes('{{');
}

export function addIssue(
  collection: SeedValidationIssue[],
  issue: SeedValidationIssue,
): void {
  collection.push(issue);
}

export function buildKnownToolNameSet(params: {
  capabilityNames: string[];
  bridgeActions: string[];
}): Set<string> {
  return new Set([
    ...params.capabilityNames,
    ...params.bridgeActions,
    ...CORE_TOOL_ALIASES,
  ]);
}

export function isExperimentalWorkflow(params: {
  workflowId: string;
  filePath: string;
}): boolean {
  const workflowId = params.workflowId.toLowerCase();
  const fileName = path.basename(params.filePath).toLowerCase();

  if (workflowId.includes('test')) {
    return true;
  }

  return fileName.includes('test') || fileName.includes('demo');
}

export function normalizeWorkflowValidationError(
  errorMessage: string,
  experimental: boolean,
): {
  warning?: string;
  error?: string;
} {
  if (
    errorMessage.includes("uses deprecated field 'output_tool'") ||
    errorMessage.includes("uses deprecated field 'required_tool_calls'")
  ) {
    return { warning: errorMessage };
  }

  if (experimental) {
    const isDowngradable =
      errorMessage.includes('references unknown tool') ||
      errorMessage.includes('references missing workflow') ||
      errorMessage.includes('references unknown agent profile');

    if (isDowngradable) {
      return { warning: errorMessage };
    }
  }

  return { error: errorMessage };
}

export function resolveSeedRoots(seedRoot: string): SeedRoots {
  return {
    workflowsRoot: path.join(seedRoot, 'workflows'),
    agentsRoot: path.join(seedRoot, 'agents'),
    skillsRoot: path.join(seedRoot, 'skills'),
  };
}

export function validateSeedRootDirectories(
  roots: SeedRoots,
  errors: SeedValidationIssue[],
): void {
  if (!fs.existsSync(roots.workflowsRoot)) {
    addIssue(errors, {
      code: 'seed-workflows-missing',
      filePath: roots.workflowsRoot,
      message: 'Missing seed/workflows directory',
    });
  }

  if (!fs.existsSync(roots.agentsRoot)) {
    addIssue(errors, {
      code: 'seed-agents-missing',
      filePath: roots.agentsRoot,
      message: 'Missing seed/agents directory',
    });
  }

  if (!fs.existsSync(roots.skillsRoot)) {
    addIssue(errors, {
      code: 'seed-skills-missing',
      filePath: roots.skillsRoot,
      message: 'Missing seed/skills directory',
    });
  }
}
