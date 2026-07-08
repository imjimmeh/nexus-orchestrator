import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateSeedDataDeterministically } from './seed-data-validation.helpers';
import { discoverKnownToolNames } from './seed-data-validation.tool-discovery.helpers';
import { DEFAULT_LLM_MODELS } from './agent/llm-models.seed';
import { DEFAULT_LLM_PROVIDERS } from './agent/llm-providers.seed';
import { WorkflowParserService } from '../../workflow/workflow-parser.service';
import { expectCeoAuthorityContract } from './ceo-authority-contract.test-helper';
import { normalizeToolPolicy } from '../../workflow/workflow-step-execution/step-support.helpers';

const parser = new WorkflowParserService();
const seedsDir = resolve(__dirname, '../../../../../seed/workflows');

// Models/providers referenced by seed workflow step overrides that are
// provisioned out-of-band (OAuth-connected subscription accounts, or
// admin-added catalog rows) rather than shipped in the deterministic
// bootstrap seed (`DEFAULT_LLM_MODELS` / `DEFAULT_LLM_PROVIDERS`). Listed
// explicitly so this gate still catches a genuine typo in any future
// workflow `inputs.model` / `inputs.provider` override while accepting the
// known, intentional ones.
//
// `claude-sonnet-4-6`: a preflight
// refinement workflow's architect step is pinned off the DB
// default_for_execution model (MiniMax-M3), which was observed serializing
// `implementation_plan` as an empty string instead of a structured
// tool-call arg. `Anthropic (Claude Pro/Max)` is provisioned through the
// static provider seed (`apps/api/src/database/seeds/agent/llm-providers.seed.ts`),
// not via the OAuth login flow.
const OUT_OF_BAND_PROVISIONED_MODEL_NAMES = ['claude-sonnet-4-6'];
const OUT_OF_BAND_PROVISIONED_PROVIDER_NAMES: string[] = [];

function readSeed(filename: string): string {
  return readFileSync(join(seedsDir, filename), 'utf8');
}

function getExecutionStepPrompt(
  seedFilename: string,
  jobId: string,
  stepId: string,
): string {
  const definition = parser.parseWorkflow(readSeed(seedFilename));
  const job = (definition.jobs ?? []).find(
    (candidate) => candidate.id === jobId,
  );
  const step = job?.steps?.find((candidate) => candidate.id === stepId);

  expect(job).toBeDefined();
  expect(job?.type).toBe('execution');
  expect(step).toBeDefined();

  if (typeof step?.prompt === 'string') {
    return step.prompt;
  }

  const promptFile = (step as { prompt_file?: unknown })?.prompt_file;
  if (typeof promptFile !== 'string') {
    throw new Error('Expected step prompt or prompt_file');
  }

  if (promptFile === 'prompts/project-orchestration-cycle-ceo/cycle.md') {
    const path1 = join(
      seedsDir,
      'prompts/project-orchestration-cycle-ceo/cycle.md',
    );
    const path2 = join(
      seedsDir,
      'prompts/project-orchestration-cycle-ceo/decide.md',
    );
    return readFileSync(path1, 'utf8') + '\n\n' + readFileSync(path2, 'utf8');
  }

  return readFileSync(join(seedsDir, promptFile), 'utf8');
}

function formatIssue(issue: {
  code: string;
  message: string;
  filePath?: string;
  workflowId?: string;
  agentName?: string;
}): string {
  const location =
    issue.filePath ?? issue.workflowId ?? issue.agentName ?? 'unknown';
  return `${issue.code}: ${issue.message} (${location})`;
}

describe('Seed data deterministic validation', () => {
  it('validates the CEO cycle authority contract prompt and permissions', () => {
    const definition = parser.parseWorkflow(
      readSeed('project-orchestration-cycle-ceo.workflow.yaml'),
    );
    const allowTools = [...normalizeToolPolicy(definition.permissions).allow]
      .filter((tool) => tool !== '*')
      .sort((a, b) => a.localeCompare(b));
    const prompt = getExecutionStepPrompt(
      'project-orchestration-cycle-ceo.workflow.yaml',
      'dispatch',
      'dispatch',
    );

    expectCeoAuthorityContract({ allowTools, prompt });
  });

  it('validates workflows, agents, and cross-references', async () => {
    // Dynamically discover all known tools from capability providers and core aliases.
    // This eliminates the need to manually maintain a hardcoded tool list.
    const knownToolNames = Array.from(discoverKnownToolNames()).sort();

    // Bridge actions are a subset of known tools that support agent-to-agent delegation.
    const bridgeActions = [
      'spawn_subagent_async',
      'wait_for_subagents',
      'check_subagent_status',
      'update_external',
      'step_complete',
      'mention_agent',
      'check_agent_mentions',
      'resolve_agent_thread',
      'invite_agent_to_chat',
      'open_war_room',
      'invite_war_room_participant',
      'post_war_room_message',
      'update_war_room_blackboard',
      'submit_war_room_signoff',
      'get_war_room_state',
      'close_war_room',
      'query_memory',
      'invoke_agent_workflow',
      'complete_orchestration',
      'set_job_output',
    ];

    const report = await validateSeedDataDeterministically({
      modelNames: [
        ...DEFAULT_LLM_MODELS.map((m) => m.name),
        ...OUT_OF_BAND_PROVISIONED_MODEL_NAMES,
      ],
      providerNames: [
        ...DEFAULT_LLM_PROVIDERS.map((p) => p.name),
        ...OUT_OF_BAND_PROVISIONED_PROVIDER_NAMES,
      ],
      capabilityNames: knownToolNames,
      bridgeActions,
    });

    if (report.warnings.length > 0) {
      console.warn(
        `[seed-validation] warnings (${report.warnings.length.toString()}):\n${report.warnings
          .map(formatIssue)
          .join('\n')}`,
      );
    }

    expect(report.summary.workflowCount).toBeGreaterThan(0);
    expect(report.summary.agentCount).toBeGreaterThan(0);
    expect(report.summary.skillCount).toBeGreaterThan(0);
    expect(report.errors.map(formatIssue)).toEqual([]);
  });

  it('discovers projected workflow delegation tool names', () => {
    expect(Array.from(discoverKnownToolNames())).toEqual(
      expect.arrayContaining([
        'delegate_goal_backlog_planning',
        'delegate_imported_repo_discovery',
        'delegate_orchestration_advisor',
        'delegate_ui_ux_testing',
        'delegate_web_research',
      ]),
    );
  });

  it('does not advertise the retired preflight callback tool', () => {
    expect(discoverKnownToolNames()).not.toContain(
      'submit_preflight_artifacts',
    );
  });

  it('exposes the memory learning sweep tools as discoverable capabilities', () => {
    expect(Array.from(discoverKnownToolNames())).toEqual(
      expect.arrayContaining([
        'list_pending_learning_candidates',
        'promote_learning_candidate',
        'reject_learning_candidate',
        'create_skill_proposal',
      ]),
    );
  });

  it('retains non-handler capabilities from WorkflowContextCapabilityProvider', () => {
    // These capabilities have no IInternalToolHandler — they MUST remain
    // discoverable via the @Capability stub after handler stubs are removed.
    expect(Array.from(discoverKnownToolNames())).toEqual(
      expect.arrayContaining([
        'get_capabilities',
        'get_agent_profiles',
        'get_agent_profile',
      ]),
    );
  });

  it('retains non-handler capabilities from WorkflowManagementCapabilityProvider', () => {
    // These capabilities have no IInternalToolHandler — they MUST remain
    // discoverable via the @Capability stub after handler stubs are removed.
    expect(Array.from(discoverKnownToolNames())).toEqual(
      expect.arrayContaining(['create_agent_profile']),
    );
  });
});
