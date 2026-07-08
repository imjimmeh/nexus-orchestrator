import {
  IJob,
  isRecord,
  SDK_NATIVE_TOOL_NAMES,
  WorkflowSwitchCase,
} from '@nexus/core';
import { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import { isOutputContractTypeSchema } from '../workflow-output-contract-type.helpers';
import { ToolchainValidationError } from '../workflow-runtime-toolchains/toolchain-validation';
import {
  isNonEmptyString,
  isNonNegativeInteger,
} from './workflow-validation.guards';
import { parseStepRuntimeToolchainConfig } from './workflow-validation.runtime-toolchains';
import {
  ValidationCollector,
  ValidationContext,
} from './workflow-validation.types';

const SDK_NATIVE_TOOL_NAME_SET = new Set<string>(SDK_NATIVE_TOOL_NAMES);

export function collectJobOutputReferences(value: unknown): string[] {
  if (typeof value === 'string') {
    return [
      ...value.matchAll(/jobs\.([a-zA-Z0-9_-]+)\.output\.([a-zA-Z0-9_.-]+)/gu),
    ].map((match) => `${match[1]}.${match[2]}`);
  }

  if (Array.isArray(value)) return value.flatMap(collectJobOutputReferences);

  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectJobOutputReferences);
  }

  return [];
}

export async function validateToolReferencesWithRegistry(
  context: ValidationContext,
  collector: ValidationCollector,
  toolRegistryRepo: ToolRegistryRepository,
): Promise<void> {
  const jobsByToolName = collectJobsByToolName(context.jobs, collector);
  await primeToolExistsCache(context, toolRegistryRepo, [
    ...jobsByToolName.keys(),
  ]);
  reportUnknownToolReferences(context, jobsByToolName, collector);
}

export function validateJobControlFieldsByRules(
  job: IJob,
  collector: ValidationCollector,
): void {
  validateDeprecatedLegacyFields(job, collector);
  validateOutputContract(job, collector);
  validateMaxRetries(job, collector);
  validateRetryPrompt(job, collector);
  validateSwitchAndLoopFields(job, collector);
  validateRuntimeToolchainInputs(job, collector);
}

/**
 * Validates `job.inputs.{toolchains, apt_packages, caches, disable_caches}`
 * at author/publish time via the shared {@link parseStepRuntimeToolchainConfig}
 * parser, so an invalid toolchain request (unsupported tool, malformed
 * version, etc.) fails workflow validation instead of only surfacing later
 * when the step-execution container provisioning path parses the same
 * inputs (see `step-agent-container-provisioning.helpers.ts`).
 */
function validateRuntimeToolchainInputs(
  job: IJob,
  collector: ValidationCollector,
): void {
  try {
    parseStepRuntimeToolchainConfig(job.inputs);
  } catch (error) {
    if (error instanceof ToolchainValidationError) {
      collector.add(
        `Job '${job.id}' has an invalid runtime toolchain configuration: ${error.message}`,
      );
      return;
    }

    throw error;
  }
}

function validateDeprecatedLegacyFields(
  job: IJob,
  collector: ValidationCollector,
): void {
  const rawJob = job as unknown as Record<string, unknown>;

  if (Object.hasOwn(rawJob, 'output_tool')) {
    collector.add(
      `Job '${job.id}' uses deprecated field 'output_tool'; use output_contract + set_job_output instead`,
    );
  }

  if (Object.hasOwn(rawJob, 'required_tool_calls')) {
    collector.add(
      `Job '${job.id}' uses deprecated field 'required_tool_calls'; use output_contract + set_job_output instead`,
    );
  }
}

function validateOutputContract(
  job: IJob,
  collector: ValidationCollector,
): void {
  const contract = job.output_contract;
  if (contract === undefined) {
    return;
  }

  if (!isRequiredContractShapeValid(contract)) {
    collector.add(
      `Job '${job.id}' output_contract.required must be a non-empty array`,
    );
    return;
  }

  for (const field of contract.required) {
    if (!isNonEmptyString(field)) {
      collector.add(
        `Job '${job.id}' output_contract.required contains invalid entry`,
      );
    }
  }

  validateOptionalOutputContractFields(job.id, contract.optional, collector);
  validateOutputContractTypes(job.id, contract, collector);
}

function validateSwitchAndLoopFields(
  job: IJob,
  collector: ValidationCollector,
): void {
  validateSwitch(job, collector);
  validateDefaultBranch(job, collector);
  validateForEach(job, collector);

  validateMappingsInInputs(job.id, job.inputs, collector);
}

function validateSwitch(job: IJob, collector: ValidationCollector): void {
  if (job.switch === undefined) {
    return;
  }

  if (!Array.isArray(job.switch) || job.switch.length === 0) {
    collector.add(`Job '${job.id}' switch must be a non-empty array`);
    return;
  }

  for (const [index, branch] of job.switch.entries()) {
    validateSwitchBranch(job.id, branch, index, collector);
  }
}

function validateSwitchBranch(
  jobId: string,
  branch: WorkflowSwitchCase | undefined,
  index: number,
  collector: ValidationCollector,
): void {
  if (!branch || !isNonEmptyString(branch.case)) {
    collector.add(`Job '${jobId}' switch[${index}].case must be a string`);
    return;
  }

  if (branch.inputs !== undefined && typeof branch.inputs !== 'object') {
    collector.add(`Job '${jobId}' switch[${index}].inputs must be an object`);
  }
}

function validateDefaultBranch(
  job: IJob,
  collector: ValidationCollector,
): void {
  if (job.default === undefined) {
    return;
  }

  if (job.switch === undefined) {
    collector.add(`Job '${job.id}' default requires switch to be set`);
  }

  if (
    job.default?.inputs !== undefined &&
    typeof job.default.inputs !== 'object'
  ) {
    collector.add(`Job '${job.id}' default.inputs must be an object`);
  }
}

function validateForEach(job: IJob, collector: ValidationCollector): void {
  if (job.for_each !== undefined && !isNonEmptyString(job.for_each)) {
    collector.add(
      `Job '${job.id}' for_each must be a non-empty template string`,
    );
  }

  if (job.continue_on_error === true && job.for_each === undefined) {
    collector.add(
      `Job '${job.id}' continue_on_error is only valid with for_each`,
    );
  }
}

function validateMappingsInInputs(
  jobId: string,
  value: unknown,
  collector: ValidationCollector,
  path = 'inputs',
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateMappingsInInputs(jobId, item, collector, `${path}[${index}]`);
    });
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;
  validateMappingRecord(jobId, record, collector, path);

  for (const [key, nested] of Object.entries(record)) {
    validateMappingsInInputs(jobId, nested, collector, `${path}.${key}`);
  }
}

function isRequiredContractShapeValid(
  contract: IJob['output_contract'],
): contract is NonNullable<IJob['output_contract']> {
  return (
    !!contract &&
    Array.isArray(contract.required) &&
    contract.required.length > 0
  );
}

function validateOptionalOutputContractFields(
  jobId: string,
  optionalFields: unknown,
  collector: ValidationCollector,
): void {
  if (optionalFields === undefined) {
    return;
  }

  if (!Array.isArray(optionalFields)) {
    collector.add(`Job '${jobId}' output_contract.optional must be an array`);
    return;
  }

  for (const field of optionalFields) {
    if (!isNonEmptyString(field)) {
      collector.add(
        `Job '${jobId}' output_contract.optional contains invalid entry`,
      );
    }
  }
}

function validateOutputContractTypes(
  jobId: string,
  contract: NonNullable<IJob['output_contract']>,
  collector: ValidationCollector,
): void {
  if (contract.types === undefined) {
    return;
  }

  if (!isRecord(contract.types)) {
    collector.add(`Job '${jobId}' output_contract.types must be an object`);
    return;
  }

  const declaredFields = new Set([
    ...(contract.required ?? []),
    ...(contract.optional ?? []),
  ]);

  for (const [field, type] of Object.entries(contract.types)) {
    if (field.trim().length === 0) {
      collector.add(
        `Job '${jobId}' output_contract.types contains invalid field name`,
      );
      continue;
    }

    if (!isOutputContractTypeSchema(type)) {
      collector.add(
        `Job '${jobId}' output_contract.types.${field} must be a valid output contract type`,
      );
      continue;
    }

    if (!declaredFields.has(field)) {
      collector.add(
        `Job '${jobId}' output_contract.types.${field} references field not declared in required/optional`,
      );
    }
  }
}

function validateMappingRecord(
  jobId: string,
  record: Record<string, unknown>,
  collector: ValidationCollector,
  path: string,
): void {
  if (!Object.hasOwn(record, 'source') || !Object.hasOwn(record, 'mapping')) {
    return;
  }

  if (!isNonEmptyString(record.source)) {
    collector.add(`Job '${jobId}' ${path}.source must be a non-empty string`);
  }

  const mapping = record.mapping;
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    collector.add(`Job '${jobId}' ${path}.mapping must be an object`);
  }
}

function collectJobsByToolName(
  jobs: IJob[],
  collector: ValidationCollector,
): Map<string, string[]> {
  const jobsByToolName = new Map<string, string[]>();

  for (const job of jobs) {
    if (!isNonEmptyString(job.id) || job.tools === undefined) {
      continue;
    }

    if (!Array.isArray(job.tools)) {
      collector.add(`Job '${job.id}' tools must be an array`);
      continue;
    }

    for (const toolName of job.tools) {
      if (!isNonEmptyString(toolName)) {
        collector.add(`Job '${job.id}' tools contains invalid entry`);
        continue;
      }

      const jobIds = jobsByToolName.get(toolName) ?? [];
      jobIds.push(job.id);
      jobsByToolName.set(toolName, jobIds);
    }
  }

  return jobsByToolName;
}

async function primeToolExistsCache(
  context: ValidationContext,
  toolRegistryRepo: ToolRegistryRepository,
  toolNames: string[],
): Promise<void> {
  await Promise.all(
    toolNames.map(async (toolName) => {
      if (isSdkNativeTool(toolName)) {
        context.toolExistsCache.set(toolName, true);
        return;
      }

      if (!context.toolExistsCache.has(toolName)) {
        const tool = await toolRegistryRepo.findByName(toolName);
        context.toolExistsCache.set(toolName, Boolean(tool));
      }
    }),
  );
}

function isSdkNativeTool(toolName: string): boolean {
  return SDK_NATIVE_TOOL_NAME_SET.has(toolName);
}

function reportUnknownToolReferences(
  context: ValidationContext,
  jobsByToolName: Map<string, string[]>,
  collector: ValidationCollector,
): void {
  for (const [toolName, jobIds] of jobsByToolName) {
    if (context.toolExistsCache.get(toolName)) {
      continue;
    }

    for (const jobId of new Set(jobIds)) {
      collector.add(`Job '${jobId}' references unknown tool '${toolName}'`);
    }
  }
}

function validateMaxRetries(job: IJob, collector: ValidationCollector): void {
  if (job.max_retries !== undefined && !isNonNegativeInteger(job.max_retries)) {
    collector.add(`Job '${job.id}' max_retries must be a non-negative integer`);
  }
}

function validateRetryPrompt(job: IJob, collector: ValidationCollector): void {
  if (job.retry_prompt !== undefined && !isNonEmptyString(job.retry_prompt)) {
    collector.add(`Job '${job.id}' retry_prompt must be a non-empty string`);
  }
}
