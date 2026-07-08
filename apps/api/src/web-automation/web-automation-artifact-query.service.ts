import { Injectable, NotFoundException } from '@nestjs/common';
import { WebAutomationFailureArtifact } from './database/entities/web-automation-failure-artifact.entity';
import { WebAutomationFailureArtifactRepository } from './database/repositories/web-automation-failure-artifact.repository';

@Injectable()
export class WebAutomationArtifactQueryService {
  constructor(
    private readonly artifactRepository: WebAutomationFailureArtifactRepository,
  ) {}

  async listRunArtifacts(
    workflowRunId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: Record<string, unknown>[]; total: number }> {
    const [artifacts, total] =
      await this.artifactRepository.findByWorkflowRunId(
        workflowRunId,
        limit,
        offset,
      );

    return {
      data: artifacts.map((artifact) => this.toListItem(artifact)),
      total,
    };
  }

  async getRunArtifact(
    workflowRunId: string,
    artifactId: string,
  ): Promise<Record<string, unknown>> {
    const artifact = await this.artifactRepository.findById(artifactId);

    if (!artifact || artifact.workflow_run_id !== workflowRunId) {
      throw new NotFoundException(
        `Web automation artifact '${artifactId}' not found for run '${workflowRunId}'`,
      );
    }

    return this.toDetail(artifact);
  }

  private toListItem(
    artifact: WebAutomationFailureArtifact,
  ): Record<string, unknown> {
    return {
      id: artifact.id,
      workflow_run_id: artifact.workflow_run_id,
      step_id: artifact.step_id,
      action_name: artifact.action_name,
      attempt_count: artifact.attempt_count,
      duration_ms: artifact.duration_ms,
      error_message: artifact.error_message,
      dom_snapshot_hash: artifact.dom_snapshot_hash,
      created_at: artifact.created_at,
    };
  }

  private toDetail(
    artifact: WebAutomationFailureArtifact,
  ): Record<string, unknown> {
    return {
      id: artifact.id,
      workflow_run_id: artifact.workflow_run_id,
      step_id: artifact.step_id,
      action_name: artifact.action_name,
      action_payload: artifact.action_payload,
      selector_trace: artifact.selector_trace,
      attempts: artifact.attempts,
      attempt_count: artifact.attempt_count,
      duration_ms: artifact.duration_ms,
      error_message: artifact.error_message,
      dom_snapshot_hash: artifact.dom_snapshot_hash,
      dom_snapshot: artifact.dom_snapshot,
      screenshot_base64: artifact.screenshot_base64,
      created_at: artifact.created_at,
      updated_at: artifact.updated_at,
    };
  }
}
