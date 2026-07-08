import { Injectable, NotFoundException } from '@nestjs/common';
import { ToolArtifactRepository } from '../tool/database/repositories/tool-artifact.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { ToolSandboxService } from './tool-sandbox.service';
import type { ToolValidationRunStatus } from '@nexus/core';

@Injectable()
export class ToolRuntimeExecutionService {
  constructor(
    private readonly artifactRepository: ToolArtifactRepository,
    private readonly sandboxService: ToolSandboxService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async executePublishedTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<{
    tool_name: string;
    artifact_id: string;
    version: number;
    status: ToolValidationRunStatus;
    exit_code: number | null;
    stdout: string;
    stderr: string;
    duration_ms: number;
    sandbox_image: string;
    output?: unknown;
  }> {
    const artifact =
      await this.artifactRepository.findActivePublishedByToolName(toolName);
    if (!artifact) {
      throw new NotFoundException(
        `No active published tool found for ${toolName}`,
      );
    }

    try {
      const result = await this.sandboxService.executeCandidate({
        language: artifact.language,
        source_code: artifact.source_code,
        params,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.runtime.execute.completed',
        outcome: this.mapExecutionOutcome(result.status),
        toolName,
        payload: {
          artifact_id: artifact.id,
          version: artifact.version,
          status: result.status,
        },
      });

      return {
        tool_name: artifact.tool_name,
        artifact_id: artifact.id,
        version: artifact.version,
        status: result.status,
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
        sandbox_image: result.sandbox_image,
        output: result.output,
      };
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.runtime.execute.failed',
        outcome: 'failure',
        toolName,
        payload: { artifact_id: artifact.id, version: artifact.version },
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  private mapExecutionOutcome(
    status: ToolValidationRunStatus,
  ): 'success' | 'failure' | 'denied' {
    if (status === 'passed') {
      return 'success';
    }
    if (status === 'policy_denied') {
      return 'denied';
    }
    return 'failure';
  }
}
