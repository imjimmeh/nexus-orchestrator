import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash } from 'crypto';
import { ToolCallApprovalRequestRepository } from '../tool/database/repositories/tool-call-approval-request.repository';
import type {
  RequestApprovalParams,
  ToolCallApprovalResolution,
} from './tool-call-approval-request.types';

function computeCorrelationId(params: {
  workflowRunId?: string;
  jobId?: string;
  chatSessionId?: string;
  toolName: string;
  payload: Record<string, unknown>;
}): string {
  const keys = Object.keys(params.payload).sort();
  const sortedPayload: Record<string, unknown> = {};
  for (const key of keys) {
    sortedPayload[key] = params.payload[key];
  }
  const canonical = JSON.stringify({
    workflowRunId: params.workflowRunId ?? null,
    jobId: params.jobId ?? null,
    chatSessionId: params.chatSessionId ?? null,
    toolName: params.toolName,
    payload: sortedPayload,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class ToolCallApprovalRequestService {
  private readonly logger = new Logger(ToolCallApprovalRequestService.name);
  private readonly pendingWaits = new Map<
    string,
    {
      resolve: (value: ToolCallApprovalResolution) => void;
    }
  >();

  constructor(
    private readonly requestRepo: ToolCallApprovalRequestRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async requestAndWaitForApproval(
    params: RequestApprovalParams,
  ): Promise<ToolCallApprovalResolution> {
    const correlationId = computeCorrelationId(params);
    const existing =
      await this.requestRepo.findPendingByCorrelationId(correlationId);

    if (existing) {
      return this.waitForResolution(
        existing.id,
        params.timeoutMs ?? 600_000,
        params.pollIntervalMs ?? 2000,
      );
    }

    const request = this.requestRepo.create({
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      scopeId: params.scopeId ?? null,
      chatSessionId: params.chatSessionId ?? null,
      toolName: params.toolName,
      toolArguments: params.payload,
      requestedBy: params.requestedBy,
      status: 'pending',
      correlationId,
    });

    const saved = await this.requestRepo.save(request);

    this.eventEmitter.emit('tool_call.approval_required', {
      requestId: saved.id,
      workflowRunId: saved.workflowRunId,
      jobId: saved.jobId,
      scopeId: saved.scopeId,
      chatSessionId: saved.chatSessionId,
      toolName: saved.toolName,
      toolArguments: saved.toolArguments,
      requestedBy: saved.requestedBy,
    });

    return this.waitForResolution(
      saved.id,
      params.timeoutMs ?? 600_000,
      params.pollIntervalMs ?? 2000,
    );
  }

  async approveRequest(
    requestId: string,
    approvedBy: string,
    resolutionRuleId?: string,
  ): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending') return;

    request.status = 'approved';
    request.approvedBy = approvedBy;
    request.approvedAt = new Date();
    if (resolutionRuleId) {
      request.resolutionRuleId = resolutionRuleId;
    }

    await this.requestRepo.save(request);
    this.resolveWait(requestId, {
      status: 'approved',
      approvedBy,
    });
  }

  async rejectRequest(
    requestId: string,
    rejectedBy: string,
    reason?: string,
  ): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });
    if (!request || request.status !== 'pending') return;

    request.status = 'rejected';
    request.rejectedBy = rejectedBy;
    request.rejectedAt = new Date();
    request.rejectionReason = reason ?? null;

    await this.requestRepo.save(request);
    this.resolveWait(requestId, {
      status: 'rejected',
      rejectionReason: reason,
    });
  }

  private waitForResolution(
    requestId: string,
    timeoutMs: number,
    pollIntervalMs: number,
  ): Promise<ToolCallApprovalResolution> {
    return new Promise((resolve) => {
      this.pendingWaits.set(requestId, { resolve });

      const interval = setInterval(() => {
        void this.pollResolution(requestId, resolve, interval, timeout);
      }, pollIntervalMs);

      const timeout = setTimeout(() => {
        clearInterval(interval);
        this.pendingWaits.delete(requestId);
        this.requestRepo
          .update(requestId, { status: 'expired' })
          .catch((err: unknown) => {
            this.logger.error(
              `Failed to persist expired status for approval request ${requestId}`,
              err instanceof Error ? err.stack : String(err),
            );
          });
        resolve({ status: 'expired' });
      }, timeoutMs);
    });
  }

  private resolveWait(
    requestId: string,
    result: ToolCallApprovalResolution,
  ): void {
    const waiter = this.pendingWaits.get(requestId);
    if (waiter) {
      waiter.resolve(result);
      this.pendingWaits.delete(requestId);
    }
  }

  private async pollResolution(
    requestId: string,
    resolve: (result: ToolCallApprovalResolution) => void,
    interval: NodeJS.Timeout,
    timeout: NodeJS.Timeout,
  ): Promise<void> {
    const request = await this.requestRepo.findOne({
      where: { id: requestId },
    });
    if (request && request.status !== 'pending') {
      clearInterval(interval);
      clearTimeout(timeout);
      this.pendingWaits.delete(requestId);
      resolve({
        status: request.status,
        rejectionReason: request.rejectionReason ?? undefined,
        approvedBy: request.approvedBy ?? undefined,
      });
    }
  }
}
