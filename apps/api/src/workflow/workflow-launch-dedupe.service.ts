import { Inject, Injectable } from '@nestjs/common';
import { isRecord, readString } from '@nexus/core';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import type { PreparedWorkflowLaunchTrigger } from './workflow-launch-dedupe.types';

@Injectable()
export class WorkflowLaunchDedupeService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  prepareTriggerData(
    triggerData: Record<string, unknown>,
  ): PreparedWorkflowLaunchTrigger {
    const launchDedupeKey = this.resolveLaunchDedupeKey(triggerData);
    if (!launchDedupeKey) {
      return { triggerData };
    }

    return {
      triggerData: this.withLaunchDedupeKey(triggerData, launchDedupeKey),
      launchDedupeKey,
    };
  }

  resolveLaunchDedupeKey(
    triggerData: Record<string, unknown>,
  ): string | undefined {
    const dedupeKey =
      this.readStringField(triggerData, 'dedupeKey') ??
      this.readNestedStringField(triggerData, 'payload', 'dedupeKey');

    if (!dedupeKey) {
      return undefined;
    }

    const trimmedDedupeKey = dedupeKey.trim();
    return trimmedDedupeKey.length > 0 ? trimmedDedupeKey : undefined;
  }

  lockKey(workflowId: string, launchDedupeKey: string): string {
    return `workflow-launch:${workflowId}:${launchDedupeKey}`;
  }

  async findExistingRun(workflowId: string, launchDedupeKey: string) {
    return this.runRepo.findLatestByWorkflowAndDedupeKey(
      workflowId,
      launchDedupeKey,
    );
  }

  async recoverExistingRunIdAfterDuplicate(
    workflowId: string,
    launchDedupeKey: string | undefined,
    error: unknown,
  ): Promise<string> {
    if (!launchDedupeKey || !this.isDuplicateKeyError(error)) {
      throw error;
    }

    const existing = await this.findExistingRun(workflowId, launchDedupeKey);
    if (!existing) {
      throw error;
    }

    return existing.id;
  }

  private withLaunchDedupeKey(
    triggerData: Record<string, unknown>,
    launchDedupeKey: string,
  ): Record<string, unknown> {
    if (triggerData.dedupeKey === launchDedupeKey) {
      return triggerData;
    }

    return { ...triggerData, dedupeKey: launchDedupeKey };
  }

  private readNestedStringField(
    data: Record<string, unknown>,
    parentField: string,
    childField: string,
  ): string | undefined {
    const parent = data[parentField];
    if (!isRecord(parent)) {
      return undefined;
    }

    return this.readStringField(parent, childField);
  }

  private readStringField(
    data: Record<string, unknown>,
    fieldName: string,
  ): string | undefined {
    return readString(data[fieldName]);
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes('duplicate key value violates unique constraint')
    );
  }
}
