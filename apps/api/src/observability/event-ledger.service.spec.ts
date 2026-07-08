import { Test, TestingModule } from '@nestjs/testing';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EventLedgerService } from './event-ledger.service';
import { EventLedgerRepository } from '../runtime/database/repositories/event-ledger.repository';
import { RequestContextService } from '../common/request-context.service';
import { AUTONOMY_EVENT_NAMES } from './autonomy-observability.types';

// Prevent RequestContextLogger.init from running during tests
vi.mock('../common/logger.config', () => ({
  RequestContextLogger: {
    init: vi.fn(),
  },
}));

describe('EventLedgerService', () => {
  let service: EventLedgerService;
  let repository: EventLedgerRepository;
  let contextService: RequestContextService;

  beforeEach(async () => {
    contextService = new RequestContextService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventLedgerService,
        {
          provide: EventLedgerRepository,
          useValue: {
            append: vi
              .fn()
              .mockImplementation((data: Record<string, unknown>) =>
                Promise.resolve({
                  id: 'event-1',
                  occurred_at: new Date('2026-01-01T00:00:00.000Z'),
                  ...data,
                }),
              ),
            findById: vi.fn().mockResolvedValue({ id: 'event-1' }),
            findByCorrelationId: vi.fn().mockResolvedValue([[], 0]),
            query: vi.fn().mockResolvedValue([[], 0]),
          },
        },
        {
          provide: RequestContextService,
          useValue: contextService,
        },
      ],
    }).compile();

    service = module.get<EventLedgerService>(EventLedgerService);
    repository = module.get<EventLedgerRepository>(EventLedgerRepository);
  });

  it('enriches emitted events from request context and redacts sensitive payload keys', async () => {
    await contextService.run(
      {
        requestId: 'req-123',
        userId: 'user-1',
        workflowRunId: 'run-1',
        stepId: 'step-1',
      },
      async () => {
        await service.emit({
          domain: 'tool',
          eventName: 'tool.execution.completed',
          outcome: 'success',
          toolName: 'submit_qa_decision',
          payload: {
            decision: 'accept',
            apiKey: 'should-not-be-stored',
            access_token: 'access-token-secret',
            refresh_token: 'refresh-token-secret',
            nested: {
              Authorization: 'Bearer token',
              message: 'contains access_token value',
            },
          },
        });
      },
    );

    expect(repository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'tool',
        event_name: 'tool.execution.completed',
        request_id: 'req-123',
        correlation_id: 'req-123',
        actor_id: 'user-1',
        workflow_run_id: 'run-1',
        step_id: 'step-1',
        payload: {
          decision: 'accept',
          apiKey: '[REDACTED]',
          access_token: '[REDACTED]',
          refresh_token: '[REDACTED]',
          nested: {
            Authorization: '[REDACTED]',
            message: '[REDACTED]',
          },
        },
      }),
    );
  });

  it('maps query filters to repository query params', async () => {
    await service.query({
      domain: 'external',
      workflowRunId: 'run-1',
      context: {
        scopeId: 'project-1',
        contextId: 'resource-1',
        contextType: 'resource',
      },
      limit: 25,
      offset: 10,
    });

    expect(repository.query).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'external',
        workflow_run_id: 'run-1',
        scopeId: 'project-1',
        contextId: 'resource-1',
        limit: 25,
        offset: 10,
      }),
    );
  });

  it('passes autonomy event names and work item ids through to repository filters', async () => {
    const autonomyEventQueries = [
      {
        eventName: AUTONOMY_EVENT_NAMES.skillProposalCreated,
        context: {
          scopeId: 'project-1',
          contextId: '11111111-1111-4111-8111-111111111111',
          contextType: 'resource',
        },
      },
      {
        eventName: AUTONOMY_EVENT_NAMES.failureClassificationDecided,
        context: {
          scopeId: 'project-1',
          contextId: '22222222-2222-4222-8222-222222222222',
          contextType: 'resource',
        },
      },
      {
        eventName: AUTONOMY_EVENT_NAMES.repairDelegationDecided,
        context: {
          scopeId: 'project-1',
          contextId: '33333333-3333-4333-8333-333333333333',
          contextType: 'resource',
        },
      },
      {
        eventName: AUTONOMY_EVENT_NAMES.qaDecisionSubmitted,
        context: {
          scopeId: 'project-1',
          contextId: '44444444-4444-4444-8444-444444444444',
          contextType: 'resource',
        },
      },
    ];

    vi.mocked(repository.query).mockClear();

    for (const query of autonomyEventQueries) {
      await service.query(query);
    }

    expect(repository.query).toHaveBeenCalledTimes(autonomyEventQueries.length);
    autonomyEventQueries.forEach((query, index) => {
      expect(repository.query).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          event_name: query.eventName,
          scopeId: query.context.scopeId,
          contextId: query.context.contextId,
        }),
      );
    });
  });

  it('does not throw from emitBestEffort when repository append fails', async () => {
    vi.mocked(repository.append).mockRejectedValueOnce(
      new Error('db unavailable'),
    );

    await expect(
      service.emitBestEffort({
        domain: 'workflow',
        eventName: 'workflow.run.started',
        outcome: 'in_progress',
      }),
    ).resolves.toBeUndefined();
  });
});
