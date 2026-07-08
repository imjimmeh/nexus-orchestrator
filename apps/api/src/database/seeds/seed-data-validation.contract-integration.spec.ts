import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateSeedDataDeterministically } from './seed-data-validation.helpers';

let workspaceRoot: string | null = null;

afterEach(async () => {
  vi.restoreAllMocks();
  if (workspaceRoot) {
    await rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = null;
  }
});

async function createSeedWorkspace(): Promise<string> {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'seed-contract-validation-'));
  await mkdir(join(workspaceRoot, 'seed', 'workflows'), { recursive: true });
  await mkdir(join(workspaceRoot, 'seed', 'agents'), { recursive: true });
  await mkdir(join(workspaceRoot, 'seed', 'skills'), { recursive: true });
  return workspaceRoot;
}

describe('seed data contract validation integration', () => {
  it('reports compiler diagnostics through the main seed validation path', async () => {
    const root = await createSeedWorkspace();
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    await writeFile(
      join(root, 'seed', 'workflows', 'contract-fixture.workflow.yaml'),
      [
        'workflow_id: contract_fixture',
        'name: Contract Fixture',
        'concurrency:',
        '  max_runs: 1',
        '  scope: inputs.scopeId',
        '  on_conflict: skip',
        'jobs:',
        '  - id: call_missing',
        '    type: mcp_tool_call',
        '    tier: light',
        '    inputs:',
        '      server_id: external-mcp',
        '      tool_name: external.missing_tool',
        '      policy:',
        '        allowed_servers: [external-mcp]',
        '        allowed_tools: [external.*]',
        '  - id: produce',
        '    type: execution',
        '    tier: heavy',
        '    output_contract:',
        '      required: [result]',
        '    steps:',
        '      - id: produce_prompt',
        '        type: agent',
        '        prompt: |',
        '          Call set_job_output("result", "ok") when complete.',
        '  - id: decide',
        '    type: execution',
        '    tier: heavy',
        '    output_contract:',
        '      required: [decision]',
        '    steps:',
        '      - id: decide_prompt',
        '        type: agent',
        '        prompt: Decide the outcome without recording outputs.',
        '  - id: consume',
        '    type: execution',
        '    tier: heavy',
        '    inputs:',
        '      missingKey: "{{ jobs.produce.output.missing }}"',
        '      missingJob: "{{ jobs.absent.output.result }}"',
        '    steps:',
        '      - id: consume_prompt',
        '        type: agent',
        '        prompt: Read upstream outputs.',
        '  - id: emit_unused',
        '    type: emit_event',
        '    tier: light',
        '    inputs:',
        '      event_name: GenericUnusedEvent',
      ].join('\n'),
      'utf-8',
    );

    await writeFile(
      join(root, 'seed', 'workflows', 'trigger-fixture.workflow.yaml'),
      [
        'workflow_id: trigger_fixture',
        'name: Trigger Fixture',
        'trigger:',
        '  type: event',
        '  name: GenericMissingProducerEvent',
        'jobs:',
        '  - id: observe',
        '    type: execution',
        '    tier: light',
        '    steps:',
        '      - id: observe_prompt',
        '        type: agent',
        '        prompt: Observe the event.',
      ].join('\n'),
      'utf-8',
    );

    const report = await validateSeedDataDeterministically({
      capabilityNames: ['external.present_tool'],
      bridgeActions: ['set_job_output'],
      modelNames: [],
      providerNames: [],
    });

    expect(report.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown_mcp_tool']),
    );
    expect(report.warnings.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid_downstream_output_reference',
        'unresolvable_concurrency_scope',
        'prompt_missing_required_output_instruction',
        'workflow-trigger-orphan',
        'event-emitter-without-trigger',
      ]),
    );
  });
});
