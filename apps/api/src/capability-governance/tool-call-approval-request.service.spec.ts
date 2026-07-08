import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolCallApprovalRequestService } from './tool-call-approval-request.service';
import { ToolCallApprovalRequestRepository } from '../tool/database/repositories/tool-call-approval-request.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('ToolCallApprovalRequestService', () => {
  let repo: ToolCallApprovalRequestRepository;
  let events: EventEmitter2;
  let service: ToolCallApprovalRequestService;

  beforeEach(() => {
    repo = {
      findPendingByCorrelationId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((r) => ({ ...r })),
      save: vi
        .fn()
        .mockImplementation((r) => Promise.resolve({ ...r, id: 'req-1' })),
      findOne: vi.fn().mockImplementation(({ where }) => {
        if (where.id === 'req-1') {
          return Promise.resolve({ id: 'req-1', status: 'pending' });
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockResolvedValue({}),
    } as unknown as ToolCallApprovalRequestRepository;
    events = { emit: vi.fn() };
    service = new ToolCallApprovalRequestService(repo, events);
  });

  it('creates a request and emits an event', async () => {
    const promise = service.requestAndWaitForApproval({
      workflowRunId: 'wr-1',
      jobId: 'job-1',
      toolName: 'bash',
      payload: { command: 'ls' },
      requestedBy: 'senior_dev',
      timeoutMs: 500,
      pollIntervalMs: 50,
    });

    await new Promise((r) => setTimeout(r, 10));

    expect(repo.save).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      'tool_call.approval_required',
      expect.objectContaining({ requestId: 'req-1' }),
    );

    await service.approveRequest('req-1', 'human-1');
    const result = await promise;
    expect(result.status).toBe('approved');
  });

  it('rejects a request', async () => {
    const promise = service.requestAndWaitForApproval({
      workflowRunId: 'wr-1',
      jobId: 'job-1',
      toolName: 'bash',
      payload: { command: 'rm -rf /' },
      requestedBy: 'senior_dev',
      timeoutMs: 500,
      pollIntervalMs: 50,
    });

    await new Promise((r) => setTimeout(r, 10));
    await service.rejectRequest('req-1', 'human-1', 'Too dangerous');
    const result = await promise;
    expect(result.status).toBe('rejected');
    expect(result.rejectionReason).toBe('Too dangerous');
  });

  it('logs error when DB update fails on timeout', async () => {
    repo.update.mockRejectedValueOnce(new Error('DB connection lost'));
    const loggerErrorSpy = vi.spyOn(service['logger'], 'error');

    const promise = service.requestAndWaitForApproval({
      workflowRunId: 'wr-2',
      jobId: 'job-2',
      toolName: 'curl',
      payload: { url: 'https://example.com' },
      requestedBy: 'dev-1',
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    const result = await promise;
    expect(result.status).toBe('expired');
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist expired status'),
      expect.any(String),
    );
  });
});
