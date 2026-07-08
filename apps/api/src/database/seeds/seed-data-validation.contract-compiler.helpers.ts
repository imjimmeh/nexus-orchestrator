import type { IJob, IWorkflowDefinition } from '@nexus/core';
import { collectJobOutputReferences } from '../../workflow/validation/workflow-validation.job-rules';
import { readMcpToolNameFromJobInputs } from '../../workflow/validation/workflow-validation.job-validators';
import type {
  ContractDiagnostic,
  PromptContractMentions,
  WorkflowContractGraph,
} from './seed-data-validation.contract-compiler.types';
import type { ParsedWorkflowSeed } from './seed-data-validation.types';

export function compileWorkflowContract(
  workflow: IWorkflowDefinition,
  promptMentionsByJob: Map<string, PromptContractMentions>,
): WorkflowContractGraph {
  const jobs = workflow.jobs ?? [];
  const graph: WorkflowContractGraph = {
    workflowId: workflow.workflow_id,
    jobIds: new Set(jobs.map((job) => job.id)),
    declaredOutputKeysByJob: new Map(),
    requiredOutputKeysByJob: new Map(),
    downstreamOutputRefs: new Map(),
    promptMentionsByJob,
    emittedEvents: new Set(),
    consumedEvents: new Set(),
    concurrencyScopes: [],
    mcpToolCallsByJob: new Map(),
  };

  for (const job of jobs) {
    addJobContract(graph, job);
  }

  addWorkflowTriggerEvents(graph, workflow);
  addWorkflowConcurrencyScope(graph, workflow);

  return graph;
}

function addJobContract(graph: WorkflowContractGraph, job: IJob): void {
  const requiredKeys = job.output_contract?.required ?? [];
  const optionalKeys = job.output_contract?.optional ?? [];
  graph.requiredOutputKeysByJob.set(job.id, new Set(requiredKeys));
  graph.declaredOutputKeysByJob.set(
    job.id,
    new Set([...requiredKeys, ...optionalKeys]),
  );
  graph.downstreamOutputRefs.set(
    job.id,
    new Set(collectJobOutputReferences(job.inputs)),
  );
  addMcpToolCall(graph, job);
  addEmittedEvent(graph, job);
}

function addMcpToolCall(graph: WorkflowContractGraph, job: IJob): void {
  if (job.type !== 'mcp_tool_call') {
    return;
  }

  const toolName = readMcpToolNameFromJobInputs(job.inputs);
  if (toolName) graph.mcpToolCallsByJob.set(job.id, toolName);
}

function addEmittedEvent(graph: WorkflowContractGraph, job: IJob): void {
  const eventName = job.inputs?.event_name;
  if (job.type === 'emit_event' && typeof eventName === 'string') {
    graph.emittedEvents.add(eventName);
  }
}

function addWorkflowTriggerEvents(
  graph: WorkflowContractGraph,
  workflow: IWorkflowDefinition,
): void {
  if (workflow.trigger?.type !== 'event') {
    return;
  }

  if (workflow.trigger.event) {
    graph.consumedEvents.add(workflow.trigger.event);
  }
  if (workflow.trigger.name) {
    graph.consumedEvents.add(workflow.trigger.name);
  }
}

function addWorkflowConcurrencyScope(
  graph: WorkflowContractGraph,
  workflow: IWorkflowDefinition,
): void {
  if (workflow.concurrency?.scope) {
    graph.concurrencyScopes.push(workflow.concurrency.scope);
  }
}

export function validateWorkflowContractGraph(
  graph: WorkflowContractGraph,
  availableToolNames: Set<string>,
): ContractDiagnostic[] {
  return [
    ...validateMcpToolCalls(graph, availableToolNames),
    ...validateOutputContracts(graph),
    ...validateDownstreamOutputReferences(graph),
    ...validateConcurrencyScopes(graph),
  ];
}

export function validateSeedContractGraph(params: {
  readonly parsedWorkflows: ParsedWorkflowSeed[];
  readonly promptMentionsByWorkflowJob: Map<
    string,
    Map<string, PromptContractMentions>
  >;
  readonly knownToolNames: Set<string>;
}): ContractDiagnostic[] {
  return params.parsedWorkflows.flatMap((workflowSeed) =>
    validateWorkflowContractGraph(
      compileWorkflowContract(
        workflowSeed.parsed,
        params.promptMentionsByWorkflowJob.get(workflowSeed.workflowId) ??
          new Map<string, PromptContractMentions>(),
      ),
      params.knownToolNames,
    ).map((diagnostic) => ({
      ...diagnostic,
      filePath: workflowSeed.filePath,
      workflowId: workflowSeed.workflowId,
    })),
  );
}

function validateMcpToolCalls(
  graph: WorkflowContractGraph,
  availableToolNames: Set<string>,
): ContractDiagnostic[] {
  return [...graph.mcpToolCallsByJob.entries()]
    .filter(([, toolName]) => !availableToolNames.has(toolName))
    .map(([jobId, toolName]) => ({
      severity: 'error' as const,
      code: 'unknown_mcp_tool',
      message: `Workflow '${graph.workflowId}' job '${jobId}' calls unknown MCP tool '${toolName}'`,
      location: `${graph.workflowId}:${jobId}`,
    }));
}

function validateOutputContracts(
  graph: WorkflowContractGraph,
): ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = [];
  for (const [jobId, requiredKeys] of graph.requiredOutputKeysByJob.entries()) {
    const promptKeys = new Set(
      graph.promptMentionsByJob.get(jobId)?.setJobOutputKeys ?? [],
    );
    for (const requiredKey of requiredKeys) {
      if (!promptKeys.has(requiredKey)) {
        diagnostics.push({
          severity: 'warning',
          code: 'prompt_missing_required_output_instruction',
          message: `Job '${jobId}' requires output '${requiredKey}' but prompt does not instruct set_job_output for it`,
          location: `${graph.workflowId}:${jobId}`,
        });
      }
    }
  }
  return diagnostics;
}

function validateDownstreamOutputReferences(
  graph: WorkflowContractGraph,
): ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = [];
  for (const [consumerJobId, outputRefs] of graph.downstreamOutputRefs) {
    for (const outputRef of outputRefs) {
      const separatorIndex = outputRef.indexOf('.');
      const producerJobId = outputRef.slice(0, separatorIndex);
      const outputKey = outputRef.slice(separatorIndex + 1);
      const declaredKeys = graph.declaredOutputKeysByJob.get(producerJobId);
      if (declaredKeys?.has(outputKey)) {
        continue;
      }

      diagnostics.push({
        severity: 'warning',
        code: 'invalid_downstream_output_reference',
        message: `Job '${consumerJobId}' references missing output '${outputRef}'`,
        location: `${graph.workflowId}:${consumerJobId}`,
      });
    }
  }
  return diagnostics;
}

function validateConcurrencyScopes(
  graph: WorkflowContractGraph,
): ContractDiagnostic[] {
  return graph.concurrencyScopes
    .filter((scope) => !isRuntimeResolvableScope(scope))
    .map((scope) => ({
      severity: 'warning' as const,
      code: 'unresolvable_concurrency_scope',
      message: `Concurrency scope '${scope}' is not resolvable by runtime policy`,
      location: `${graph.workflowId}:concurrency.scope`,
    }));
}

function isRuntimeResolvableScope(scope: string): boolean {
  const normalized = normalizeScopeExpression(scope);
  if (normalized === 'global') return true;

  return normalized
    .split('+')
    .every((part) => part.trim().startsWith('trigger.'));
}

function normalizeScopeExpression(scope: string): string {
  const templateMatch = scope.match(/^\s*\{\{\s*(?<path>[^}]+?)\s*\}\}\s*$/u);
  return templateMatch?.groups?.path?.trim() ?? scope;
}
