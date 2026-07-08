import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';
import type { WorkflowParserService } from './workflow-parser.service';

describe('WorkflowTriggerRegistryService', () => {
  const parseWorkflowMock = vi.fn();

  const workflowParser = {
    parseWorkflow: parseWorkflowMock,
  } as unknown as WorkflowParserService;

  let service: WorkflowTriggerRegistryService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WorkflowTriggerRegistryService(workflowParser);
  });

  it('resolves event bindings for active workflows only', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_event',
      name: 'Event Workflow',
      trigger: { type: 'event', name: 'ProjectUpdated' },
      steps: [],
    });

    const bindings = service.resolveEventBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
      { id: 'wf-2', is_active: false, yaml_definition: 'yaml-2' } as never,
    ]);

    expect(parseWorkflowMock).toHaveBeenCalledTimes(1);
    expect(bindings).toEqual([
      {
        workflowId: 'wf-1',
        workflowName: 'Event Workflow',
        workflowDefinitionId: 'workflow_event',
        triggerName: 'ProjectUpdated',
        triggerType: 'event',
        bindingSource: 'workflow_row',
      },
    ]);
  });

  it('supports trigger.event for webhook bindings', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_webhook',
      name: 'Webhook Workflow',
      trigger: { type: 'webhook', event: 'generic.webhook.event' },
      steps: [],
    });

    const bindings = service.resolveWebhookBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);

    expect(bindings).toEqual([
      {
        workflowId: 'wf-1',
        workflowName: 'Webhook Workflow',
        workflowDefinitionId: 'workflow_webhook',
        triggerName: 'generic.webhook.event',
        triggerType: 'webhook',
        bindingSource: 'workflow_row',
      },
    ]);
  });

  it('skips workflows with mismatched trigger types', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_manual',
      name: 'Manual Workflow',
      trigger: { type: 'manual' },
      steps: [],
    });

    const eventBindings = service.resolveEventBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);
    const webhookBindings = service.resolveWebhookBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);

    expect(eventBindings).toEqual([]);
    expect(webhookBindings).toEqual([]);
  });

  it('skips malformed workflows without throwing', () => {
    parseWorkflowMock.mockImplementation(() => {
      throw new Error('invalid yaml');
    });

    const bindings = service.resolveEventBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'bad-yaml' } as never,
    ]);

    expect(bindings).toEqual([]);
  });

  it('deduplicates duplicate logical event bindings by workflow_id', () => {
    parseWorkflowMock
      .mockReturnValueOnce({
        workflow_id: 'resource_in_progress_default',
        name: 'In-Progress Workflow (new)',
        trigger: {
          type: 'event',
          event: 'external.resource.status_changed.v1',
          condition:
            "{{#if (eq trigger.status 'in-progress')}}true{{else}}false{{/if}}",
        },
        steps: [],
      })
      .mockReturnValueOnce({
        workflow_id: 'resource_in_progress_default',
        name: 'In-Progress Workflow (old)',
        trigger: {
          type: 'event',
          event: 'external.resource.status_changed.v1',
          condition:
            "{{#if (eq trigger.status 'in-progress')}}true{{else}}false{{/if}}",
        },
        steps: [],
      });

    const bindings = service.resolveEventBindings([
      {
        id: 'wf-new',
        is_active: true,
        yaml_definition: 'yaml-new',
        updated_at: '2026-03-29T18:00:00.000Z',
      } as never,
      {
        id: 'wf-old',
        is_active: true,
        yaml_definition: 'yaml-old',
        updated_at: '2026-03-28T18:00:00.000Z',
      } as never,
    ]);

    expect(bindings).toEqual([
      {
        workflowId: 'wf-new',
        workflowName: 'In-Progress Workflow (new)',
        workflowDefinitionId: 'resource_in_progress_default',
        triggerName: 'external.resource.status_changed.v1',
        triggerType: 'event',
        bindingSource: 'workflow_row',
        condition:
          "{{#if (eq trigger.status 'in-progress')}}true{{else}}false{{/if}}",
      },
    ]);
  });

  it('includes trigger.condition in binding when declared on the trigger', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_split',
      name: 'Split Workflow',
      trigger: {
        type: 'event',
        event: 'external.resource.status_changed.v1',
        condition:
          "{{#if (and (eq trigger.status 'refinement') (eq trigger.context.scope 'large'))}}true{{else}}false{{/if}}",
      },
      steps: [],
    });

    const bindings = service.resolveEventBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);

    expect(bindings).toEqual([
      {
        workflowId: 'wf-1',
        workflowName: 'Split Workflow',
        workflowDefinitionId: 'workflow_split',
        triggerName: 'external.resource.status_changed.v1',
        triggerType: 'event',
        bindingSource: 'workflow_row',
        condition:
          "{{#if (and (eq trigger.status 'refinement') (eq trigger.context.scope 'large'))}}true{{else}}false{{/if}}",
      },
    ]);
  });

  it('omits condition when the trigger declares an empty string', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_plain',
      name: 'Plain Workflow',
      trigger: {
        type: 'webhook',
        event: 'external.ticket.done',
        condition: '   ',
      },
      steps: [],
    });

    const bindings = service.resolveWebhookBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).not.toHaveProperty('condition');
  });

  it('includes triggerType and deterministic diagnostic metadata in webhook bindings', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_webhook',
      name: 'Webhook Workflow',
      trigger: { type: 'webhook', event: 'generic.webhook.event' },
      steps: [],
    });

    const bindings = service.resolveWebhookBindings([
      { id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never,
    ]);

    expect(bindings[0]).toHaveProperty('triggerType', 'webhook');
    expect(bindings[0]).toHaveProperty('bindingSource', 'workflow_row');
    expect(bindings[0]).not.toHaveProperty('parseError');
  });

  it('resolves lifecycle bindings by matching phase and hook', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_lifecycle',
      name: 'Lifecycle Workflow',
      trigger: {
        type: 'lifecycle',
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
        condition:
          "{{#if (eq trigger.scopeId 'scope-1')}}true{{else}}false{{/if}}",
      },
      steps: [],
    });

    const bindings = service.resolveLifecycleBindings(
      [{ id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never],
      { phase: 'review', hook: 'before_transition' },
    );

    expect(bindings).toEqual([
      {
        workflowId: 'wf-1',
        workflowName: 'Lifecycle Workflow',
        workflowDefinitionId: 'workflow_lifecycle',
        triggerName: 'review.before_transition',
        triggerType: 'lifecycle',
        bindingSource: 'workflow_row',
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
        condition:
          "{{#if (eq trigger.scopeId 'scope-1')}}true{{else}}false{{/if}}",
      },
    ]);
  });

  it('filters lifecycle bindings to blocking triggers when requested', () => {
    parseWorkflowMock
      .mockReturnValueOnce({
        workflow_id: 'workflow_blocking',
        name: 'Blocking Workflow',
        trigger: {
          type: 'lifecycle',
          phase: 'review',
          hook: 'before_transition',
          blocking: true,
        },
        steps: [],
      })
      .mockReturnValueOnce({
        workflow_id: 'workflow_non_blocking',
        name: 'Non Blocking Workflow',
        trigger: {
          type: 'lifecycle',
          phase: 'review',
          hook: 'before_transition',
        },
        steps: [],
      });

    const bindings = service.resolveLifecycleBindings(
      [
        { id: 'wf-blocking', is_active: true, yaml_definition: 'yaml-1' },
        { id: 'wf-non-blocking', is_active: true, yaml_definition: 'yaml-2' },
      ] as never,
      { phase: 'review', hook: 'before_transition', blockingOnly: true },
    );

    expect(bindings).toEqual([
      expect.objectContaining({ workflowId: 'wf-blocking', blocking: true }),
    ]);
  });

  it('includes non-blocking lifecycle bindings when blockingOnly is omitted or false', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_non_blocking',
      name: 'Non Blocking Workflow',
      trigger: {
        type: 'lifecycle',
        phase: 'review',
        hook: 'after_transition',
      },
      steps: [],
    });

    const omitted = service.resolveLifecycleBindings(
      [{ id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never],
      { phase: 'review', hook: 'after_transition' },
    );
    const explicitFalse = service.resolveLifecycleBindings(
      [{ id: 'wf-1', is_active: true, yaml_definition: 'yaml-1' } as never],
      { phase: 'review', hook: 'after_transition', blockingOnly: false },
    );

    expect(omitted[0]).toEqual(expect.objectContaining({ blocking: false }));
    expect(explicitFalse[0]).toEqual(
      expect.objectContaining({ blocking: false }),
    );
  });

  it('ignores inactive lifecycle workflows', () => {
    parseWorkflowMock.mockReturnValue({
      workflow_id: 'workflow_lifecycle',
      name: 'Lifecycle Workflow',
      trigger: {
        type: 'lifecycle',
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
      },
      steps: [],
    });

    const bindings = service.resolveLifecycleBindings(
      [{ id: 'wf-1', is_active: false, yaml_definition: 'yaml-1' } as never],
      { phase: 'review', hook: 'before_transition' },
    );

    expect(parseWorkflowMock).not.toHaveBeenCalled();
    expect(bindings).toEqual([]);
  });

  it('deduplicates lifecycle bindings by workflow definition, phase, and hook using recency', () => {
    parseWorkflowMock
      .mockReturnValueOnce({
        workflow_id: 'workflow_lifecycle_default',
        name: 'Lifecycle Workflow (new)',
        trigger: {
          type: 'lifecycle',
          phase: 'review',
          hook: 'before_transition',
          blocking: true,
        },
        steps: [],
      })
      .mockReturnValueOnce({
        workflow_id: 'workflow_lifecycle_default',
        name: 'Lifecycle Workflow (old)',
        trigger: {
          type: 'lifecycle',
          phase: 'review',
          hook: 'before_transition',
          blocking: true,
        },
        steps: [],
      });

    const bindings = service.resolveLifecycleBindings(
      [
        {
          id: 'wf-old',
          is_active: true,
          yaml_definition: 'yaml-old',
          updated_at: '2026-03-28T18:00:00.000Z',
        },
        {
          id: 'wf-new',
          is_active: true,
          yaml_definition: 'yaml-new',
          updated_at: '2026-03-29T18:00:00.000Z',
        },
      ] as never,
      { phase: 'review', hook: 'before_transition' },
    );

    expect(bindings).toEqual([
      expect.objectContaining({
        workflowId: 'wf-new',
        workflowName: 'Lifecycle Workflow (new)',
        workflowDefinitionId: 'workflow_lifecycle_default',
      }),
    ]);
  });

  it('captures malformed webhook workflows in resolveWebhookDiagnostics summary', () => {
    parseWorkflowMock
      .mockReturnValueOnce({
        workflow_id: 'workflow_ok',
        name: 'Ok Workflow',
        trigger: { type: 'webhook', event: 'external.ticket.ok' },
        steps: [],
      })
      .mockImplementationOnce(() => {
        throw new Error('yaml parse failure');
      });

    const diagnostics = service.resolveWebhookDiagnostics([
      { id: 'wf-ok', is_active: true, yaml_definition: 'good-yaml' } as never,
      { id: 'wf-bad', is_active: true, yaml_definition: 'bad-yaml' } as never,
    ]);

    expect(diagnostics.bindings).toHaveLength(1);
    expect(diagnostics.bindings[0].workflowId).toBe('wf-ok');
    expect(diagnostics.skipped).toHaveLength(1);
    expect(diagnostics.skipped[0].workflowId).toBe('wf-bad');
    expect(diagnostics.skipped[0].error).toBe('yaml parse failure');
  });

  it('uses registration recency and duplicate suppression in webhook diagnostics', () => {
    parseWorkflowMock
      .mockReturnValueOnce({
        workflow_id: 'workflow_webhook_default',
        name: 'Webhook Workflow (new)',
        trigger: { type: 'webhook', event: 'generic.webhook.event' },
        steps: [],
      })
      .mockReturnValueOnce({
        workflow_id: 'workflow_webhook_default',
        name: 'Webhook Workflow (old)',
        trigger: { type: 'webhook', event: 'generic.webhook.event' },
        steps: [],
      });

    const diagnostics = service.resolveWebhookDiagnostics([
      {
        id: 'wf-old',
        is_active: true,
        yaml_definition: 'yaml-old',
        updated_at: '2026-03-28T18:00:00.000Z',
      } as never,
      {
        id: 'wf-new',
        is_active: true,
        yaml_definition: 'yaml-new',
        updated_at: '2026-03-29T18:00:00.000Z',
      } as never,
    ]);

    expect(diagnostics.bindings).toEqual([
      expect.objectContaining({
        workflowId: 'wf-new',
        workflowName: 'Webhook Workflow (new)',
        workflowDefinitionId: 'workflow_webhook_default',
        triggerName: 'generic.webhook.event',
      }),
    ]);
    expect(diagnostics.skipped).toEqual([
      {
        workflowId: 'wf-old',
        reason: 'duplicate_binding',
        error:
          "duplicate webhook binding for workflow definition 'workflow_webhook_default' on 'generic.webhook.event'",
      },
    ]);
    expect(diagnostics.summary).toEqual({
      activeWorkflowCount: 2,
      bindingCount: 1,
      skippedCount: 1,
      duplicateSuppressionCount: 1,
    });
  });
});
