import { Injectable, Logger } from '@nestjs/common';
import { IWorkflow, type IWorkflowDefinition } from '@nexus/core';
import { WorkflowParserService } from './workflow-parser.service';

export type { WorkflowTriggerBinding } from './workflow-trigger-registry.service.types';
import type {
  WorkflowTriggerBinding,
  WorkflowTriggerDiagnostics,
} from './workflow-trigger-registry.service.types';

@Injectable()
export class WorkflowTriggerRegistryService {
  private readonly logger = new Logger(WorkflowTriggerRegistryService.name);

  constructor(private readonly workflowParser: WorkflowParserService) {}

  resolveEventBindings(workflows: IWorkflow[]): WorkflowTriggerBinding[] {
    return this.resolveBindingsByType(workflows, 'event');
  }

  resolveWebhookBindings(workflows: IWorkflow[]): WorkflowTriggerBinding[] {
    return this.resolveBindingsByType(workflows, 'webhook');
  }

  resolveLifecycleBindings(
    workflows: IWorkflow[],
    options: { phase: string; hook: string; blockingOnly?: boolean },
  ): WorkflowTriggerBinding[] {
    return this.resolveLifecycleBindingDiagnostics(workflows, options, true)
      .bindings;
  }

  resolveWebhookDiagnostics(
    workflows: IWorkflow[],
  ): WorkflowTriggerDiagnostics {
    return this.resolveBindingDiagnosticsByType(workflows, 'webhook', false);
  }

  private resolveBindingsByType(
    workflows: IWorkflow[],
    triggerType: 'event' | 'webhook',
  ): WorkflowTriggerBinding[] {
    return this.resolveBindingDiagnosticsByType(workflows, triggerType, true)
      .bindings;
  }

  private resolveLifecycleBindingDiagnostics(
    workflows: IWorkflow[],
    options: { phase: string; hook: string; blockingOnly?: boolean },
    logSkipped: boolean,
  ): WorkflowTriggerDiagnostics {
    const bindings: WorkflowTriggerBinding[] = [];
    const skipped: Array<{
      workflowId: string;
      reason: 'parse_error' | 'missing_trigger_name' | 'duplicate_binding';
      error: string;
    }> = [];
    const seenLogicalBindings = new Set<string>();
    const activeWorkflows = workflows.filter((workflow) => workflow.is_active);
    const sortedWorkflows = this.sortByRecency(activeWorkflows);

    for (const workflow of sortedWorkflows) {
      try {
        const definition = this.workflowParser.parseWorkflow(
          workflow.yaml_definition,
        );
        const trigger = definition.trigger;

        if (
          trigger?.type !== 'lifecycle' ||
          trigger.phase !== options.phase ||
          trigger.hook !== options.hook ||
          (options.blockingOnly === true && trigger.blocking !== true)
        ) {
          continue;
        }

        const logicalBindingKey = [
          'lifecycle',
          definition.workflow_id,
          options.phase,
          options.hook,
        ].join(':');

        if (seenLogicalBindings.has(logicalBindingKey)) {
          const error = `duplicate lifecycle binding for workflow definition '${definition.workflow_id}' on '${options.phase}.${options.hook}'`;
          this.recordSkippedWorkflow(
            skipped,
            workflow.id,
            'duplicate_binding',
            error,
            logSkipped
              ? `Skipping ${error} (workflow row ${workflow.id})`
              : undefined,
          );
          continue;
        }

        seenLogicalBindings.add(logicalBindingKey);

        bindings.push(this.buildLifecycleBinding(workflow.id, definition));
      } catch (error) {
        this.recordSkippedWorkflow(
          skipped,
          workflow.id,
          'parse_error',
          (error as Error).message,
          logSkipped
            ? `Skipping workflow ${workflow.id} while resolving lifecycle triggers: ${(error as Error).message}`
            : undefined,
        );
      }
    }

    return {
      bindings,
      skipped,
      summary: {
        activeWorkflowCount: activeWorkflows.length,
        bindingCount: bindings.length,
        skippedCount: skipped.length,
        duplicateSuppressionCount: skipped.filter(
          (entry) => entry.reason === 'duplicate_binding',
        ).length,
      },
    };
  }

  private resolveBindingDiagnosticsByType(
    workflows: IWorkflow[],
    triggerType: 'event' | 'webhook',
    logSkipped: boolean,
  ): WorkflowTriggerDiagnostics {
    const bindings: WorkflowTriggerBinding[] = [];
    const skipped: Array<{
      workflowId: string;
      reason: 'parse_error' | 'missing_trigger_name' | 'duplicate_binding';
      error: string;
    }> = [];
    const seenLogicalBindings = new Set<string>();
    const activeWorkflows = workflows.filter((workflow) => workflow.is_active);

    const sortedWorkflows = this.sortByRecency(activeWorkflows);

    for (const workflow of sortedWorkflows) {
      try {
        const definition = this.workflowParser.parseWorkflow(
          workflow.yaml_definition,
        );

        if (definition.trigger?.type !== triggerType) {
          continue;
        }

        const triggerName = definition.trigger.event || definition.trigger.name;
        if (!triggerName) {
          const error = "missing 'trigger.name' or 'trigger.event'";
          this.recordSkippedWorkflow(
            skipped,
            workflow.id,
            'missing_trigger_name',
            error,
            logSkipped
              ? `Workflow '${definition.workflow_id}' declares ${triggerType} trigger but ${error}`
              : undefined,
          );
          continue;
        }

        const logicalBindingKey = [
          triggerType,
          definition.workflow_id,
          triggerName,
        ].join(':');

        if (seenLogicalBindings.has(logicalBindingKey)) {
          const error = `duplicate ${triggerType} binding for workflow definition '${definition.workflow_id}' on '${triggerName}'`;
          this.recordSkippedWorkflow(
            skipped,
            workflow.id,
            'duplicate_binding',
            error,
            logSkipped
              ? `Skipping ${error} (workflow row ${workflow.id})`
              : undefined,
          );
          continue;
        }

        seenLogicalBindings.add(logicalBindingKey);

        bindings.push(
          this.buildBinding(workflow.id, definition, triggerName, triggerType),
        );
      } catch (error) {
        this.recordSkippedWorkflow(
          skipped,
          workflow.id,
          'parse_error',
          (error as Error).message,
          logSkipped
            ? `Skipping workflow ${workflow.id} while resolving ${triggerType} triggers: ${(error as Error).message}`
            : undefined,
        );
      }
    }

    return {
      bindings,
      skipped,
      summary: {
        activeWorkflowCount: activeWorkflows.length,
        bindingCount: bindings.length,
        skippedCount: skipped.length,
        duplicateSuppressionCount: skipped.filter(
          (entry) => entry.reason === 'duplicate_binding',
        ).length,
      },
    };
  }

  private recordSkippedWorkflow(
    skipped: Array<{
      workflowId: string;
      reason: 'parse_error' | 'missing_trigger_name' | 'duplicate_binding';
      error: string;
    }>,
    workflowId: string,
    reason: 'parse_error' | 'missing_trigger_name' | 'duplicate_binding',
    error: string,
    logMessage?: string,
  ): void {
    skipped.push({ workflowId, reason, error });

    if (logMessage) {
      this.logger.warn(logMessage);
    }
  }

  private buildBinding(
    workflowId: string,
    definition: Pick<IWorkflowDefinition, 'name' | 'workflow_id' | 'trigger'>,
    triggerName: string,
    triggerType: 'event' | 'webhook' | 'lifecycle',
  ): WorkflowTriggerBinding {
    const rawCondition = definition.trigger?.condition;
    const condition =
      typeof rawCondition === 'string' && rawCondition.trim().length > 0
        ? rawCondition
        : undefined;

    return {
      workflowId,
      workflowName: definition.name,
      workflowDefinitionId: definition.workflow_id,
      triggerName,
      triggerType,
      bindingSource: 'workflow_row',
      ...(condition ? { condition } : {}),
    };
  }

  private buildLifecycleBinding(
    workflowId: string,
    definition: IWorkflowDefinition,
  ): WorkflowTriggerBinding {
    const phase = definition.trigger?.phase as string;
    const hook = definition.trigger?.hook as string;
    return {
      ...this.buildBinding(
        workflowId,
        definition,
        `${phase}.${hook}`,
        'lifecycle',
      ),
      phase,
      hook,
      blocking: definition.trigger?.blocking === true,
    };
  }

  private sortByRecency(workflows: IWorkflow[]): IWorkflow[] {
    return [...workflows].sort((a, b) => {
      const timestampA = this.resolveRecencyTimestamp(a);
      const timestampB = this.resolveRecencyTimestamp(b);
      return timestampB - timestampA;
    });
  }

  private resolveRecencyTimestamp(workflow: IWorkflow): number {
    const record = workflow as unknown as {
      updated_at?: string | Date;
      created_at?: string | Date;
    };

    const updatedAt = this.toTimestamp(record.updated_at);
    if (updatedAt > 0) {
      return updatedAt;
    }

    const createdAt = this.toTimestamp(record.created_at);
    if (createdAt > 0) {
      return createdAt;
    }

    return 0;
  }

  private toTimestamp(value: string | Date | undefined): number {
    if (!value) {
      return 0;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }
}
