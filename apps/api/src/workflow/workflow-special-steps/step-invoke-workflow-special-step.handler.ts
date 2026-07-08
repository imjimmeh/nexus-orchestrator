import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowDefinitionRepository,
  type IWorkflowEngineService,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

const WORKFLOW_DEFINITION_ID_REGEX = /^workflow_id:\s*(\S+)/m;

@Injectable()
export class StepInvokeWorkflowSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'invoke_workflow' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'job.workflow_id or inputs.workflow_id',
  } as const;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly support: StepSupportService,
    private readonly eventPublisher: StepEventPublisherService,
    @Optional()
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository?: IWorkflowDefinitionRepository,
    @Optional()
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepository?: IWorkflowRunRepository,
  ) {}

  async execute({
    workflowRunId,
    stepId,
    step,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const childWorkflowId = this.support.resolveInvokedWorkflowId(step);
    if (!childWorkflowId) {
      throw new Error(
        `Step ${stepId} has type invoke_workflow but no workflow_id was provided`,
      );
    }

    const resolvedChildWorkflowId =
      await this.resolveWorkflowIdentifierForInvocation(childWorkflowId);

    // Check for an already-active child run for this parent run + step.
    // This prevents duplicate child spawning when the parent job is retried
    // after an invoke timeout (e.g. BullMQ attempt failure and re-queue).
    const existingChild = this.runRepository
      ? await this.runRepository.findActiveChildRunForParentStep(
          workflowRunId,
          stepId,
        )
      : null;

    let childRunId: string | null;
    let reused = false;

    if (existingChild) {
      childRunId = existingChild.id;
      reused = true;
      await this.eventPublisher.publishProcessEvent(
        workflowRunId,
        'invoke_workflow.child_reused',
        {
          stepId,
          childRunId,
          invokedWorkflowId: resolvedChildWorkflowId,
          childStatus: existingChild.status,
        },
      );
    } else {
      childRunId = await this.getWorkflowEngine().startWorkflow(
        resolvedChildWorkflowId,
        {
          parentWorkflowRunId: workflowRunId,
          parentStepId: stepId,
          ...resolvedStepInputs,
        },
      );

      if (childRunId) {
        await this.eventPublisher.publishProcessEvent(
          workflowRunId,
          'invoke_workflow.child_started',
          {
            stepId,
            childRunId,
            invokedWorkflowId: resolvedChildWorkflowId,
          },
        );
      }
    }

    if (!childRunId) {
      if (step.continue_on_concurrency_skip === true) {
        return {
          result: {
            status: 'completed',
            mode: 'workflow_invocation',
            childRunId: '',
          },
          output: {
            ok: false,
            stepId,
            invokedWorkflowId: resolvedChildWorkflowId,
            childRunId: null,
            childWorkflowStatus: 'SKIPPED',
            reason: 'concurrency_policy',
          },
        };
      }

      throw new Error(
        `Step ${stepId} could not start child workflow ${resolvedChildWorkflowId} because concurrency policy skipped the invocation`,
      );
    }

    const waitForCompletion = step.wait_for_completion !== false;
    let childResult: {
      status: import('@nexus/core').WorkflowStatus;
      stateVariables: Record<string, unknown>;
    } | null = null;

    if (waitForCompletion) {
      try {
        childResult =
          await this.support.waitForWorkflowRunCompletion(childRunId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.eventPublisher.publishProcessEvent(
          workflowRunId,
          'invoke_workflow.wait_failed',
          {
            stepId,
            childRunId,
            invokedWorkflowId: resolvedChildWorkflowId,
            reason: message,
          },
        );
        throw err;
      }
    }

    return {
      result: {
        status: 'completed',
        mode: 'workflow_invocation',
        childRunId,
      },
      output: {
        ok: true,
        stepId,
        invokedWorkflowId: resolvedChildWorkflowId,
        childRunId,
        childWorkflowStatus: childResult?.status || 'RUNNING',
        childStateVariables: childResult?.stateVariables,
        waitForCompletion,
        reused,
      },
    };
  }

  private async resolveWorkflowIdentifierForInvocation(
    workflowIdentifier: string,
  ): Promise<string> {
    const trimmedIdentifier = workflowIdentifier.trim();
    if (this.isUuid(trimmedIdentifier) || !this.workflowRepository) {
      return trimmedIdentifier;
    }

    const workflows = await this.workflowRepository.findAll({
      includeInactive: true,
    });
    const targetIdentifier = normalizeWorkflowIdentifier(trimmedIdentifier);

    const matched = workflows.find((workflow) => {
      const definitionWorkflowId = extractWorkflowDefinitionId(
        workflow.yaml_definition,
      );

      const normalizedIdentifiers = [
        workflow.id,
        workflow.name,
        definitionWorkflowId,
      ]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => normalizeWorkflowIdentifier(value));

      return normalizedIdentifiers.includes(targetIdentifier);
    });

    return matched?.id ?? trimmedIdentifier;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private getWorkflowEngine(): IWorkflowEngineService {
    // Resolve only when executing. Constructor injection creates a startup cycle:
    // validation -> special-step registry -> invoke handler -> workflow engine -> validation.
    return this.moduleRef.get(WORKFLOW_ENGINE_SERVICE, {
      strict: false,
    });
  }
}

function normalizeWorkflowIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

function extractWorkflowDefinitionId(yamlDefinition: unknown): string | null {
  if (typeof yamlDefinition !== 'string') {
    return null;
  }

  const match = WORKFLOW_DEFINITION_ID_REGEX.exec(yamlDefinition);
  if (!match || typeof match[1] !== 'string') {
    return null;
  }

  const workflowId = match[1].trim();
  return workflowId.length > 0 ? workflowId : null;
}
