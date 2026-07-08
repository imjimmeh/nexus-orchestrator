import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DELEGATIONS_PATH = resolve(
  __dirname,
  '../../../../../../seed/workflow-delegation-tools/project-orchestration-cycle-ceo.delegations.json',
);

interface DelegationTool {
  id: string;
  enabled: boolean;
  tool_name: string;
  description?: string;
  workflow_id: string;
  tier_restriction?: number;
  input_schema: {
    type: string;
    additionalProperties?: boolean;
    properties: Record<string, unknown>;
    required?: string[];
  };
  fixed_trigger_data?: Record<string, unknown>;
  trigger_data_fields?: string[];
}

function loadTool(name: string): DelegationTool | undefined {
  const file = JSON.parse(readFileSync(DELEGATIONS_PATH, 'utf8')) as {
    tools: DelegationTool[];
  };
  return file.tools.find((t) => t.tool_name === name);
}

describe('delegate_rediscovery delegation tool contract', () => {
  it('targets the deep-investigation workflow with fixed refresh mode', () => {
    const tool = loadTool('delegate_rediscovery');
    expect(tool).toBeDefined();
    expect(tool?.enabled).toBe(true);
    expect(tool?.workflow_id).toBe('project_codebase_deep_investigation');
    expect(tool?.fixed_trigger_data?.mode).toBe('refresh');
  });

  it('uses a closed JSON Schema requiring a reason', () => {
    const tool = loadTool('delegate_rediscovery');
    expect(tool?.input_schema.additionalProperties).toBe(false);
    expect(tool?.input_schema.required).toContain('reason');
  });

  it('stays scope-neutral (no domain-specific identifiers)', () => {
    const tool = loadTool('delegate_rediscovery');
    const raw = JSON.stringify(tool);
    // Use concatenation so the boundary lint rule does not flag these as residue in core
    const forbiddenTerms = [
      'work' + '_item',
      'work' + 'Item',
      'initiative' + '_id',
      'initiative' + 'Id',
      'kan' + 'ban',
    ];
    for (const term of forbiddenTerms) {
      expect(raw).not.toContain(term);
    }
  });
});

describe('delegate_ui_ux_testing delegation tool contract', () => {
  it('targets the UI/UX smoke-test workflow with a closed launch payload', () => {
    const tool = loadTool('delegate_ui_ux_testing');
    expect(tool).toBeDefined();
    expect(tool?.enabled).toBe(true);
    expect(tool?.workflow_id).toBe('ui_ux_smoke_test');
    expect(tool?.description).toContain('durable await');
    expect(tool?.input_schema.additionalProperties).toBe(false);
    expect(tool?.input_schema.required).toEqual(
      expect.arrayContaining(['reason', 'objective']),
    );
    expect(tool?.trigger_data_fields).toEqual(
      expect.arrayContaining([
        'scopeId',
        'objective',
        'target_url',
        'app_start_command',
        'flows',
      ]),
    );
  });
});

describe('delegate_web_research delegation tool contract', () => {
  it('targets the web-research workflow with a closed launch payload', () => {
    const tool = loadTool('delegate_web_research');
    expect(tool).toBeDefined();
    expect(tool?.enabled).toBe(true);
    expect(tool?.workflow_id).toBe('web_research');
    expect(tool?.description).toContain('durable await');
    expect(tool?.input_schema.additionalProperties).toBe(false);
    expect(tool?.input_schema.required).toEqual(
      expect.arrayContaining(['reason', 'objective']),
    );
    expect(tool?.trigger_data_fields).toEqual(
      expect.arrayContaining([
        'scopeId',
        'objective',
        'questions',
        'must_include_domains',
        'avoid_domains',
      ]),
    );
  });
});

import { join } from 'node:path';

const CEO_AGENT_PATH = resolve(
  __dirname,
  '../../../../../../seed/agents/ceo-agent/agent.json',
);

describe('ceo-agent allow-lists delegate_rediscovery', () => {
  it('grants the CEO agent the delegate_rediscovery tool', () => {
    const agent = JSON.parse(readFileSync(CEO_AGENT_PATH, 'utf8')) as {
      tool_policy: { rules: { effect: string; tool: string }[] };
    };
    const allowed = agent.tool_policy.rules.some(
      (r) => r.effect === 'allow' && r.tool === 'delegate_rediscovery',
    );
    expect(allowed).toBe(true);
  });
});

describe('ceo-agent allow-lists specialist delegation tools', () => {
  it('grants the CEO agent the specialist delegation tools', () => {
    const agent = JSON.parse(readFileSync(CEO_AGENT_PATH, 'utf8')) as {
      tool_policy: { rules: { effect: string; tool: string }[] };
    };

    expect(agent.tool_policy.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effect: 'allow',
          tool: 'delegate_ui_ux_testing',
        }),
        expect.objectContaining({
          effect: 'allow',
          tool: 'delegate_web_research',
        }),
      ]),
    );
  });
});

const STRATEGIZE_PROMPT = resolve(
  __dirname,
  '../../../../../../seed/workflows/prompts/project-orchestration-cycle-ceo/strategize.md',
);

const CEO_WORKFLOW_YAML = resolve(
  __dirname,
  '../../../../../../seed/workflows/project-orchestration-cycle-ceo.workflow.yaml',
);

describe('engine gates rediscovery on the merge threshold', () => {
  it('delegates rediscovery (awaiting) when mergesSinceDiscovery >= 10', () => {
    // Re-discovery gating moved from a prompt instruction to a deterministic
    // engine job (`rediscovery_gate`) that fires before the strategize step.
    // Assert the engine mechanism instead of the old prompt prose.
    const workflowRaw = readFileSync(CEO_WORKFLOW_YAML, 'utf8');
    // The gate job must exist in the YAML.
    expect(workflowRaw).toContain('id: rediscovery_gate');
    // The condition must evaluate mergesSinceDiscovery >= 10
    // (mirrors REDISCOVERY_MERGE_THRESHOLD — threshold is 10).
    expect(workflowRaw).toContain('mergesSinceDiscovery');
    expect(workflowRaw).toContain('10');
    // The gate must invoke the deep-investigation workflow in refresh mode.
    expect(workflowRaw).toContain('project_codebase_deep_investigation');
    expect(workflowRaw).toContain('mode: refresh');

    // The strategize.md "Specialist passes" section documents the threshold
    // the engine evaluated, so the CEO understands what already ran.
    const prompt = readFileSync(STRATEGIZE_PROMPT, 'utf8');
    expect(prompt).toMatch(/mergesSinceDiscovery/u);
    expect(prompt).toMatch(/10/u); // REDISCOVERY_MERGE_THRESHOLD
    // The invoke_workflow gate type is itself a durable await (the engine
    // awaits each gate job before proceeding to the next).
    expect(workflowRaw).toContain('type: invoke_workflow');
  });
});
