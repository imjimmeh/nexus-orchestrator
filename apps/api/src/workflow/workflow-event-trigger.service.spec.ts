import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowEventTriggerService } from './workflow-event-trigger.service';
import { WorkflowInternalDomainEventsService } from './workflow-internal-domain-events.service';
import type { IWorkflowEngineService } from './kernel/interfaces/workflow-kernel.ports';
import type { WorkflowRepository } from './database/repositories/workflow.repository';
import type { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';
import type { WorkflowBootstrapValidatorService } from './workflow-bootstrap-validator.service';

const domainSourceName = 'external';
const statusChangedEventName = 'external.context.status_changed.v1';

function buildLinkedResource(overrides: Record<string, unknown> = {}) {
  return {
    id: 'context-1',
    scope_id: 'scope-1',
    title: 'Implement canonical status event',
    description: 'Ensure status event payloads are complete.',
    status: 'in-progress',
    scope: 'standard',
    priority: 'p1',
    executionConfig: {
      baseBranch: 'main',
      targetBranch: 'feature/status-event',
    },
    metadata: null,
    dependsOn: [],
    blockedBy: [],
    subtasks: [],
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:01:00.000Z',
    linkedRunId: null,
    ...overrides,
  };
}

function buildStatusChangedPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: statusChangedEventName,
    scopeId: 'scope-1',
    contextId: 'context-1',
    status: 'in-progress',
    previousStatus: 'todo',
    actor: 'system',
    resource: buildLinkedResource(),
    ...overrides,
  };
}

describe('WorkflowEventTriggerService', () => {
  let service: WorkflowEventTriggerService;
  const startWorkflowMock = vi.fn();
  const findAllMock = vi.fn();
  const resolveEventBindingsMock = vi.fn();
  const validateCriticalWorkflowsMock = vi.fn();
  const emitMock = vi.fn();
  const onMock = vi.fn();

  const eventEmitter = {
    emit: emitMock,
    on: onMock,
  };

  const workflowEngine = {
    startWorkflow: startWorkflowMock,
  } as unknown as IWorkflowEngineService;

  const workflowRepo = {
    findAll: findAllMock,
  } as unknown as WorkflowRepository;

  const triggerRegistry = {
    resolveEventBindings: resolveEventBindingsMock,
  } as unknown as WorkflowTriggerRegistryService;

  const bootstrapValidator = {
    validateCriticalWorkflows: validateCriticalWorkflowsMock,
  } as unknown as WorkflowBootstrapValidatorService;

  beforeEach(() => {
    vi.clearAllMocks();
    findAllMock.mockResolvedValue([]);
    resolveEventBindingsMock.mockReturnValue([]);
    validateCriticalWorkflowsMock.mockReturnValue({ ok: true, errors: [] });

    service = new WorkflowEventTriggerService(
      eventEmitter,
      workflowEngine,
      workflowRepo,
      triggerRegistry,
      bootstrapValidator,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleWorkflowEventTrigger (null runId)', () => {
    it('does not emit follow-up events when startWorkflow returns null', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Test Dispatch',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
        },
      ]);

      await service.onModuleInit();

      expect(validateCriticalWorkflowsMock).toHaveBeenCalled();

      // Capture the registered handler
      expect(onMock).toHaveBeenCalledWith('TestEvent', expect.any(Function));
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      startWorkflowMock.mockResolvedValue(null);

      await handler({ scope_id: 'scope-1', event: 'TestEvent' });
      expect(emitMock).not.toHaveBeenCalled();
    });

    it('does not emit follow-up events when startWorkflow succeeds', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Test Dispatch',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
        },
      ]);

      await service.onModuleInit();

      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      startWorkflowMock.mockResolvedValue('run-123');

      await handler({ scope_id: 'scope-1', event: 'TestEvent' });
      expect(emitMock).not.toHaveBeenCalled();
    });

    it('does not emit follow-up events when trigger payload has no scope identifier', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Test Dispatch',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
        },
      ]);

      await service.onModuleInit();

      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      startWorkflowMock.mockResolvedValue(null);

      await handler({ someOtherField: 'value' });
      expect(emitMock).not.toHaveBeenCalled();
    });
  });

  describe('trigger.condition', () => {
    it('skips startWorkflow when condition evaluates false', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Conditional',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          condition:
            "{{#if (eq trigger.subject.scope 'large')}}true{{else}}false{{/if}}",
        },
      ]);

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      await handler({ subject: { scope: 'standard' } });
      expect(startWorkflowMock).not.toHaveBeenCalled();
    });

    it('starts workflow when condition evaluates true', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Conditional',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          condition:
            "{{#if (eq trigger.subject.scope 'large')}}true{{else}}false{{/if}}",
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      await handler({ subject: { scope: 'large' } });
      expect(startWorkflowMock).toHaveBeenCalledTimes(1);
    });

    it('starts workflow unconditionally when no condition is declared', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'No condition',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      await handler({ anything: true });
      expect(startWorkflowMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('event dedupe', () => {
    it('deduplicates workflow trigger starts by event id and workflow binding', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Deduped workflow',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      const event = {
        eventId: 'evt-1',
        scopeId: 'scope-1',
      };

      await handler(event);
      await handler(event);

      expect(startWorkflowMock).toHaveBeenCalledTimes(1);
    });

    it('does not treat launch dedupe keys as event-delivery dedupe keys', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Deduped workflow',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      const event = {
        dedupeKey: 'event-key-1',
        scopeId: 'scope-1',
      };

      await handler(event);
      await handler(event);

      expect(startWorkflowMock).toHaveBeenCalledTimes(2);
    });

    it('deduplicates canonical status events by ingested envelope event id', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Status workflow',
          workflowDefinitionId: 'def-1',
          triggerName: statusChangedEventName,
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;
      const eventLedger = { emitBestEffort: vi.fn().mockResolvedValue(null) };
      const domainEvents = new WorkflowInternalDomainEventsService(
        eventLedger as never,
        {
          emit: vi.fn((_eventName: string, payload: unknown) =>
            handler(payload),
          ),
        },
      );

      const event = {
        eventName: statusChangedEventName,
        eventId: 'evt-status-1',
        payload: buildStatusChangedPayload(),
      };

      await domainEvents.ingestDomainEvent(domainSourceName, event);
      await domainEvents.ingestDomainEvent(domainSourceName, event);

      expect(startWorkflowMock).toHaveBeenCalledTimes(1);
    });

    it('does not deduplicate matching event ids across different context ids in the same scope', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Deduped workflow',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      await handler({
        eventId: 'evt-1',
        scopeId: 'scope-1',
        contextId: 'context-1',
      });
      await handler({
        eventId: 'evt-1',
        scopeId: 'scope-1',
        contextId: 'context-2',
      });

      expect(startWorkflowMock).toHaveBeenCalledTimes(2);
    });

    it('does not deduplicate matching event ids across different snake case context ids in the same scope', async () => {
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Deduped workflow',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      await handler({
        eventId: 'evt-1',
        scope_id: 'scope-1',
        context_id: 'context-1',
      });
      await handler({
        eventId: 'evt-1',
        scope_id: 'scope-1',
        context_id: 'context-2',
      });

      expect(startWorkflowMock).toHaveBeenCalledTimes(2);
    });

    it('evicts duplicate event keys after the dedupe ttl expires', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-12T00:00:00.000Z'));
      resolveEventBindingsMock.mockReturnValue([
        {
          workflowId: 'wf-1',
          workflowName: 'Deduped workflow',
          workflowDefinitionId: 'def-1',
          triggerName: 'TestEvent',
          triggerType: 'event',
          bindingSource: 'workflow_row',
        },
      ]);
      startWorkflowMock.mockResolvedValue('run-1');

      await service.onModuleInit();
      const handler = onMock.mock.calls[0][1] as (
        event: unknown,
      ) => Promise<void>;

      const event = {
        eventId: 'evt-ttl-1',
        scopeId: 'scope-1',
      };

      await handler(event);
      await handler(event);
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await handler(event);

      expect(startWorkflowMock).toHaveBeenCalledTimes(2);
    });
  });
});
