import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { isRecord, type OutputContract } from '@nexus/core';
import { isDeepStrictEqual } from 'node:util';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { StateManagerService } from '../state-manager.service';
import {
  containsXmlArrayArtifact,
  normalizeXmlArrayArtifacts,
} from '../xml-array-artifact.helpers';
import { findOutputContractTypeMismatch } from '../workflow-output-contract-type.helpers';
import { JobOutputContractResolverService } from './job-output-contract-resolver.service';
import { WorkflowRuntimeTerminalRunGuardService } from './workflow-runtime-terminal-run-guard.service';

/**
 * Durable ledger signal emitted immediately after a job's structured output is
 * atomically persisted. The execution supervisor reads this (together with
 * wall-clock quiescence) to reconcile a `workflow_step` whose agent finished and
 * produced output but whose in-process completion was orphaned — e.g. an API
 * restart between the output write and the `workflow.agent.completed` telemetry
 * event. The deliverable (the output) and this signal land within the same
 * handler, so a crash can no longer separate "output produced" from "agent done".
 */
const OUTPUT_PERSISTED_EVENT_NAME = 'workflow.agent.output_persisted';

const RESERVED_OUTPUT_KEYS = new Set([
  'workflow_run_id',
  'workflowRunId',
  'job_id',
  'jobId',
  'step_id',
  'stepId',
  'session_id',
  'sessionId',
  'current_job_id',
  'currentJobId',
]);

@Injectable()
export class WorkflowRuntimeSetJobOutputService {
  private readonly logger = new Logger(WorkflowRuntimeSetJobOutputService.name);

  constructor(
    private readonly stateManager: StateManagerService,
    private readonly eventLedger: EventLedgerService,
    private readonly terminalRunGuard: WorkflowRuntimeTerminalRunGuardService,
    private readonly contractResolver: JobOutputContractResolverService,
  ) {}

  /**
   * Persist structured output data for a job. Multiple calls merge (last-write-wins per key).
   * The data becomes available to downstream jobs via template substitution at jobs.{jobId}.output.
   */
  async setJobOutput(
    workflowRunId: string,
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.assertOutputWriteAllowed(workflowRunId, jobId);

    if (!isRecord(data)) {
      await this.eventLedger.emitBestEffort({
        domain: 'workflow',
        eventName: 'workflow.runtime.set_job_output.rejected',
        outcome: 'denied',
        workflowRunId,
        jobId,
        toolName: 'set_job_output',
        errorCode: 'set_job_output_invalid_data',
        errorMessage:
          "set_job_output requires 'data' to be a non-null object payload.",
      });

      throw new BadRequestException(
        "set_job_output requires 'data' to be a non-null object payload.",
      );
    }

    const normalizedData = await this.normalizeXmlArrayArtifacts(
      workflowRunId,
      jobId,
      data,
    );

    const hydrationSummaryError = this.validateHydrationSummary(normalizedData);
    if (hydrationSummaryError) {
      await this.eventLedger.emitBestEffort({
        domain: 'workflow',
        eventName: 'workflow.runtime.set_job_output.rejected',
        outcome: 'denied',
        workflowRunId,
        jobId,
        toolName: 'set_job_output',
        errorCode: 'set_job_output_fabricated_hydration_summary',
        errorMessage: hydrationSummaryError,
      });

      throw new BadRequestException(hydrationSummaryError);
    }

    const reservedKeys = Object.keys(normalizedData).filter((key) =>
      RESERVED_OUTPUT_KEYS.has(key),
    );

    if (reservedKeys.length > 0) {
      await this.eventLedger.emitBestEffort({
        domain: 'workflow',
        eventName: 'workflow.runtime.set_job_output.rejected',
        outcome: 'denied',
        workflowRunId,
        jobId,
        toolName: 'set_job_output',
        errorCode: 'set_job_output_reserved_keys',
        errorMessage: `Reserved keys are not allowed in set_job_output data: ${reservedKeys.join(', ')}`,
        payload: {
          reserved_keys: reservedKeys,
        },
      });

      throw new BadRequestException(
        `set_job_output data contains reserved keys: ${reservedKeys.join(', ')}`,
      );
    }

    const contractTypeError = await this.findContractTypeError(
      workflowRunId,
      jobId,
      normalizedData,
    );
    if (contractTypeError) {
      await this.eventLedger.emitBestEffort({
        domain: 'workflow',
        eventName: 'workflow.runtime.set_job_output.rejected',
        outcome: 'denied',
        workflowRunId,
        jobId,
        toolName: 'set_job_output',
        errorCode: 'set_job_output_type_mismatch',
        errorMessage: contractTypeError,
      });
      throw new BadRequestException(contractTypeError);
    }

    const stateKey = `jobs.${jobId}.output`;

    const existing = await this.stateManager.getVariable(
      workflowRunId,
      stateKey,
    );

    const existingRecord =
      existing !== null &&
      existing !== undefined &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};

    const merged = { ...existingRecord, ...normalizedData };

    if (isDeepStrictEqual(existingRecord, merged)) {
      this.logger.debug(
        `Job ${jobId} run ${workflowRunId}: set_job_output is a no-op (no field changes)`,
      );
      return;
    }

    await this.stateManager.setVariable(workflowRunId, stateKey, merged);

    this.logger.log(
      `Job ${jobId} run ${workflowRunId}: set_job_output persisted ${Object.keys(normalizedData).join(', ')}`,
    );

    // Durable completion-candidate signal emitted alongside the persisted
    // deliverable. `stepId` is set to `jobId` to match the supervisor's
    // ledger-reader convention (step_id == jobId == execution.context_id).
    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: OUTPUT_PERSISTED_EVENT_NAME,
      outcome: 'success',
      source: 'runtime',
      actorType: 'agent',
      workflowRunId,
      jobId,
      stepId: jobId,
      toolName: 'set_job_output',
      payload: { fields: Object.keys(merged) },
    });
  }

  /**
   * Unwraps XML-array tool-call artifacts (sole-key `{ item: [...] }` objects)
   * emitted by some providers (notably MiniMax). Telemetry is emitted only when
   * the payload actually contained an artifact, so we can observe which
   * provider/job produces malformed structured output.
   */
  private async normalizeXmlArrayArtifacts(
    workflowRunId: string,
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!containsXmlArrayArtifact(data)) {
      return data;
    }

    const normalized = normalizeXmlArrayArtifacts(data) as Record<
      string,
      unknown
    >;

    this.logger.warn(
      `Job ${jobId} run ${workflowRunId}: normalized XML-array {item:[...]} artifact in set_job_output payload`,
    );

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: 'workflow.runtime.set_job_output.normalized_xml_artifact',
      outcome: 'success',
      severity: 'warn',
      workflowRunId,
      jobId,
      toolName: 'set_job_output',
    });

    return normalized;
  }

  /**
   * Validate the declared fields present in this set_job_output call against
   * the job's output_contract: both their TYPE (when a `types` schema entry
   * exists) and their emptiness (when the field is declared at all, via
   * `required` or `types`). Returns a human-actionable message on the first
   * violation, or null when the contract is absent or all provided fields are
   * well-typed and non-empty. Missing required fields are intentionally NOT
   * enforced here — that remains the post-turn output-contract check, so
   * incremental (partial) set_job_output writes keep working.
   */
  private async findContractTypeError(
    workflowRunId: string,
    jobId: string,
    data: Record<string, unknown>,
  ): Promise<string | null> {
    const contract = await this.contractResolver.resolveContract(
      workflowRunId,
      jobId,
    );
    if (!contract) {
      return null;
    }

    const emptyFieldError = this.findDeclaredEmptyFieldError(contract, data);
    if (emptyFieldError) {
      return emptyFieldError;
    }

    if (!contract.types) {
      return null;
    }
    for (const [field, schema] of Object.entries(contract.types)) {
      if (
        !(field in data) ||
        data[field] === null ||
        data[field] === undefined
      ) {
        continue;
      }
      const mismatch = findOutputContractTypeMismatch(
        data[field],
        schema,
        field,
      );
      if (mismatch) {
        return (
          `set_job_output field '${mismatch.field}' has the wrong type ` +
          `(expected ${mismatch.expected}, got ${mismatch.actual}). ` +
          `Provide '${field}' with the declared shape and call set_job_output again.`
        );
      }
    }
    return null;
  }

  /**
   * Rejects a field that is declared `required` by the contract but was
   * submitted as an empty string, empty array, or empty object. The
   * output_contract's type check alone accepts these — an empty string
   * satisfies `type: "string"` — so a provider that emits garbage (e.g.
   * `implementation_plan: ""`) currently persists it as if it were real
   * data, silently defeating the contract. This runs on the
   * already-normalized data (after MiniMax XML-array unwrapping), so a
   * single-element XML-array artifact that normalizes into a one-item array
   * is correctly treated as non-empty.
   *
   * Only `required` fields are checked here — a field that is merely
   * declared in `types` (e.g. an `optional` field with a type annotation)
   * is legitimately allowed to be empty. This mirrors the scope of
   * `WorkflowOutputContractService.validateShape`, which also only enforces
   * emptiness on `required` fields.
   */
  private findDeclaredEmptyFieldError(
    contract: OutputContract,
    data: Record<string, unknown>,
  ): string | null {
    const declaredFields = new Set<string>(contract.required ?? []);

    for (const field of declaredFields) {
      if (
        !(field in data) ||
        data[field] === null ||
        data[field] === undefined
      ) {
        continue;
      }
      const value = data[field];
      if (!this.isDeclaredEmptyValue(value)) {
        continue;
      }
      return (
        `set_job_output field '${field}' is declared but was empty. ` +
        `Provide a non-empty value for '${field}' and call set_job_output again.`
      );
    }
    return null;
  }

  private isDeclaredEmptyValue(value: unknown): boolean {
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

  private async assertOutputWriteAllowed(
    workflowRunId: string,
    jobId: string,
  ): Promise<void> {
    try {
      await this.terminalRunGuard.assertRunIsActive(workflowRunId, {
        action: 'set_job_output',
        jobId,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        await this.eventLedger.emitBestEffort({
          domain: 'workflow',
          eventName: 'workflow.runtime.set_job_output.rejected',
          outcome: 'denied',
          workflowRunId,
          jobId,
          toolName: 'set_job_output',
          errorCode: 'set_job_output_terminal_run',
          errorMessage: error.message,
        });
      }
      throw error;
    }
  }

  private validateHydrationSummary(
    data: Record<string, unknown>,
  ): string | null {
    if (!('hydration_summary' in data)) {
      return null;
    }
    const summary = data.hydration_summary;
    if (!isRecord(summary)) {
      return 'hydration_summary must be a non-null object.';
    }
    const COUNT_KEYS = [
      'hydrated_count',
      'created_count',
      'updated_count',
      'implemented_count',
      'backlog_count',
    ] as const;
    const hasPositiveCount = COUNT_KEYS.some((key) => {
      const val = summary[key];
      return typeof val === 'number' && val > 0;
    });
    if (!hasPositiveCount && this.isExplicitBlockedHydrationSummary(summary)) {
      return null;
    }
    if (!hasPositiveCount) {
      return (
        'hydration_summary must reflect real hydration work: at least one count field ' +
        '(hydrated_count, created_count, updated_count, implemented_count, backlog_count) ' +
        'must be greater than zero.'
      );
    }
    return null;
  }

  private isExplicitBlockedHydrationSummary(
    summary: Record<string, unknown>,
  ): boolean {
    return (
      summary.ok === false &&
      summary.status === 'blocked' &&
      typeof summary.reason === 'string' &&
      summary.reason.trim().length > 0
    );
  }
}
