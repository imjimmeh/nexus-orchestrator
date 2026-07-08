import { Injectable } from '@nestjs/common';
import type { RuntimeFeedbackSignal } from '@nexus/core';
import { EventLedgerService } from '../observability/event-ledger.service';
import { RuntimeFeedbackIngestionService } from '../runtime-feedback/runtime-feedback-ingestion.service';
import {
  RepairEntry,
  ToolRepairResult,
} from './tool-contract-repair.adapter.types';

const REPAIR_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPAIR_THRESHOLD = 0.2;
const SET_JOB_OUTPUT_ALIAS_FIELDS = ['output', 'job_output', 'step_output'];
const SET_JOB_OUTPUT_CONTEXT_FIELDS = new Set([
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
  'containerId',
  'subagentExecutionId',
  'data',
  'args',
  ...SET_JOB_OUTPUT_ALIAS_FIELDS,
]);

@Injectable()
export class ToolContractRepairAdapter {
  private readonly counters = new Map<
    string,
    Array<{ timestamp: number; repaired: boolean }>
  >();

  constructor(
    private readonly eventLedger: EventLedgerService,
    private readonly runtimeFeedback: RuntimeFeedbackIngestionService,
  ) {}

  async repair(params: {
    toolName: string;
    payload: Record<string, unknown>;
    workflowRunId?: string;
    jobId?: string;
  }): Promise<ToolRepairResult> {
    const repairedPayload = structuredClone(params.payload);
    const repairs: RepairEntry[] = [];

    this.repairKnownFields(params.toolName, repairedPayload, repairs);
    this.repairGenericJsonStrings(repairedPayload, repairs);

    if (repairs.length === 0) {
      await this.trackRate(
        params.toolName,
        false,
        repairs,
        params.workflowRunId,
        params.jobId,
      );
      return {
        payload: repairedPayload,
        repairs,
      };
    }

    await this.eventLedger.emitBestEffort({
      domain: 'workflow_runtime',
      eventName: 'tool.contract_repair.applied',
      outcome: 'success',
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      toolName: params.toolName,
      payload: {
        repairs,
      },
    });

    await this.trackRate(
      params.toolName,
      true,
      repairs,
      params.workflowRunId,
      params.jobId,
    );

    return {
      payload: repairedPayload,
      repairs,
    };
  }

  private repairKnownFields(
    toolName: string,
    payload: Record<string, unknown>,
    repairs: RepairEntry[],
  ): void {
    if (toolName === 'set_job_output') {
      this.tryRepairField(payload, 'data', repairs, 'object');
      this.repairSetJobOutputPayload(payload, repairs);
      return;
    }

    if (toolName === 'step_complete') {
      this.repairStepCompletePayload(payload, repairs);
      return;
    }

    if (toolName === 'ask_user_questions') {
      this.tryRepairField(payload, 'questions', repairs, 'array');
      const args = payload.args;
      if (this.isRecord(args)) {
        this.tryRepairField(
          args,
          'questions',
          repairs,
          'array',
          'args.questions',
        );
      }
    }
  }

  private repairStepCompletePayload(
    payload: Record<string, unknown>,
    repairs: RepairEntry[],
  ): void {
    const allowedFields = new Set(['summary', 'reasoning', 'status']);

    if (typeof payload.reason === 'string' && !('reasoning' in payload)) {
      payload.reasoning = payload.reason;
      Reflect.deleteProperty(payload, 'reason');
      repairs.push({
        field: 'reasoning',
        originalType: 'string',
      });
    }

    for (const key of Object.keys(payload)) {
      if (!allowedFields.has(key)) {
        Reflect.deleteProperty(payload, key);
        repairs.push({
          field: key,
          originalType: 'extra_field_stripped',
        });
      }
    }
  }

  private repairSetJobOutputPayload(
    payload: Record<string, unknown>,
    repairs: RepairEntry[],
  ): void {
    if (this.isRecord(payload.data)) {
      this.stripReservedKeys(payload.data, repairs, 'data');
      return;
    }

    for (const alias of SET_JOB_OUTPUT_ALIAS_FIELDS) {
      const repaired = this.coerceRecord(payload[alias]);
      if (!repaired) {
        continue;
      }

      this.stripReservedKeys(repaired, repairs, alias);
      payload.data = repaired;
      repairs.push({
        field: 'data',
        originalType: typeof payload[alias],
      });
      return;
    }

    const projected = this.projectTopLevelSetJobOutputData(payload);
    if (!projected) {
      return;
    }

    payload.data = projected;
    repairs.push({
      field: 'data',
      originalType: 'object',
    });
  }

  private stripReservedKeys(
    data: Record<string, unknown>,
    repairs: RepairEntry[],
    prefix: string,
  ): void {
    const reservedKeys = [
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
    ];

    for (const key of reservedKeys) {
      if (key in data) {
        Reflect.deleteProperty(data, key);
        repairs.push({
          field: `${prefix}.${key}`,
          originalType: 'reserved_key_stripped',
        });
      }
    }
  }

  private coerceRecord(value: unknown): Record<string, unknown> | null {
    if (this.isRecord(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const parsed = this.tryParseJson(value);
    if (!parsed.ok || !this.isRecord(parsed.value)) {
      return null;
    }

    return parsed.value;
  }

  private projectTopLevelSetJobOutputData(
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null {
    const projected = Object.entries(payload).reduce<Record<string, unknown>>(
      (acc, [key, value]) => {
        if (SET_JOB_OUTPUT_CONTEXT_FIELDS.has(key)) {
          return acc;
        }

        acc[key] = value;
        return acc;
      },
      {},
    );

    return Object.keys(projected).length > 0 ? projected : null;
  }

  private repairGenericJsonStrings(
    payload: Record<string, unknown>,
    repairs: RepairEntry[],
    prefix = '',
  ): void {
    for (const [key, value] of Object.entries(payload)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') {
        const parsed = this.tryParseJson(value);
        if (
          parsed.ok &&
          (Array.isArray(parsed.value) || this.isRecord(parsed.value))
        ) {
          payload[key] = parsed.value;
          repairs.push({
            field: path,
            originalType: 'string',
          });
        }
        continue;
      }

      if (this.isRecord(value)) {
        this.repairGenericJsonStrings(value, repairs, path);
      }
    }
  }

  private tryRepairField(
    payload: Record<string, unknown>,
    field: string,
    repairs: RepairEntry[],
    expectedType: 'object' | 'array',
    displayField?: string,
  ): void {
    const current = payload[field];
    if (typeof current !== 'string') {
      return;
    }

    const parsed = this.tryParseJson(current);
    if (!parsed.ok) {
      void this.eventLedger.emitBestEffort({
        domain: 'workflow_runtime',
        eventName: 'tool.contract_repair.failed',
        outcome: 'failure',
        payload: {
          field: displayField ?? field,
          reason: 'invalid_json_string',
        },
      });
      return;
    }

    if (expectedType === 'array' && !Array.isArray(parsed.value)) {
      return;
    }

    if (expectedType === 'object' && !this.isRecord(parsed.value)) {
      return;
    }

    payload[field] = parsed.value;
    repairs.push({
      field: displayField ?? field,
      originalType: 'string',
    });
  }

  private async trackRate(
    toolName: string,
    repaired: boolean,
    repairs: RepairEntry[],
    workflowRunId?: string,
    jobId?: string,
  ): Promise<void> {
    const now = Date.now();
    const primaryRepair = repairs[0];
    const counterKey = primaryRepair
      ? this.buildRepairCounterKey(toolName, primaryRepair, workflowRunId)
      : toolName;
    const existing = this.counters.get(counterKey) ?? [];
    const next = [...existing, { timestamp: now, repaired }].filter(
      (entry) => now - entry.timestamp <= REPAIR_WINDOW_MS,
    );
    this.counters.set(counterKey, next);

    const repairedCount = next.filter((entry) => entry.repaired).length;
    const rate = next.length === 0 ? 0 : repairedCount / next.length;

    if (rate <= REPAIR_THRESHOLD || next.length < 5) {
      return Promise.resolve();
    }

    const thresholdPayload = {
      sample_size: next.length,
      repaired_count: repairedCount,
      repaired_rate: rate,
    };

    void this.eventLedger.emitBestEffort({
      domain: 'workflow_runtime',
      eventName: 'tool.contract_repair.threshold_exceeded',
      outcome: 'success',
      workflowRunId,
      jobId,
      toolName,
      payload: thresholdPayload,
    });

    if (!repaired || !primaryRepair) {
      return;
    }

    await this.ingestThresholdFeedbackBestEffort({
      toolName,
      primaryRepair,
      workflowRunId,
      jobId,
      repairedCount,
      sampleSize: next.length,
      repairedRate: rate,
    });
  }

  private buildRepairCounterKey(
    toolName: string,
    repair: RepairEntry,
    workflowRunId?: string,
  ): string {
    return [
      toolName,
      repair.field,
      repair.originalType,
      workflowRunId ? `workflow_run:${workflowRunId}` : 'global',
    ].join('|');
  }

  private async ingestThresholdFeedbackBestEffort(params: {
    toolName: string;
    primaryRepair: RepairEntry;
    workflowRunId?: string;
    jobId?: string;
    repairedCount: number;
    sampleSize: number;
    repairedRate: number;
  }): Promise<void> {
    try {
      await this.runtimeFeedback.ingest(
        this.buildThresholdExceededFeedbackSignal(params),
      );
    } catch (error) {
      void this.eventLedger.emitBestEffort({
        domain: 'workflow_runtime',
        eventName: 'tool.contract_repair.feedback_ingest_failed',
        outcome: 'failure',
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        toolName: params.toolName,
        payload: {
          error_name: error instanceof Error ? error.name : 'NonErrorThrown',
          schema_path: params.primaryRepair.field,
          repair_type: params.primaryRepair.originalType,
        },
      });
    }
  }

  private buildThresholdExceededFeedbackSignal(params: {
    toolName: string;
    primaryRepair: RepairEntry;
    workflowRunId?: string;
    jobId?: string;
    repairedCount: number;
    sampleSize: number;
    repairedRate: number;
  }): RuntimeFeedbackSignal {
    const scope = params.workflowRunId
      ? {
          scope_type: 'workflow_run',
          scope_id: params.workflowRunId,
        }
      : {
          scope_type: 'global',
        };
    const scopeFingerprint = params.workflowRunId
      ? `workflow_run:${params.workflowRunId}`
      : 'global';

    return {
      signal_type: 'tool_contract_repair',
      source_module: 'tool-runtime',
      scope,
      affected: {
        tool_name: params.toolName,
        workflow_run_id: params.workflowRunId,
        job_id: params.jobId,
        schema_path: params.primaryRepair.field,
        failure_class: params.primaryRepair.originalType,
      },
      evidence: [
        {
          kind: 'threshold_exceeded',
          summary: `Tool contract repairs exceeded threshold: ${params.repairedCount}/${params.sampleSize} (${params.repairedRate.toFixed(2)}).`,
        },
      ],
      examples: [
        {
          summary: `Tool ${params.toolName} contract repair exceeded threshold for ${params.primaryRepair.field} (${params.primaryRepair.originalType}).`,
          redacted: true,
        },
      ],
      confidence: 0.8,
      severity: 'medium',
      dedupe_fingerprint: [
        'tool_contract_repair',
        params.toolName,
        params.primaryRepair.field,
        params.primaryRepair.originalType,
        scopeFingerprint,
      ].join('|'),
      occurred_at: new Date().toISOString(),
    };
  }

  private tryParseJson(value: string):
    | {
        ok: true;
        value: unknown;
      }
    | {
        ok: false;
      } {
    const trimmed = value.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
      return { ok: false };
    }

    try {
      return {
        ok: true,
        value: JSON.parse(trimmed) as unknown,
      };
    } catch {
      return { ok: false };
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
}
