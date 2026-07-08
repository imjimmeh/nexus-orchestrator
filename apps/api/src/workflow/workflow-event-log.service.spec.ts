import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEventLogService } from './workflow-event-log.service';
import { WorkflowEventRepository } from './database/repositories/workflow-event.repository';
import { RequestContextService } from '../common/request-context.service';
import { WorkflowEvent } from './database/entities/workflow-event.entity';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { WorkflowRunRequiredToolsAuditSummary } from './database/repositories/workflow-event.repository.types';

// Prevent RequestContextLogger.init from running during tests
vi.mock('../common/logger.config', () => ({
  RequestContextLogger: {
    init: vi.fn(),
  },
}));

describe('WorkflowEventLogService', () => {
  let service: WorkflowEventLogService;
  let repository: WorkflowEventRepository;
  let contextService: RequestContextService;
  let eventLedger: EventLedgerService;

  const mockEvent: WorkflowEvent = {
    id: 'evt-1',
    workflow_run_id: 'run-1',
    event_type: 'workflow.started',
    correlation_id: 'req-abc',
    payload: { workflowId: 'wf-1' },
    timestamp: new Date('2026-01-01'),
  };

  const mockAuditSummary: WorkflowRunRequiredToolsAuditSummary = {
    workflow_run_id: 'run-1',
    workflow_id: 'wf-1',
    run_status: 'COMPLETED',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:05:00.000Z',
    scope_id: 'project-1',
    context_id: 'resource-1',
    queued_jobs_count: 2,
    queued_jobs_with_required_tools: 1,
    required_tools_satisfied_count: 1,
    required_tools_missing_count: 0,
    required_tools_retry_enqueued_count: 0,
    required_tools_exhausted_count: 0,
    queued_job_audit: [],
    required_tool_events: [],
  };

  beforeEach(async () => {
    const mockRepository = {
      append: vi.fn().mockResolvedValue(mockEvent),
      findByRunId: vi.fn().mockResolvedValue([[mockEvent], 1]),
      findPaged: vi.fn().mockResolvedValue([[mockEvent], 1]),
      getRequiredToolsAuditSummaryByRunId: vi
        .fn()
        .mockResolvedValue(mockAuditSummary),
    };

    const mockEventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };

    contextService = new RequestContextService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowEventLogService,
        { provide: WorkflowEventRepository, useValue: mockRepository },
        { provide: RequestContextService, useValue: contextService },
        { provide: EventLedgerService, useValue: mockEventLedger },
      ],
    }).compile();

    service = module.get<WorkflowEventLogService>(WorkflowEventLogService);
    repository = module.get<WorkflowEventRepository>(WorkflowEventRepository);
    eventLedger = module.get<EventLedgerService>(EventLedgerService);
  });

  describe('append', () => {
    it('should append an event with the correlation ID from request context', async () => {
      const result = await contextService.run({ requestId: 'req-abc' }, () =>
        service.append({
          workflowRunId: 'run-1',
          eventType: 'workflow.started',
          payload: { workflowId: 'wf-1' },
        }),
      );

      expect(result).toEqual(mockEvent);
      expect(repository.append).toHaveBeenCalledWith({
        workflow_run_id: 'run-1',
        event_type: 'workflow.started',
        step_id: undefined,
        job_id: undefined,
        actor_id: undefined,
        correlation_id: 'req-abc',
        payload: { workflowId: 'wf-1' },
      });
      expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'workflow',
          eventName: 'workflow.started',
          outcome: 'in_progress',
        }),
      );
    });

    it('should append an event without correlation ID when outside request scope', async () => {
      await service.append({
        workflowRunId: 'run-1',
        eventType: 'workflow.started',
      });

      expect(repository.append).toHaveBeenCalledWith(
        expect.objectContaining({
          correlation_id: undefined,
        }),
      );
    });

    it('should propagate errors from the repository', async () => {
      vi.mocked(repository.append).mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.append({
          workflowRunId: 'run-1',
          eventType: 'workflow.started',
        }),
      ).rejects.toThrow('DB error');
    });
  });

  describe('appendBestEffort', () => {
    it('should not throw when the repository fails', async () => {
      vi.mocked(repository.append).mockRejectedValueOnce(new Error('DB error'));

      await expect(
        service.appendBestEffort({
          workflowRunId: 'run-1',
          eventType: 'workflow.started',
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('getHistory', () => {
    it('should return paginated events', async () => {
      const result = await service.getHistory('run-1', 50, 0);

      expect(result).toEqual({ events: [mockEvent], total: 1 });
      expect(repository.findByRunId).toHaveBeenCalledWith('run-1', 50, 0);
    });

    it('should use default pagination values', async () => {
      await service.getHistory('run-1');

      expect(repository.findByRunId).toHaveBeenCalledWith('run-1', 100, 0);
    });
  });

  describe('getPagedHistory', () => {
    it('returns paginated persisted events', async () => {
      const result = await service.getPagedHistory(
        { limit: 25, offset: 50 },
        {
          scopeId: 'project-1',
          search: 'workflow.started',
          sortBy: 'event_type',
          sortDir: 'asc',
        },
      );

      expect(result).toEqual({ events: [mockEvent], total: 1 });
      expect(repository.findPaged).toHaveBeenCalledWith(
        { limit: 25, offset: 50 },
        {
          scopeId: 'project-1',
          search: 'workflow.started',
          sortBy: 'event_type',
          sortDir: 'asc',
        },
      );
    });

    it('supports unfiltered pagination', async () => {
      await service.getPagedHistory({ limit: 20, offset: 0 });

      expect(repository.findPaged).toHaveBeenCalledWith(
        { limit: 20, offset: 0 },
        {
          scopeId: undefined,
        },
      );
    });
  });

  describe('getRequiredToolsAuditSummary', () => {
    it('returns run-level required tools audit summary', async () => {
      const result = await service.getRequiredToolsAuditSummary('run-1');

      expect(result).toEqual(mockAuditSummary);
      expect(
        repository.getRequiredToolsAuditSummaryByRunId,
      ).toHaveBeenCalledWith('run-1');
    });

    it('returns null when no summary exists for run', async () => {
      vi.mocked(
        repository.getRequiredToolsAuditSummaryByRunId,
      ).mockResolvedValueOnce(null);

      const result = await service.getRequiredToolsAuditSummary('run-missing');

      expect(result).toBeNull();
    });
  });
});
