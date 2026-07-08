import { ForbiddenException } from '@nestjs/common';
import type { IHostMountBinding, IJob } from '@nexus/core';
import { resolveErrorMessage } from './host-mount-resolution.helpers';
import type {
  HostMountApprovalRequirement,
  HostMountCatalogEntry,
} from './host-mount-resolution.service.types';
import { HostMountAuditService } from './host-mount-audit.service';

interface HostMountResolutionContext {
  catalog: Map<string, HostMountCatalogEntry>;
  allowLists: string[][];
  denyLists: string[][];
  rwAllowLists: string[][];
  requireRwApproval: boolean;
}

interface ResolvePreflightRequestParams {
  hostMountAudit: HostMountAuditService;
  resolveBindingForRequest: (params: {
    jobId: string;
    index: number;
    request: NonNullable<IJob['host_mounts']>[number];
    context: HostMountResolutionContext;
  }) => Promise<
    | { type: 'binding'; binding: IHostMountBinding }
    | { type: 'approval_required'; requirement: HostMountApprovalRequirement }
  >;
  jobId: string;
  index: number;
  request: NonNullable<IJob['host_mounts']>[number];
  context: HostMountResolutionContext;
  workflowRunId?: string;
  stepId?: string;
}

export async function resolvePreflightRequestWithAudit(
  params: ResolvePreflightRequestParams,
): Promise<
  | { type: 'binding'; binding: IHostMountBinding }
  | { type: 'approval_required'; requirement: HostMountApprovalRequirement }
> {
  await params.hostMountAudit.emit({
    eventName: 'workflow.host_mount.requested',
    outcome: 'in_progress',
    workflowRunId: params.workflowRunId,
    jobId: params.jobId,
    stepId: params.stepId,
    alias:
      typeof params.request.alias === 'string'
        ? params.request.alias
        : undefined,
    mode: params.request.mode,
    subpath: params.request.subpath,
  });

  try {
    const decision: Awaited<
      ReturnType<ResolvePreflightRequestParams['resolveBindingForRequest']>
    > = await params.resolveBindingForRequest({
      jobId: params.jobId,
      index: params.index,
      request: params.request,
      context: params.context,
    });

    if (decision.type === 'approval_required') {
      await params.hostMountAudit.emit({
        eventName: 'workflow.host_mount.approval_required',
        outcome: 'denied',
        workflowRunId: params.workflowRunId,
        jobId: params.jobId,
        stepId: params.stepId,
        alias: decision.requirement.alias,
        mode: 'rw',
        reason: decision.requirement.reason,
      });

      return decision;
    }

    await params.hostMountAudit.emit({
      eventName: 'workflow.host_mount.approved',
      outcome: 'success',
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      alias: decision.binding.alias,
      mode: decision.binding.mode,
      containerPath: decision.binding.containerPath,
      hostPath: decision.binding.hostPath,
    });

    return decision;
  } catch (error) {
    await params.hostMountAudit.emit({
      eventName: 'workflow.host_mount.denied',
      outcome: error instanceof ForbiddenException ? 'denied' : 'failure',
      workflowRunId: params.workflowRunId,
      jobId: params.jobId,
      stepId: params.stepId,
      alias:
        typeof params.request.alias === 'string'
          ? params.request.alias
          : undefined,
      mode: params.request.mode,
      subpath: params.request.subpath,
      reason: resolveErrorMessage(error),
    });

    throw error;
  }
}
