import { Injectable } from '@nestjs/common';
import type { HostMountMode, IHostMountBinding } from '@nexus/core';
import { EventLedgerService } from '../../observability/event-ledger.service';

interface HostMountAuditEventParams {
  eventName: string;
  outcome: 'success' | 'failure' | 'denied' | 'in_progress';
  workflowRunId?: string;
  jobId?: string;
  stepId?: string;
  alias?: string;
  mode?: HostMountMode;
  subpath?: string;
  containerPath?: string;
  hostPath?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class HostMountAuditService {
  constructor(private readonly eventLedger: EventLedgerService) {}

  async emit(params: HostMountAuditEventParams): Promise<void> {
    const payload: Record<string, unknown> = {
      ...(params.payload ?? {}),
      ...(params.alias ? { alias: params.alias } : {}),
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.subpath ? { subpath: params.subpath } : {}),
      ...(params.containerPath ? { container_path: params.containerPath } : {}),
      ...(params.hostPath ? { host_path: params.hostPath } : {}),
      ...(params.reason ? { reason: params.reason } : {}),
    };

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: params.eventName,
      outcome: params.outcome,
      actorType: 'system',
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      payload,
      errorMessage: params.reason,
    });
  }

  async emitContainerLifecycle(params: {
    eventName: string;
    outcome: 'success' | 'failure' | 'denied' | 'in_progress';
    workflowRunId: string;
    jobId: string;
    stepId: string;
    containerId: string;
    hostMountBindings: IHostMountBinding[];
  }): Promise<void> {
    await this.emit({
      eventName: params.eventName,
      outcome: params.outcome,
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      payload: {
        container_id: params.containerId,
        host_mount_count: params.hostMountBindings.length,
        host_mounts: params.hostMountBindings,
      },
    });
  }
}
