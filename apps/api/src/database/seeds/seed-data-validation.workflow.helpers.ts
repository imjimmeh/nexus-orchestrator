import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IJob, IJobStep } from '@nexus/core';
import { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import { DAGResolverService } from '../../workflow/dag-resolver.service';
import { WorkflowParserService } from '../../workflow/workflow-parser.service';
import { WorkflowValidationService } from '../../workflow/workflow-validation.service';
import type { SpecialStepHandlerLookup } from '../../workflow/workflow-special-steps/step-special-step.types';
import type {
  ParsedAgentSeed,
  ParsedWorkflowSeed,
  SeedValidationIssue,
} from './seed-data-validation.types';
import {
  WORKFLOW_FILE_SUFFIX,
  addIssue,
  isExperimentalWorkflow,
  isLiteralReference,
  listFiles,
  normalizeWorkflowValidationError,
} from './seed-data-validation.shared';
import { validatePromptContent } from './seed-data-validation.prompt.helpers';
import {
  validateJobToolsForProfile,
  collectStaticAgentProfileRefs,
} from './seed-data-validation.policy-checks.helpers';

export { validateWorkflowTriggersAndEvents } from './seed-data-validation.events.helpers';

function createValidationService(
  knownToolNames: Set<string>,
): WorkflowValidationService {
  const findByName = (name: string) => {
    if (!knownToolNames.has(name)) {
      return Promise.resolve(null);
    }

    const tool: Awaited<ReturnType<ToolRegistryRepository['findByName']>> = {
      id: `seed-validation-${name}`,
      name,
      schema: {
        type: 'object',
        properties: {},
      },
      typescript_code: '',
      tier_restriction: 0,
      source: 'manual',
      created_at: new Date(),
      updated_at: new Date(),
    };

    return Promise.resolve(tool);
  };

  const toolRegistryRepo = {
    findByName,
  } as ToolRegistryRepository;
  const specialStepRegistry: SpecialStepHandlerLookup = {
    getHandler: () => null,
  };

  return new WorkflowValidationService(
    toolRegistryRepo,
    new DAGResolverService(),
    specialStepRegistry,
  );
}

async function appendWorkflowValidationIssues(params: {
  parsed: ReturnType<WorkflowParserService['parseWorkflow']>;
  filePath: string;
  validator: WorkflowValidationService;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): Promise<void> {
  const { parsed, filePath, validator, errors, warnings } = params;
  const validation = await validator.validateWorkflow(parsed);
  const experimental = isExperimentalWorkflow({
    workflowId: parsed.workflow_id,
    filePath,
  });

  for (const message of validation.errors) {
    const normalized = normalizeWorkflowValidationError(message, experimental);
    if (normalized.warning) {
      addIssue(warnings, {
        code: 'workflow-validation-warning',
        filePath,
        workflowId: parsed.workflow_id,
        message: normalized.warning,
      });
      continue;
    }

    addIssue(errors, {
      code: experimental
        ? 'workflow-validation-error-experimental'
        : 'workflow-validation-failed',
      filePath,
      workflowId: parsed.workflow_id,
      message: normalized.error ?? message,
    });
  }
}

export async function collectParsedWorkflows(params: {
  workflowsRoot: string;
  knownToolNames: Set<string>;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): Promise<ParsedWorkflowSeed[]> {
  const parser = new WorkflowParserService();
  const validator = createValidationService(params.knownToolNames);
  const parsedWorkflows: ParsedWorkflowSeed[] = [];

  for (const filename of listFiles(
    params.workflowsRoot,
    WORKFLOW_FILE_SUFFIX,
  )) {
    const filePath = path.join(params.workflowsRoot, filename);
    const yamlContent = fs.readFileSync(filePath, 'utf8');

    try {
      const parsed = parser.parseWorkflow(yamlContent);
      parsedWorkflows.push({
        workflowId: parsed.workflow_id,
        filePath,
        parsed,
      });
      validateWorkflowPromptContent({
        parsed,
        filePath,
        workflowsRoot: params.workflowsRoot,
        knownToolNames: params.knownToolNames,
        experimental: isExperimentalWorkflow({
          workflowId: parsed.workflow_id,
          filePath,
        }),
        errors: params.errors,
        warnings: params.warnings,
      });
      await appendWorkflowValidationIssues({
        parsed,
        filePath,
        validator,
        errors: params.errors,
        warnings: params.warnings,
      });
    } catch (error) {
      addIssue(params.errors, {
        code: 'workflow-parse-failed',
        filePath,
        message: (error as Error).message,
      });
    }
  }

  return parsedWorkflows;
}

function validateWorkflowPromptContent(params: {
  parsed: ReturnType<WorkflowParserService['parseWorkflow']>;
  filePath: string;
  workflowsRoot: string;
  knownToolNames: Set<string>;
  experimental: boolean;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  const promptIssues = params.experimental ? params.warnings : params.errors;

  for (const promptSource of collectWorkflowPromptSources(params)) {
    validatePromptContent({
      content: promptSource.content,
      knownToolNames: params.knownToolNames,
      issues: promptIssues,
      filePath: promptSource.filePath,
      issueCodePrefix: 'workflow-prompt',
      workflowId: params.parsed.workflow_id,
    });
  }
}

function collectWorkflowPromptSources(params: {
  parsed: ReturnType<WorkflowParserService['parseWorkflow']>;
  filePath: string;
  workflowsRoot: string;
}): Array<{ content: string; filePath: string; jobId: string }> {
  const promptSources: Array<{
    content: string;
    filePath: string;
    jobId: string;
  }> = [];

  for (const job of params.parsed.jobs ?? []) {
    for (const step of collectWorkflowJobSteps(job)) {
      const inlinePrompt = readInlinePrompt(step);
      if (inlinePrompt) {
        promptSources.push({
          content: inlinePrompt,
          filePath: params.filePath,
          jobId: job.id,
        });
      }

      const promptFilePath = resolvePromptFilePath(step, params.workflowsRoot);
      if (!promptFilePath) {
        continue;
      }

      promptSources.push({
        content: fs.readFileSync(promptFilePath, 'utf8'),
        filePath: promptFilePath,
        jobId: job.id,
      });
    }
  }

  return promptSources;
}

function collectWorkflowJobSteps(job: IJob): IJobStep[] {
  if (!Array.isArray(job.steps)) {
    return [];
  }

  return job.steps;
}

function readInlinePrompt(step: IJobStep): string | null {
  const prompt = (step as { prompt?: unknown }).prompt;
  if (typeof prompt !== 'string') {
    return null;
  }

  const trimmed = prompt.trim();
  return trimmed.length > 0 ? prompt : null;
}

function resolvePromptFilePath(
  step: IJobStep,
  workflowsRoot: string,
): string | null {
  const promptFile = (step as { prompt_file?: unknown }).prompt_file;
  if (typeof promptFile !== 'string') {
    return null;
  }

  const trimmed = promptFile.trim();
  if (!trimmed) {
    return null;
  }

  const promptPath = path.join(workflowsRoot, trimmed);
  return fs.existsSync(promptPath) ? promptPath : null;
}

function collectStaticInvokeWorkflowTargets(job: IJob): string[] {
  if (job.type !== 'invoke_workflow') {
    return [];
  }

  const targets: string[] = [];
  const explicitTarget =
    typeof job.workflow_id === 'string' ? job.workflow_id.trim() : '';
  if (explicitTarget) {
    targets.push(explicitTarget);
  }

  const inputRecord =
    job.inputs && typeof job.inputs === 'object' ? job.inputs : null;
  const inputTarget =
    inputRecord && typeof inputRecord.workflow_id === 'string'
      ? inputRecord.workflow_id.trim()
      : '';
  if (inputTarget) {
    targets.push(inputTarget);
  }

  return targets;
}

function collectStaticRefs(job: IJob, key: 'model' | 'provider'): string[] {
  const inputRecord =
    job.inputs && typeof job.inputs === 'object' ? job.inputs : null;
  const value = inputRecord?.[key];
  if (typeof value !== 'string') {
    return [];
  }

  const normalized = value.trim();
  return normalized ? [normalized] : [];
}

function validateStaticRef(params: {
  workflow: ParsedWorkflowSeed;
  job: IJob;
  refs: string[];
  knownNames: Set<string>;
  experimental: boolean;
  codePrefix: string;
  label: string;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  for (const ref of params.refs) {
    if (!isLiteralReference(ref) || params.knownNames.has(ref)) {
      continue;
    }

    addIssue(params.experimental ? params.warnings : params.errors, {
      code: params.experimental
        ? `${params.codePrefix}-warning-experimental`
        : `${params.codePrefix}-missing`,
      filePath: params.workflow.filePath,
      workflowId: params.workflow.workflowId,
      message: `Job '${params.job.id}' references unknown ${params.label} '${ref}'`,
    });
  }
}

function validateWorkflowJob(params: {
  workflow: ParsedWorkflowSeed;
  job: IJob;
  workflowIds: Set<string>;
  agentMap: Map<string, ParsedAgentSeed>;
  modelNames: Set<string>;
  providerNames: Set<string>;
  knownToolNames: Set<string>;
  experimental: boolean;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  validateInvokeWorkflowTargets({
    workflow: params.workflow,
    job: params.job,
    workflowIds: params.workflowIds,
    errors: params.errors,
    warnings: params.warnings,
  });
  for (const reference of collectStaticAgentProfileRefs(params.job)) {
    validateAgentProfileReference({
      workflow: params.workflow,
      job: params.job,
      reference,
      agentMap: params.agentMap,
      experimental: params.experimental,
      errors: params.errors,
      warnings: params.warnings,
    });
  }
  const baseRef = {
    workflow: params.workflow,
    job: params.job,
    experimental: params.experimental,
    errors: params.errors,
    warnings: params.warnings,
  };
  validateStaticRef({
    ...baseRef,
    refs: collectStaticRefs(params.job, 'model'),
    knownNames: params.modelNames,
    codePrefix: 'workflow-model',
    label: 'LLM model',
  });
  validateStaticRef({
    ...baseRef,
    refs: collectStaticRefs(params.job, 'provider'),
    knownNames: params.providerNames,
    codePrefix: 'workflow-provider',
    label: 'LLM provider',
  });
  validateJobToolsForProfile({
    workflow: params.workflow,
    job: params.job,
    agentMap: params.agentMap,
    knownToolNames: params.knownToolNames,
    experimental: params.experimental,
    errors: params.errors,
    warnings: params.warnings,
  });
}

function validateInvokeWorkflowTargets(params: {
  workflow: ParsedWorkflowSeed;
  job: IJob;
  workflowIds: Set<string>;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  for (const target of collectStaticInvokeWorkflowTargets(params.job)) {
    if (!isLiteralReference(target)) {
      addIssue(params.warnings, {
        code: 'workflow-invoke-dynamic',
        filePath: params.workflow.filePath,
        workflowId: params.workflow.workflowId,
        message: `Job '${params.job.id}' uses dynamic invoke_workflow target '${target}'`,
      });
      continue;
    }

    if (!params.workflowIds.has(target)) {
      addIssue(params.errors, {
        code: 'workflow-invoke-target-missing',
        filePath: params.workflow.filePath,
        workflowId: params.workflow.workflowId,
        message: `Job '${params.job.id}' references missing workflow '${target}'`,
      });
    }
  }
}

function validateAgentProfileReference(params: {
  workflow: ParsedWorkflowSeed;
  job: IJob;
  reference: string;
  agentMap: Map<string, ParsedAgentSeed>;
  experimental: boolean;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  if (!isLiteralReference(params.reference)) {
    addIssue(params.warnings, {
      code: 'workflow-agent-profile-dynamic',
      filePath: params.workflow.filePath,
      workflowId: params.workflow.workflowId,
      message: `Job '${params.job.id}' uses dynamic agent_profile '${params.reference}'`,
    });
    return;
  }

  const agent = params.agentMap.get(params.reference);
  if (!agent) {
    addIssue(params.experimental ? params.warnings : params.errors, {
      code: params.experimental
        ? 'workflow-agent-profile-warning-experimental'
        : 'workflow-agent-profile-missing',
      filePath: params.workflow.filePath,
      workflowId: params.workflow.workflowId,
      message: `Job '${params.job.id}' references unknown agent profile '${params.reference}'`,
    });
    return;
  }

  if (!params.job.output_contract || agent.tools.includes('set_job_output')) {
    return;
  }

  addIssue(params.experimental ? params.warnings : params.errors, {
    code: params.experimental
      ? 'workflow-agent-missing-output-tool-warning'
      : 'workflow-agent-missing-output-tool',
    filePath: params.workflow.filePath,
    workflowId: params.workflow.workflowId,
    message: `Job '${params.job.id}' has output_contract but agent '${agent.name}' does not allow 'set_job_output'`,
  });
}

export function validateWorkflowCrossReferences(params: {
  parsedWorkflows: ParsedWorkflowSeed[];
  parsedAgents: ParsedAgentSeed[];
  modelNames: Set<string>;
  providerNames: Set<string>;
  knownToolNames: Set<string>;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  const workflowIds = new Set(
    params.parsedWorkflows.map((workflow) => workflow.workflowId),
  );
  const agentMap = new Map(
    params.parsedAgents.map((agent) => [agent.name, agent]),
  );

  for (const workflow of params.parsedWorkflows) {
    const experimental = isExperimentalWorkflow({
      workflowId: workflow.workflowId,
      filePath: workflow.filePath,
    });

    for (const job of workflow.parsed.jobs ?? []) {
      validateWorkflowJob({
        workflow,
        job,
        workflowIds,
        agentMap,
        modelNames: params.modelNames,
        providerNames: params.providerNames,
        knownToolNames: params.knownToolNames,
        experimental,
        errors: params.errors,
        warnings: params.warnings,
      });
    }
  }
}
