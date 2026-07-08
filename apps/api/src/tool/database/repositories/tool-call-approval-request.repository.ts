import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ToolCallApprovalRequest } from '../entities/tool-call-approval-request.entity';

@Injectable()
export class ToolCallApprovalRequestRepository extends Repository<ToolCallApprovalRequest> {
  constructor(private dataSource: DataSource) {
    super(ToolCallApprovalRequest, dataSource.createEntityManager());
  }

  async findPendingByCorrelationId(
    correlationId: string,
  ): Promise<ToolCallApprovalRequest | null> {
    return this.findOne({
      where: { correlationId, status: 'pending' },
    });
  }

  async findPendingByScopeId(
    scopeId: string,
  ): Promise<ToolCallApprovalRequest[]> {
    return this.find({
      where: { scopeId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingByWorkflowRun(
    workflowRunId: string,
  ): Promise<ToolCallApprovalRequest[]> {
    return this.find({
      where: { workflowRunId, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }
}
