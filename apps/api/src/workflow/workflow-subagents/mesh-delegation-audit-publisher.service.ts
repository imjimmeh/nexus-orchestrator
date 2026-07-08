import { Injectable } from '@nestjs/common';
import type { DelegationContract } from '../database/entities/delegation-contract.entity';
import { AuditLogService } from '../../audit/audit-log.service';
import { WorkflowEventLogService } from '../workflow-event-log.service';

@Injectable()
export class MeshDelegationAuditPublisherService {
  constructor(
    private readonly workflowEventLog: WorkflowEventLogService,
    private readonly auditLog: AuditLogService,
  ) {}

  async appendLifecycleEvent(params: {
    workflowRunId: string;
    eventType: string;
    actorId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.workflowEventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: params.eventType,
      actorId: params.actorId,
      payload: params.payload,
    });
  }

  async writeAudit(params: {
    contract: DelegationContract;
    action: string;
    result: 'success' | 'failure' | 'denied';
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditLog.log(
      'MeshDelegationContract',
      params.contract.requester_agent_profile ?? 'system',
      params.action,
      params.result,
      params.contract.id,
      {
        workflow_run_id: params.contract.workflow_run_id,
        trace_id: params.contract.trace_id,
        ...params.metadata,
      },
    );
  }
}
