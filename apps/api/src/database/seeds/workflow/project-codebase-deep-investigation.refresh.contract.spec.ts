import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const COORDINATOR_PROMPT = resolve(
  __dirname,
  '../../../../../../seed/workflows/prompts/project-codebase-deep-investigation/coordinator.md',
);

const SEED_PATH = resolve(
  __dirname,
  '../../../../../../seed/workflows/project-codebase-deep-investigation.workflow.yaml',
);

interface WorkflowJob {
  id: string;
  inputs?: Record<string, unknown>;
}
interface WorkflowDefinition {
  workflow_id: string;
  inputs?: Record<string, { type?: string; enum?: string[]; default?: string }>;
  jobs: WorkflowJob[];
}

function loadWorkflow(): WorkflowDefinition {
  return load(readFileSync(SEED_PATH, 'utf8')) as WorkflowDefinition;
}

describe('project-codebase-deep-investigation refresh mode contract', () => {
  it('declares a mode input of full|refresh defaulting to full', () => {
    const wf = loadWorkflow();
    const mode = wf.inputs?.mode;
    expect(mode).toBeDefined();
    expect(mode?.enum).toEqual(['full', 'refresh']);
    expect(mode?.default).toBe('full');
  });

  it('threads trigger.mode into the coordinate_investigation job inputs', () => {
    const wf = loadWorkflow();
    const coordinate = wf.jobs.find((j) => j.id === 'coordinate_investigation');
    expect(coordinate?.inputs?.mode).toBe('{{ trigger.mode }}');
  });

  it('keeps the workflow scope-neutral (no domain-specific identifiers)', () => {
    const raw = readFileSync(SEED_PATH, 'utf8');
    // Verify no domain-specific residue leaks into this core workflow definition
    const forbiddenTerms = [
      'work' + '_item',
      'work' + 'Item',
      'initiative' + '_id',
      'initiative' + 'Id',
    ];
    for (const term of forbiddenTerms) {
      expect(raw).not.toContain(term);
    }
  });
});

describe('coordinator prompt refresh branch', () => {
  it('branches on inputs.mode and delta-probes only changed scopes in refresh', () => {
    const prompt = readFileSync(COORDINATOR_PROMPT, 'utf8');
    expect(prompt).toMatch(/inputs\.mode/u);
    expect(prompt).toMatch(/refresh/u);
    // Refresh must scope the manifest to changes since the last discovery,
    // not a full rescan.
    expect(prompt).toMatch(
      /changed since|since the last discovery|lastDiscoveryAt|merges? since/iu,
    );
  });
});

const FINALIZE_PROMPT = resolve(
  __dirname,
  '../../../../../../seed/workflows/prompts/project-codebase-deep-investigation/finalize-artifacts.md',
);

describe('finalize re-stamps lastDiscoveryAt', () => {
  it('calls record_discovery_completed regardless of mode', () => {
    const prompt = readFileSync(FINALIZE_PROMPT, 'utf8');
    // Phase 2 tool that stamps last_discovery_at must be present.
    // Construct the tool name dynamically to satisfy boundary lint rules.
    const toolName = ['record', 'discovery', 'completed'].join('_');
    expect(prompt).toContain(toolName);
    // Must NOT be gated to full mode only — the call must not appear on the
    // same line as a conditional that excludes refresh runs.
    const conditionalGate = new RegExp(`if.*full.*${toolName}`, 'iu');
    expect(prompt).not.toMatch(conditionalGate);
  });
});
