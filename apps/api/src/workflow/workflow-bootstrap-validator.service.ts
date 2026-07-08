import { Injectable } from '@nestjs/common';
import type { IJob, IWorkflow, IWorkflowDefinition } from '@nexus/core';
import { WorkflowParserService } from './workflow-parser.service';

interface WorkflowContract {
  workflowId: string;
  expectedTriggerEvent: string;
  requiredEmittedEvents: string[];
}

const CRITICAL_WORKFLOW_CONTRACTS: WorkflowContract[] = [];

@Injectable()
export class WorkflowBootstrapValidatorService {
  constructor(private readonly workflowParser: WorkflowParserService) {}

  validateCriticalWorkflows(workflows: IWorkflow[]): {
    ok: boolean;
    errors: string[];
  } {
    const definitions = this.parseActiveWorkflowDefinitions(workflows);
    const errors: string[] = [];

    for (const contract of CRITICAL_WORKFLOW_CONTRACTS) {
      const definition = definitions.get(contract.workflowId);
      if (!definition) {
        errors.push(this.buildMissingWorkflowError(contract));
        continue;
      }

      errors.push(...this.collectContractErrors(contract, definition));
    }

    return {
      ok: errors.length === 0,
      errors,
    };
  }

  assertCriticalWorkflows(workflows: IWorkflow[]): void {
    const result = this.validateCriticalWorkflows(workflows);
    if (result.ok) {
      return;
    }

    throw new Error(
      `Critical orchestration workflow validation failed:\n- ${result.errors.join('\n- ')}`,
    );
  }

  private parseActiveWorkflowDefinitions(
    workflows: IWorkflow[],
  ): Map<string, IWorkflowDefinition> {
    const definitions = new Map<string, IWorkflowDefinition>();

    for (const workflow of workflows) {
      if (!workflow.is_active) {
        continue;
      }

      try {
        const parsed = this.workflowParser.parseWorkflow(
          workflow.yaml_definition,
        );
        if (!definitions.has(parsed.workflow_id)) {
          definitions.set(parsed.workflow_id, parsed);
        }
      } catch {
        // Invalid YAML is surfaced through missing/contract errors when expected IDs are absent.
      }
    }

    return definitions;
  }

  private buildMissingWorkflowError(contract: WorkflowContract): string {
    return `Missing critical workflow '${contract.workflowId}' in active workflow registry.`;
  }

  private collectContractErrors(
    contract: WorkflowContract,
    definition: IWorkflowDefinition,
  ): string[] {
    const errors: string[] = [];
    const triggerError = this.validateTrigger(contract, definition);
    if (triggerError) {
      errors.push(triggerError);
    }

    errors.push(...this.validateEmitEventContracts(contract, definition.jobs));
    return errors;
  }

  private validateTrigger(
    contract: WorkflowContract,
    definition: IWorkflowDefinition,
  ): string | null {
    const triggerName = definition.trigger?.event ?? definition.trigger?.name;
    if (
      definition.trigger?.type === 'event' &&
      triggerName === contract.expectedTriggerEvent
    ) {
      return null;
    }

    return `Workflow '${contract.workflowId}' trigger mismatch: expected event '${contract.expectedTriggerEvent}' but found '${triggerName || 'undefined'}' (type '${definition.trigger?.type ?? 'undefined'}').`;
  }

  private validateEmitEventContracts(
    contract: WorkflowContract,
    jobs: IJob[] | undefined,
  ): string[] {
    const errors: string[] = [];

    for (const expectedEventName of contract.requiredEmittedEvents) {
      if (this.hasEmitEventJob(jobs, expectedEventName)) {
        continue;
      }

      errors.push(
        `Workflow '${contract.workflowId}' must contain an emit_event job for '${expectedEventName}'.`,
      );
    }

    return errors;
  }

  private hasEmitEventJob(
    jobs: IJob[] | undefined,
    eventName: string,
  ): boolean {
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return false;
    }

    for (const job of jobs) {
      if (job.type !== 'emit_event') {
        continue;
      }

      const inputs =
        job.inputs && typeof job.inputs === 'object' ? job.inputs : null;

      const emittedEventName =
        inputs && typeof inputs.event_name === 'string'
          ? inputs.event_name
          : null;

      if (emittedEventName === eventName) {
        return true;
      }
    }

    return false;
  }
}
