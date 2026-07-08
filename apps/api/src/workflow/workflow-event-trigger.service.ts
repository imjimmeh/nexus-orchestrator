import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';
import { WorkflowBootstrapValidatorService } from './workflow-bootstrap-validator.service';
import { evaluateTriggerCondition } from './workflow-trigger-condition.helpers';
import type { WorkflowTriggerBinding } from './workflow-trigger-registry.service.types';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
  type IWorkflowDefinitionRepository,
  type IWorkflowEngineService,
} from './kernel/interfaces/workflow-kernel.ports';

const EVENT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const MAX_EVENT_DEDUPE_KEYS = 1000;

/**
 * WorkflowEventTriggerService
 *
 * Dynamically registers event listeners for all active workflows that declare
 * event-based triggers in their YAML definitions. This allows workflows to be
 * self-describing: no external configuration or hardcoded listeners needed.
 *
 * At app startup (OnModuleInit):
 * 1. Loads all active workflows from database
 * 2. Checks each for trigger.type === 'event'
 * 3. Registers a dynamic event listener for that workflow
 *
 * When an event is emitted:
 * - Listener receives event payload
 * - Passes project/session/file data to workflow as trigger data
 * - Workflow execution uses persisted workflow row ID; YAML workflow_id is retained for diagnostics
 */
@Injectable()
export class WorkflowEventTriggerService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowEventTriggerService.name);
  // Temporary process-local dedupe for EventEmitter delivery.
  // Persist this key if events are replayed across restarts.
  private readonly handledEventKeys = new Map<string, number>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepo: IWorkflowDefinitionRepository,
    private readonly workflowTriggerRegistry: WorkflowTriggerRegistryService,
    private readonly workflowBootstrapValidator: WorkflowBootstrapValidatorService,
  ) {}

  /**
   * Initialize event trigger listeners on module startup.
   * Scans all active workflows and registers listeners for those with event triggers.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Initializing workflow event triggers...');
      const workflows = await this.workflowRepo.findAll();

      const validation =
        this.workflowBootstrapValidator.validateCriticalWorkflows(workflows);
      if (!validation.ok) {
        const message = [
          'Critical orchestration workflow validation failed:',
          ...validation.errors.map((error) => `- ${error}`),
        ].join('\n');

        this.logger.error(message);
        if (
          process.env.WORKFLOW_FAIL_ON_BOOTSTRAP_VALIDATION_ERROR === 'true'
        ) {
          throw new Error(message);
        }
      }

      const bindings =
        this.workflowTriggerRegistry.resolveEventBindings(workflows);

      for (const binding of bindings) {
        this.registerWorkflowEventTrigger(binding);
      }

      this.logger.log(
        `Initialized ${bindings.length} event-driven workflow trigger(s)`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to initialize event triggers: ${err.message}`,
        err.stack,
      );
      // Don't throw — failing to register triggers shouldn't prevent app startup
    }
  }

  /**
   * Register a single workflow's event trigger (if it has one).
   * Returns true if trigger was registered, false otherwise.
   */
  private registerWorkflowEventTrigger(binding: WorkflowTriggerBinding): void {
    // Register dynamic listener for this event
    this.eventEmitter.on(binding.triggerName, (event: unknown): void => {
      void this.handleWorkflowEventTrigger(binding, event);
    });

    this.logger.log(
      `Registered workflow '${binding.workflowName}' (${binding.workflowId}) to listen for event '${binding.triggerName}'`,
    );
  }

  /**
   * Handle a workflow's event trigger invocation.
   * Called when the event is emitted.
   */
  private async handleWorkflowEventTrigger(
    binding: WorkflowTriggerBinding,
    eventPayload: unknown,
  ): Promise<void> {
    let dedupeKey: string | undefined;

    try {
      this.logger.log(
        `Workflow '${binding.workflowName}' triggered by event, starting workflow ${binding.workflowId} (definition: ${binding.workflowDefinitionId})`,
      );

      // Extract trigger data from event payload
      // Handle common event patterns:
      // - If event is an object, pass its properties
      // - If event is a class instance, pass constructor properties
      const triggerData: Record<string, unknown> =
        this.extractTriggerData(eventPayload);

      if (!evaluateTriggerCondition(binding.condition, triggerData)) {
        this.logger.log(
          `Workflow '${binding.workflowName}' (${binding.workflowId}) skipped: trigger.condition evaluated false`,
        );
        return;
      }

      dedupeKey = this.buildEventDedupeKey(binding, triggerData);
      if (dedupeKey && this.isDuplicateEventKey(dedupeKey)) {
        this.logger.log(
          `Workflow '${binding.workflowName}' (${binding.workflowId}) skipped: duplicate event trigger`,
        );
        return;
      }

      if (dedupeKey) {
        this.recordEventKey(dedupeKey);
      }

      const runId = await this.workflowEngine.startWorkflow(
        binding.workflowId,
        triggerData,
      );

      if (typeof runId === 'string') {
        this.logger.log(
          `Workflow '${binding.workflowName}' started with run ID ${runId}`,
        );
      } else if (runId) {
        this.logger.warn(
          `Workflow '${binding.workflowName}' returned non-string run identifier`,
        );
      } else {
        this.logger.warn(
          `Workflow '${binding.workflowName}' skipped (concurrency policy)`,
        );
      }
    } catch (error) {
      if (dedupeKey) {
        this.handledEventKeys.delete(dedupeKey);
      }

      const err = error as Error;
      this.logger.error(
        `Failed to trigger workflow ${binding.workflowId}: ${err.message}`,
        err.stack,
      );
      // Don't rethrow — failed workflow invocation shouldn't crash the event
    }
  }

  /**
   * Extract trigger data from event payload.
   * Converts event object properties into a plain object for workflow input.
   */
  private extractTriggerData(eventPayload: unknown): Record<string, unknown> {
    if (!eventPayload) {
      return {};
    }

    if (typeof eventPayload === 'object') {
      // Convert to plain object (handles class instances, spread operator)
      const result = { ...(eventPayload as Record<string, unknown>) };
      this.copyNonEnumerableStringField(eventPayload, result, 'eventId');
      this.copyNonEnumerableStringField(eventPayload, result, 'dedupeKey');
      return result;
    }

    if (typeof eventPayload === 'string' || typeof eventPayload === 'number') {
      return { value: eventPayload };
    }

    return {};
  }

  private copyNonEnumerableStringField(
    source: object,
    target: Record<string, unknown>,
    fieldName: string,
  ): void {
    if (target[fieldName] !== undefined) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(source, fieldName);
    if (!descriptor || descriptor.enumerable) {
      return;
    }

    const value: unknown = descriptor.value;
    if (typeof value === 'string' || typeof value === 'number') {
      target[fieldName] = String(value);
    }
  }

  private buildEventDedupeKey(
    binding: WorkflowTriggerBinding,
    triggerData: Record<string, unknown>,
  ): string | undefined {
    const eventId = this.readStringField(triggerData, ['eventId']);
    if (!eventId) {
      return undefined;
    }

    return JSON.stringify([
      binding.bindingSource,
      binding.workflowDefinitionId,
      binding.workflowId,
      binding.triggerName,
      this.buildScopeContextFields(triggerData),
      eventId,
    ]);
  }

  private isDuplicateEventKey(dedupeKey: string): boolean {
    this.pruneExpiredEventKeys();
    return this.handledEventKeys.has(dedupeKey);
  }

  private recordEventKey(dedupeKey: string): void {
    this.pruneExpiredEventKeys();
    this.handledEventKeys.set(dedupeKey, Date.now() + EVENT_DEDUPE_TTL_MS);

    while (this.handledEventKeys.size > MAX_EVENT_DEDUPE_KEYS) {
      const oldestKey = this.handledEventKeys.keys().next().value;
      if (!oldestKey) {
        return;
      }
      this.handledEventKeys.delete(oldestKey);
    }
  }

  private pruneExpiredEventKeys(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.handledEventKeys) {
      if (expiresAt <= now) {
        this.handledEventKeys.delete(key);
      }
    }
  }

  private buildScopeContextFields(
    triggerData: Record<string, unknown>,
  ): Record<string, string> {
    const fields: Record<string, string> = {};

    for (const fieldName of [
      'scopeId',
      'scope_id',
      'contextId',
      'context_id',
    ]) {
      const value = triggerData[fieldName];
      if (typeof value === 'string' || typeof value === 'number') {
        fields[fieldName] = String(value);
      }
    }

    return fields;
  }

  private readStringField(
    data: Record<string, unknown>,
    fieldNames: string[],
  ): string | undefined {
    for (const fieldName of fieldNames) {
      const value = data[fieldName];
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
    }

    return undefined;
  }
}
