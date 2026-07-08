import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolCallApprovalRequestsController } from './tool-call-approval-requests.controller';

describe('ToolCallApprovalRequestsController', () => {
  const approvalService = {
    approveRequest: vi.fn(),
    rejectRequest: vi.fn(),
  };

  const ruleService = {
    createRuleFromApproval: vi.fn(),
  };

  const requestRepo = {
    findOne: vi.fn(),
    find: vi.fn(),
    findPendingByProject: vi.fn(),
    findPendingByWorkflowRun: vi.fn(),
  };

  let controller: ToolCallApprovalRequestsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ToolCallApprovalRequestsController(
      approvalService as never,
      ruleService as never,
      requestRepo as never,
    );
  });

  it('rejects approval without authenticated user', async () => {
    await expect(
      controller.approve('req-1', { alwaysAllowExact: true }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects approval for unknown request', async () => {
    requestRepo.findOne.mockResolvedValue(null);

    await expect(
      controller.approve(
        'req-1',
        { alwaysAllowExact: true },
        {
          user: { userId: 'user-1' },
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires similar patterns when alwaysAllowSimilar is true', async () => {
    requestRepo.findOne.mockResolvedValue({
      id: 'req-1',
      scope_id: 'project-1',
      workflowRunId: 'run-1',
      requestedBy: 'agent',
      toolName: 'bash',
      toolArguments: { command: 'ls' },
    });

    await expect(
      controller.approve(
        'req-1',
        { alwaysAllowSimilar: true },
        {
          user: { userId: 'user-1' },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a rule and approves request when alwaysAllowExact is selected', async () => {
    requestRepo.findOne.mockResolvedValue({
      id: 'req-1',
      scope_id: 'project-1',
      workflowRunId: 'run-1',
      requestedBy: 'agent',
      toolName: 'bash',
      toolArguments: { command: 'ls' },
    });
    ruleService.createRuleFromApproval.mockResolvedValue({ id: 'rule-1' });

    const result = await controller.approve(
      'req-1',
      { alwaysAllowExact: true },
      { user: { userId: 'user-1' } },
    );

    expect(result).toEqual({ ok: true });
    expect(approvalService.approveRequest).toHaveBeenCalledWith(
      'req-1',
      'user-1',
      'rule-1',
    );
  });
});
