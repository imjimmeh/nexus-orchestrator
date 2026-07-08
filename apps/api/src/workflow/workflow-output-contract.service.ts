import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  isRecord,
  type OutputContract,
  type OutputContractType,
  type OutputContractTypeSchema,
} from '@nexus/core';
import { StateManagerService } from './state-manager.service';
import type {
  OutputContractValidationResult,
  OutputContractTypeMismatch,
  OutputContractReconciliationMismatch,
} from './workflow-output-contract.types';
import {
  findOutputContractTypeMismatch,
  isOutputContractType,
} from './workflow-output-contract-type.helpers';
import { TOOL_EXECUTION_COUNTER } from './tool-execution-counter.tokens';
import type { IToolExecutionCounter } from './tool-execution-counter.types';

const SET_JOB_OUTPUT_DATA_ARGUMENT_INSTRUCTION =
  'Call set_job_output with the tool argument data set to a plain object containing all required fields. Never nest another data key inside data.';

@Injectable()
export class WorkflowOutputContractService {
  private readonly logger = new Logger(WorkflowOutputContractService.name);

  constructor(
    private readonly stateManager: StateManagerService,
    @Inject(TOOL_EXECUTION_COUNTER)
    private readonly toolExecutionCounter: IToolExecutionCounter,
  ) {}

  async validateOutputContract(
    workflowRunId: string,
    jobId: string,
    contract: OutputContract,
  ): Promise<OutputContractValidationResult> {
    const stateKey = `jobs.${jobId}.output`;
    const output = await this.stateManager.getVariable(workflowRunId, stateKey);

    if (output === null || output === undefined) {
      this.logger.debug(
        `Job ${jobId}: output_contract check — no output captured yet, missing: ${contract.required.join(', ')}`,
      );
      return {
        valid: false,
        missing: [...contract.required],
        invalid: [],
        reconciliation: [],
      };
    }

    const outputRecord =
      typeof output === 'object' && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : {};

    const { missing, invalid } = this.validateShape(contract, outputRecord);

    // Reconcile reported counts against tool calls the agent actually made, but
    // only once the output shape is sound — there is nothing to reconcile while
    // required fields are missing or mistyped.
    const reconciliation =
      missing.length === 0 && invalid.length === 0
        ? await this.reconcileToolCounts(
            workflowRunId,
            jobId,
            contract,
            outputRecord,
          )
        : [];

    this.logValidationOutcome(jobId, missing, invalid, reconciliation);

    return {
      valid:
        missing.length === 0 &&
        invalid.length === 0 &&
        reconciliation.length === 0,
      missing,
      invalid,
      reconciliation,
    };
  }

  private validateShape(
    contract: OutputContract,
    outputRecord: Record<string, unknown>,
  ): { missing: string[]; invalid: OutputContractTypeMismatch[] } {
    const missing = contract.required.filter((key) => {
      if (!(key in outputRecord)) {
        return true;
      }
      const value = outputRecord[key];
      if (value === null || value === undefined) {
        return true;
      }
      // A required field submitted as an empty string/array/object satisfies
      // the type check ("" is a string, [] is an array) but carries no real
      // content — treat it the same as an absent field so the retry path
      // (job.output_contract.missing / retry_prompt) fires instead of
      // silently accepting a hollow value. A value whose runtime type does
      // not even match the declared type is left to the `invalid` type-
      // mismatch check below, not double-counted here as missing.
      return this.isEmptyOfDeclaredType(value, contract.types?.[key]);
    });

    const invalid: OutputContractTypeMismatch[] = [];
    for (const [field, schema] of Object.entries(contract.types ?? {})) {
      const value = outputRecord[field];
      if (value === null || value === undefined || !(field in outputRecord)) {
        continue;
      }
      const mismatch = findOutputContractTypeMismatch(value, schema, field);
      if (mismatch) {
        invalid.push(mismatch);
      }
    }

    return { missing, invalid };
  }

  /**
   * A required field present as an empty string, empty array, or empty
   * object matches its declared scalar/container type (e.g. `""` is a valid
   * `string`) but has no real content. Numbers, booleans, and non-empty
   * containers are left alone — only the empty-of-declared-type case is
   * treated as unsatisfied. When the submitted value's runtime shape does
   * not match the declared `schema` at all (e.g. a string where an array
   * was declared), this reports "not empty" — that mismatch is a job for
   * the `invalid` type-mismatch check, not this one.
   */
  private isEmptyOfDeclaredType(
    value: unknown,
    schema?: OutputContractTypeSchema,
  ): boolean {
    const declaredType = this.resolveDeclaredScalarType(schema);

    if (declaredType === 'string') {
      return typeof value === 'string' && value.length === 0;
    }
    if (declaredType === 'array') {
      return Array.isArray(value) && value.length === 0;
    }
    if (declaredType === 'object') {
      return isRecord(value) && Object.keys(value).length === 0;
    }
    if (declaredType !== undefined) {
      // A declared scalar type with no notion of "empty" (number, integer,
      // boolean) — never unsatisfied on emptiness grounds.
      return false;
    }

    // No declared type for this field: fall back to the value's own runtime
    // shape so an undeclared-but-required field still gets the same
    // empty-content protection.
    if (typeof value === 'string') {
      return value.length === 0;
    }
    if (Array.isArray(value)) {
      return value.length === 0;
    }
    if (isRecord(value)) {
      return Object.keys(value).length === 0;
    }
    return false;
  }

  private resolveDeclaredScalarType(
    schema: OutputContractTypeSchema | undefined,
  ): OutputContractType | undefined {
    if (schema === undefined) {
      return undefined;
    }
    return isOutputContractType(schema) ? schema : schema.type;
  }

  private logValidationOutcome(
    jobId: string,
    missing: string[],
    invalid: OutputContractTypeMismatch[],
    reconciliation: OutputContractReconciliationMismatch[],
  ): void {
    if (missing.length > 0) {
      this.logger.debug(
        `Job ${jobId}: output_contract check — missing fields: ${missing.join(', ')}`,
      );
    }
    if (invalid.length > 0) {
      this.logger.debug(
        `Job ${jobId}: output_contract check — type mismatches: ${invalid
          .map((m) => `${m.field} (expected ${m.expected}, got ${m.actual})`)
          .join(', ')}`,
      );
    }
    if (reconciliation.length > 0) {
      this.logger.warn(
        `Job ${jobId}: output_contract check — reconciliation mismatches: ${reconciliation
          .map(
            (m) =>
              `${m.field} reported ${m.reported} but ${m.tool} succeeded ${m.actual} time(s)`,
          )
          .join(', ')}`,
      );
    }
  }

  private async reconcileToolCounts(
    workflowRunId: string,
    jobId: string,
    contract: OutputContract,
    outputRecord: Record<string, unknown>,
  ): Promise<OutputContractReconciliationMismatch[]> {
    if (!contract.reconcile || contract.reconcile.length === 0) {
      return [];
    }

    const mismatches: OutputContractReconciliationMismatch[] = [];
    for (const rule of contract.reconcile) {
      const reportedValue = outputRecord[rule.field];
      // A non-numeric reported value is a type concern, not a reconciliation
      // one; the types contract is responsible for catching it.
      if (typeof reportedValue !== 'number') {
        continue;
      }

      const actual =
        await this.toolExecutionCounter.countSuccessfulToolExecutions({
          workflowRunId,
          jobId,
          toolName: rule.tool,
        });

      if (reportedValue !== actual) {
        mismatches.push({
          field: rule.field,
          tool: rule.tool,
          reported: reportedValue,
          actual,
        });
      }
    }

    return mismatches;
  }

  buildDefaultRetryPrompt(missing: string[]): string {
    return (
      `Your job output is incomplete. Use the set_job_output tool to provide the following required fields: ` +
      `${missing.join(', ')}. ` +
      SET_JOB_OUTPUT_DATA_ARGUMENT_INSTRUCTION
    );
  }

  buildRetryPrompt(
    missing: string[],
    invalid: OutputContractTypeMismatch[],
    reconciliation: OutputContractReconciliationMismatch[] = [],
  ): string {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(`missing fields: ${missing.join(', ')}`);
    }
    if (invalid.length > 0) {
      parts.push(
        `fields with wrong type: ${invalid
          .map((m) => `${m.field} (expected ${m.expected}, got ${m.actual})`)
          .join(', ')}`,
      );
    }
    if (reconciliation.length > 0) {
      parts.push(
        `reported counts that do not match the work you actually performed: ${reconciliation
          .map(
            (m) =>
              `${m.field}=${m.reported} but '${m.tool}' only succeeded ${m.actual} time(s)`,
          )
          .join(
            ', ',
          )}. Actually call the tool for every item you report, then report the true count`,
      );
    }
    return (
      `Your job output is incomplete or malformed. ${SET_JOB_OUTPUT_DATA_ARGUMENT_INSTRUCTION} ` +
      parts.join('; ')
    );
  }
}
