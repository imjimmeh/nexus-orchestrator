import { isRecord, type IJob } from '@nexus/core';
import { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import {
  CoreSpecialStepType,
  isReservedSpecialStepType,
  type SpecialStepHandlerLookup,
} from '../workflow-special-steps/step-special-step.types';
import {
  isNonEmptyString,
  isPositiveInteger,
} from './workflow-validation.guards';
import { validateExecutionSteps } from './workflow-validation.step-validators';
import {
  validateJobControlFieldsByRules,
  validateToolReferencesWithRegistry,
} from './workflow-validation.job-rules';
import { validateWebAutomationJob } from './workflow-validation.web-automation-validator';
import {
  ValidationCollector,
  ValidationContext,
} from './workflow-validation.types';

type KnownWorkflowJobType = 'execution' | CoreSpecialStepType;

export function readMcpToolNameFromJobInputs(inputs: unknown): string | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const toolName = (inputs as Record<string, unknown>).tool_name;
  return typeof toolName === 'string' && toolName.trim().length > 0
    ? toolName.trim()
    : null;
}

export function validateJobCollection(
  context: ValidationContext,
  collector: ValidationCollector,
): void {
  for (const [jobId, count] of context.jobIdCounts) {
    if (count > 1) {
      collector.add(`Duplicate job ID: ${jobId}`);
    }
  }

  for (const job of context.jobs) {
    if (!isNonEmptyString(job.id)) {
      collector.add('Job missing id');
      continue;
    }

    if (!isNonEmptyString(job.tier)) {
      collector.add(`Job '${job.id}' missing tier`);
    }

    validateJobControlFields(job, collector);
  }
}

interface JobTypeValidator {
  readonly type: KnownWorkflowJobType;
  validate(
    context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): Promise<void> | void;
}

class ExecutionJobValidator implements JobTypeValidator {
  readonly type = 'execution' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    if (
      job.max_step_loops !== undefined &&
      !isPositiveInteger(job.max_step_loops)
    ) {
      collector.add(
        `Job '${job.id}' max_step_loops must be a positive integer`,
      );
    }

    validateExecutionSteps(job, collector);
  }
}

class RegisterToolJobValidator implements JobTypeValidator {
  readonly type = 'register_tool' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const name = isRecord(job.inputs) ? job.inputs.name : undefined;
    const schema = isRecord(job.inputs) ? job.inputs.schema : undefined;
    const typescriptCode = isRecord(job.inputs)
      ? job.inputs.typescript_code
      : undefined;

    if (
      !isNonEmptyString(name) ||
      !isRecord(schema) ||
      !isNonEmptyString(typescriptCode)
    ) {
      collector.add(
        `Job '${job.id}' has type 'register_tool' but is missing one of inputs.name, inputs.schema, inputs.typescript_code`,
      );
    }
  }
}

class InvokeWorkflowJobValidator implements JobTypeValidator {
  readonly type = 'invoke_workflow' as const;

  validate(
    context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    let childWorkflowId: string | undefined;

    if (isNonEmptyString(job.workflow_id)) {
      childWorkflowId = job.workflow_id;
    } else if (
      isRecord(job.inputs) &&
      isNonEmptyString(job.inputs.workflow_id)
    ) {
      childWorkflowId = job.inputs.workflow_id;
    }

    if (!childWorkflowId) {
      collector.add(
        `Job '${job.id}' has type 'invoke_workflow' but is missing workflow_id`,
      );
      return;
    }

    if (childWorkflowId === context.definition.workflow_id) {
      collector.add(
        `Job '${job.id}' cannot invoke its own workflow '${context.definition.workflow_id}'`,
      );
    }
  }
}

class RunCommandJobValidator implements JobTypeValidator {
  readonly type = 'run_command' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const command = isRecord(job.inputs) ? job.inputs.command : undefined;
    if (!isNonEmptyString(command)) {
      collector.add(
        `Job '${job.id}' has type 'run_command' but is missing inputs.command`,
      );
    }
  }
}

class WebAutomationJobValidator implements JobTypeValidator {
  readonly type = 'web_automation' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    validateWebAutomationJob(job, collector);
  }
}

class EmitEventJobValidator implements JobTypeValidator {
  readonly type = 'emit_event' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const eventName = isRecord(job.inputs) ? job.inputs.event_name : undefined;
    if (!isNonEmptyString(eventName)) {
      collector.add(
        `Job '${job.id}' has type 'emit_event' but is missing inputs.event_name`,
      );
    }
  }
}

class HttpWebhookJobValidator implements JobTypeValidator {
  readonly type = 'http_webhook' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const inputs = isRecord(job.inputs) ? job.inputs : undefined;
    const policy = isRecord(inputs?.policy) ? inputs.policy : undefined;
    const url = inputs?.url;

    if (!isNonEmptyString(url)) {
      collector.add(
        `Job '${job.id}' has type 'http_webhook' but is missing inputs.url`,
      );
    }

    if (!isNonEmptyStringArray(policy?.allowed_urls)) {
      collector.add(
        `Job '${job.id}' has type 'http_webhook' but is missing inputs.policy.allowed_urls`,
      );
    }

    const method = inputs?.method;
    if (method !== undefined && !isNonEmptyString(method)) {
      collector.add(
        `Job '${job.id}' has type 'http_webhook' but inputs.method must be a non-empty string`,
      );
    }
  }
}

class McpToolCallJobValidator implements JobTypeValidator {
  readonly type = 'mcp_tool_call' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const inputs = isRecord(job.inputs) ? job.inputs : undefined;
    const policy = isRecord(inputs?.policy) ? inputs.policy : undefined;

    if (!isNonEmptyString(inputs?.server_id)) {
      collector.add(
        `Job '${job.id}' has type 'mcp_tool_call' but is missing inputs.server_id`,
      );
    }

    if (!isNonEmptyString(inputs?.tool_name)) {
      collector.add(
        `Job '${job.id}' has type 'mcp_tool_call' but is missing inputs.tool_name`,
      );
    }

    if (!isNonEmptyStringArray(policy?.allowed_servers)) {
      collector.add(
        `Job '${job.id}' has type 'mcp_tool_call' but is missing inputs.policy.allowed_servers`,
      );
    }

    if (!isNonEmptyStringArray(policy?.allowed_tools)) {
      collector.add(
        `Job '${job.id}' has type 'mcp_tool_call' but is missing inputs.policy.allowed_tools`,
      );
    }
  }
}

function isNonEmptyStringArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

class GitOperationJobValidator implements JobTypeValidator {
  readonly type = 'git_operation' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const inputs = isRecord(job.inputs) ? job.inputs : {};
    const action = inputs.action;
    if (!isNonEmptyString(action)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.action`,
      );
      return;
    }

    const repositoryId = inputs.repository_id;
    if (!isNonEmptyString(repositoryId)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.repository_id`,
      );
    }

    if (requiresWorktreeId(action) && !isNonEmptyString(inputs.worktree_id)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.worktree_id`,
      );
    }

    if (action === 'create_branch' && !isNonEmptyString(inputs.branch_name)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.branch_name`,
      );
    }

    if (action === 'commit_paths' && !isNonEmptyStringArray(inputs.paths)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.paths`,
      );
    }

    if (action === 'commit_paths' && !isNonEmptyString(inputs.message)) {
      collector.add(
        `Job '${job.id}' has type 'git_operation' but is missing inputs.message`,
      );
    }
  }
}

function requiresWorktreeId(action: string): boolean {
  return ['merge', 'provision_worktree', 'remove_worktree'].includes(action);
}

class ManageToolCandidateJobValidator implements JobTypeValidator {
  readonly type = 'manage_tool_candidate' as const;

  validate(
    _context: ValidationContext,
    job: IJob,
    collector: ValidationCollector,
  ): void {
    const action = isRecord(job.inputs) ? job.inputs.action : undefined;
    const artifactId = isRecord(job.inputs)
      ? job.inputs.artifact_id
      : undefined;

    if (!isNonEmptyString(action)) {
      collector.add(
        `Job '${job.id}' has type 'manage_tool_candidate' but is missing inputs.action`,
      );
    }

    if (!isNonEmptyString(artifactId)) {
      collector.add(
        `Job '${job.id}' has type 'manage_tool_candidate' but is missing inputs.artifact_id`,
      );
    }
  }
}

function createJobTypeValidators(): Record<
  KnownWorkflowJobType,
  JobTypeValidator
> {
  const validators: JobTypeValidator[] = [
    new ExecutionJobValidator(),
    new RegisterToolJobValidator(),
    new InvokeWorkflowJobValidator(),
    new RunCommandJobValidator(),
    new WebAutomationJobValidator(),
    new EmitEventJobValidator(),
    new HttpWebhookJobValidator(),
    new McpToolCallJobValidator(),
    new GitOperationJobValidator(),
    new ManageToolCandidateJobValidator(),
  ];

  const record = {} as Record<KnownWorkflowJobType, JobTypeValidator>;
  for (const validator of validators) {
    record[validator.type] = validator;
  }

  return record;
}

const JOB_TYPE_VALIDATORS = createJobTypeValidators();

function isKnownJobType(type: string): type is KnownWorkflowJobType {
  return Object.hasOwn(JOB_TYPE_VALIDATORS, type);
}

async function validateJobType(
  context: ValidationContext,
  job: IJob,
  collector: ValidationCollector,
  specialStepRegistry: SpecialStepHandlerLookup,
): Promise<void> {
  const jobRecord = job as unknown as Record<string, unknown>;
  const jobTypeValue = jobRecord.type;

  if (jobTypeValue === undefined) {
    collector.add(`Job '${job.id}' missing type`);
    return;
  }

  if (typeof jobTypeValue !== 'string') {
    const serialized = JSON.stringify(jobTypeValue);
    collector.add(
      `Job '${job.id}' has unsupported type '${serialized ?? '[unserializable]'}'`,
    );
    return;
  }

  if (!isKnownJobType(jobTypeValue)) {
    if (isReservedSpecialStepType(jobTypeValue)) {
      collector.add(`Job '${job.id}' has unsupported type '${jobTypeValue}'`);
      return;
    }

    if (specialStepRegistry.getHandler(jobTypeValue)) {
      return;
    }

    collector.add(`Job '${job.id}' has unsupported type '${jobTypeValue}'`);
    return;
  }

  await JOB_TYPE_VALIDATORS[jobTypeValue].validate(context, job, collector);
}

export async function validateJobTypes(
  context: ValidationContext,
  collector: ValidationCollector,
  specialStepRegistry: SpecialStepHandlerLookup,
): Promise<void> {
  for (const job of context.jobs) {
    if (!isNonEmptyString(job.id)) {
      continue;
    }

    await validateJobType(context, job, collector, specialStepRegistry);
  }
}

export async function validateToolReferences(
  context: ValidationContext,
  collector: ValidationCollector,
  toolRegistryRepo: ToolRegistryRepository,
): Promise<void> {
  await validateToolReferencesWithRegistry(
    context,
    collector,
    toolRegistryRepo,
  );
}

function validateJobControlFields(
  job: IJob,
  collector: ValidationCollector,
): void {
  validateJobControlFieldsByRules(job, collector);
}
