import type { IWorkflowDefinition } from '@nexus/core';
import { describe, expect, it } from 'vitest';
import { collectJobOutputReferences } from '../../workflow/validation/workflow-validation.job-rules';
import {
  compileWorkflowContract,
  validateWorkflowContractGraph,
} from './seed-data-validation.contract-compiler.helpers';

function buildWorkflow(
  overrides: Partial<IWorkflowDefinition> = {},
): IWorkflowDefinition {
  return {
    workflow_id: 'generic_contract_workflow',
    name: 'Generic Contract Workflow',
    jobs: [],
    ...overrides,
  };
}

describe('seed data contract compiler helpers', () => {
  it('reports unknown MCP tool-call names', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        jobs: [
          {
            id: 'call_external_tool',
            type: 'mcp_tool_call',
            tier: 'light',
            inputs: {
              server_id: 'external-mcp',
              tool_name: 'external.missing_tool',
            },
          },
        ],
      }),
      new Map(),
    );

    expect(validateWorkflowContractGraph(graph, new Set())).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'unknown_mcp_tool',
        location: 'generic_contract_workflow:call_external_tool',
      }),
    );
  });

  it('reports required outputs that are not mentioned in prompt instructions', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        jobs: [
          {
            id: 'decide',
            type: 'execution',
            tier: 'heavy',
            output_contract: { required: ['decision'] },
            steps: [{ id: 'prompt', type: 'agent' }],
          },
        ],
      }),
      new Map([
        [
          'decide',
          { toolNames: [], setJobOutputKeys: ['summary'], eventNames: [] },
        ],
      ]),
    );

    expect(validateWorkflowContractGraph(graph, new Set())).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'prompt_missing_required_output_instruction',
        location: 'generic_contract_workflow:decide',
      }),
    );
  });

  it('accepts required outputs that are mentioned in prompt instructions', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        jobs: [
          {
            id: 'decide',
            type: 'execution',
            tier: 'heavy',
            output_contract: { required: ['decision'] },
            steps: [{ id: 'prompt', type: 'agent' }],
          },
        ],
      }),
      new Map([
        [
          'decide',
          { toolNames: [], setJobOutputKeys: ['decision'], eventNames: [] },
        ],
      ]),
    );

    expect(
      validateWorkflowContractGraph(graph, new Set()).filter(
        (diagnostic) =>
          diagnostic.code === 'prompt_missing_required_output_instruction',
      ),
    ).toEqual([]);
  });

  it('reports downstream references to missing job outputs', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        jobs: [
          {
            id: 'produce',
            type: 'execution',
            tier: 'heavy',
            output_contract: { required: ['result'] },
            steps: [{ id: 'prompt', type: 'agent' }],
          },
          {
            id: 'consume',
            type: 'execution',
            tier: 'heavy',
            inputs: {
              missingKey: '{{ jobs.produce.output.missing }}',
              missingJob: '{{ jobs.absent.output.result }}',
            },
            steps: [{ id: 'prompt', type: 'agent' }],
          },
        ],
      }),
      new Map([
        [
          'produce',
          { toolNames: [], setJobOutputKeys: ['result'], eventNames: [] },
        ],
      ]),
    );

    expect(
      validateWorkflowContractGraph(graph, new Set()).filter(
        (diagnostic) =>
          diagnostic.code === 'invalid_downstream_output_reference',
      ),
    ).toHaveLength(2);
  });

  it('reports concurrency scopes that runtime cannot resolve', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        concurrency: { max_runs: 1, scope: 'inputs.scopeId' },
      }),
      new Map(),
    );

    expect(validateWorkflowContractGraph(graph, new Set())).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'unresolvable_concurrency_scope',
        location: 'generic_contract_workflow:concurrency.scope',
      }),
    );
  });

  it('captures emitted and consumed event names', () => {
    const graph = compileWorkflowContract(
      buildWorkflow({
        trigger: { type: 'event', event: 'GenericInputEvent' },
        jobs: [
          {
            id: 'emit_done',
            type: 'emit_event',
            tier: 'light',
            inputs: { event_name: 'GenericOutputEvent' },
          },
        ],
      }),
      new Map(),
    );

    expect(graph.consumedEvents).toEqual(new Set(['GenericInputEvent']));
    expect(graph.emittedEvents).toEqual(new Set(['GenericOutputEvent']));
  });

  it('collects nested job output references', () => {
    expect(
      collectJobOutputReferences({
        direct: '{{ jobs.first.output.result }}',
        nested: ['{{ jobs.second.output.summary }}'],
      }),
    ).toEqual(['first.result', 'second.summary']);
  });
});
