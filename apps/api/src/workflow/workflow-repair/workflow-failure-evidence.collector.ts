import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asRecord, isRecord } from '@nexus/core';
import { unzipSync } from 'node:zlib';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { PiSessionTreeRepository } from '../../runtime/database/repositories/pi-session-tree.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { WorkflowHostMountRuntimeDiagnosticsService } from '../workflow-host-mount/workflow-host-mount-runtime-diagnostics.service';
import { WorkflowSkillRuntimeDiagnosticsService } from '../workflow-skill-runtime-diagnostics.service';
import type {
  FailureEvidenceEvent,
  FailureEvidenceRuntimeDiagnostics,
  FailureEvidenceTranscriptReference,
  NormalizedFailureEvidence,
} from './failure-classification.types';

const FAILURE_TEXT_PATTERN = /error|failed|exception/i;

@Injectable()
export class WorkflowFailureEvidenceCollectorService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly piSessionTrees: PiSessionTreeRepository,
    private readonly skillDiagnostics: WorkflowSkillRuntimeDiagnosticsService,
    private readonly hostMountDiagnostics: WorkflowHostMountRuntimeDiagnosticsService,
  ) {}

  async collect(workflowRunId: string): Promise<NormalizedFailureEvidence> {
    const run = await this.workflowRunRepository.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }

    const [{ events }, transcriptReferences, runtimeDiagnostics] =
      await Promise.all([
        this.eventLedger.query({ workflowRunId, limit: 100 }),
        this.collectTranscriptReferences(workflowRunId),
        this.collectRuntimeDiagnostics(workflowRunId),
      ]);

    const normalizedEvents = events.map((event) => ({
      id: event.id,
      domain: event.domain,
      name: event.event_name,
      outcome: event.outcome,
      severity: event.severity,
      jobId: event.job_id,
      stepId: event.step_id,
      payload: event.payload,
      errorCode: event.error_code,
      errorMessage: event.error_message,
      occurredAt: event.occurred_at.toISOString(),
    })) satisfies FailureEvidenceEvent[];

    const jobId = this.resolveJobId(run.current_step_id, normalizedEvents);
    const firstError = normalizedEvents.find(
      (event) => event.errorCode || event.errorMessage,
    );

    return {
      workflowRunId: run.id,
      workflowId: run.workflow_id,
      jobId,
      events: normalizedEvents,
      jobOutput: this.resolveJobOutput(run.state_variables, jobId),
      errorCode: firstError?.errorCode,
      errorMessage: firstError?.errorMessage,
      transcriptReferences,
      runtimeDiagnostics,
    };
  }

  private resolveJobId(
    currentStepId: string | undefined,
    events: FailureEvidenceEvent[],
  ): string | undefined {
    return currentStepId ?? events.find((event) => event.jobId)?.jobId;
  }

  private resolveJobOutput(
    stateVariables: Record<string, unknown>,
    jobId: string | undefined,
  ): Record<string, unknown> | null {
    if (!jobId) {
      return null;
    }

    if (!isRecord(stateVariables.jobs)) {
      return null;
    }
    const jobs = stateVariables.jobs;
    const rawJobState = jobs[jobId];
    if (!isRecord(rawJobState)) {
      return null;
    }
    const output = rawJobState.output;
    if (!isRecord(output)) {
      return null;
    }
    return output;
  }

  private async collectTranscriptReferences(
    workflowRunId: string,
  ): Promise<FailureEvidenceTranscriptReference[]> {
    const tree = await this.piSessionTrees.findByWorkflowRunId(workflowRunId);
    if (!tree?.jsonl_data?.length) {
      return [];
    }

    return this.expandTranscriptEntries(tree.jsonl_data).flatMap(
      (entry, eventIndex) => {
        const parsed = this.parseTranscriptEntry(entry);
        if (!parsed.isFailureLike) {
          return [];
        }

        return [
          {
            kind: 'session_tree' as const,
            sessionTreeId: tree.id,
            eventIndex,
            summary: parsed.summary,
          },
        ];
      },
    );
  }

  private expandTranscriptEntries(entries: unknown[]): unknown[] {
    return entries.flatMap((entry) => {
      const decoded = this.tryDecodeCompressedJsonl(entry);
      return decoded ?? [entry];
    });
  }

  private tryDecodeCompressedJsonl(entry: unknown): unknown[] | null {
    if (typeof entry !== 'string' || !entry.trim()) {
      return null;
    }

    try {
      const jsonl = unzipSync(Buffer.from(entry, 'base64')).toString('utf-8');
      return jsonl
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown);
    } catch {
      return null;
    }
  }

  private parseTranscriptEntry(entry: unknown): {
    isFailureLike: boolean;
    summary: string;
  } {
    const record = asRecord(entry);
    if (isRecord(record) && record.is_error === true) {
      return {
        isFailureLike: true,
        summary: 'Transcript event marked is_error',
      };
    }

    const text = typeof entry === 'string' ? entry : JSON.stringify(entry);
    if (!FAILURE_TEXT_PATTERN.test(text)) {
      return { isFailureLike: false, summary: '' };
    }

    return {
      isFailureLike: true,
      summary: `Transcript entry matched failure signal: ${this.transcriptEntryKind(entry)}`,
    };
  }

  private transcriptEntryKind(entry: unknown): string {
    const record = asRecord(entry);
    const type = record.type;
    return typeof type === 'string' && type.trim() ? type : typeof entry;
  }

  private async collectRuntimeDiagnostics(
    workflowRunId: string,
  ): Promise<FailureEvidenceRuntimeDiagnostics> {
    const diagnostics: FailureEvidenceRuntimeDiagnostics = {
      collectionErrors: [],
    };

    try {
      diagnostics.skillMounts =
        (await this.skillDiagnostics.getRunSkillMountDiagnostics(
          workflowRunId,
        )) as unknown as Record<string, unknown>;
    } catch (error) {
      diagnostics.collectionErrors.push(
        `skill diagnostics: ${this.errorMessage(error)}`,
      );
    }

    try {
      diagnostics.hostMounts =
        await this.hostMountDiagnostics.getRunHostMountDiagnostics(
          workflowRunId,
        );
    } catch (error) {
      diagnostics.collectionErrors.push(
        `host mount diagnostics: ${this.errorMessage(error)}`,
      );
    }

    return diagnostics;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
