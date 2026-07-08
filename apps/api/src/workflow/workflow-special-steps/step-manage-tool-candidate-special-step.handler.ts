import { Injectable, Logger } from '@nestjs/common';
import { ToolCandidateService } from '../../tool-runtime/tool-candidate.service';
import {
  ISpecialStepHandler,
  SpecialStepExecutionContext,
  SpecialStepHandlerResult,
} from './step-special-step.types';

type ManageToolCandidateAction = 'validate' | 'publish';

/**
 * Generic handler consolidating validate_tool_candidate and publish_tool_candidate.
 * Replaces separate handlers with a single action-dispatching handler.
 *
 * Inputs:
 *   action: 'validate' | 'publish'
 *   artifact_id: string
 */
@Injectable()
export class StepManageToolCandidateSpecialStepHandler implements ISpecialStepHandler {
  readonly type = 'manage_tool_candidate' as const;
  readonly descriptor = {
    type: this.type,
    owningDomain: 'core',
    inputContract: 'inputs.action + inputs.artifact_id',
  } as const;

  private readonly logger = new Logger(
    StepManageToolCandidateSpecialStepHandler.name,
  );

  constructor(private readonly toolCandidateService: ToolCandidateService) {}

  async execute({
    stepId,
    resolvedStepInputs,
  }: SpecialStepExecutionContext): Promise<SpecialStepHandlerResult> {
    const action = this.resolveAction(stepId, resolvedStepInputs);
    const artifactId = this.resolveArtifactId(stepId, resolvedStepInputs);

    switch (action) {
      case 'validate':
        return this.handleValidate(stepId, artifactId);
      case 'publish':
        return this.handlePublish(stepId, artifactId);
    }
  }

  private resolveAction(
    stepId: string,
    inputs: Record<string, unknown>,
  ): ManageToolCandidateAction {
    const action = inputs.action;
    if (action !== 'validate' && action !== 'publish') {
      throw new Error(
        `Step ${stepId}: manage_tool_candidate requires inputs.action to be 'validate' or 'publish'`,
      );
    }
    return action;
  }

  private resolveArtifactId(
    stepId: string,
    inputs: Record<string, unknown>,
  ): string {
    const artifactId =
      typeof inputs.artifact_id === 'string' ? inputs.artifact_id.trim() : '';
    if (!artifactId) {
      throw new Error(
        `Step ${stepId}: manage_tool_candidate requires inputs.artifact_id`,
      );
    }
    return artifactId;
  }

  private async handleValidate(
    stepId: string,
    artifactId: string,
  ): Promise<SpecialStepHandlerResult> {
    this.logger.log(
      `manage_tool_candidate [${stepId}]: validating artifact ${artifactId}`,
    );
    const validation =
      await this.toolCandidateService.validateCandidate(artifactId);
    const validationRunId = validation.validation_run.id;
    const validationStatus = validation.validation_run.status;

    return {
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'validate',
        artifactId: validation.artifact.id,
      },
      output: {
        ok: true,
        stepId,
        action: 'validate',
        artifact_id: artifactId,
        validation_run_id: validationRunId,
        validation_status: validationStatus,
      },
    };
  }

  private async handlePublish(
    stepId: string,
    artifactId: string,
  ): Promise<SpecialStepHandlerResult> {
    this.logger.log(
      `manage_tool_candidate [${stepId}]: publishing artifact ${artifactId}`,
    );
    const publication =
      await this.toolCandidateService.publishCandidate(artifactId);
    const toolName = publication.registry.name;
    const publishedVersion = publication.artifact.version;

    return {
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'publish',
        artifactId: publication.artifact.id,
      },
      output: {
        ok: true,
        stepId,
        action: 'publish',
        artifact_id: artifactId,
        tool_name: toolName,
        published_version: publishedVersion,
      },
    };
  }
}
