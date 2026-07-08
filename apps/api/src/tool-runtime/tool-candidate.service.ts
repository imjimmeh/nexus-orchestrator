import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ToolArtifactRepository } from '../tool/database/repositories/tool-artifact.repository';
import { ToolValidationRunRepository } from '../tool/database/repositories/tool-validation-run.repository';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import { ToolSandboxService } from './tool-sandbox.service';
import type {
  CreateToolCandidateDraftPayload,
  ToolCandidateListFilters,
} from './tool-candidate.service.types';
import type {
  IToolApiCallback,
  IToolArtifact,
  IToolRegistry,
  IToolValidationRun,
} from '@nexus/core';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ToolRegistry } from '../tool/database/entities/tool-registry.entity';

@Injectable()
export class ToolCandidateService {
  constructor(
    private readonly artifactRepository: ToolArtifactRepository,
    private readonly validationRunRepository: ToolValidationRunRepository,
    private readonly registryRepository: ToolRegistryRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly sandboxService: ToolSandboxService,
  ) {}

  async createDraft(
    payload: CreateToolCandidateDraftPayload,
  ): Promise<IToolArtifact> {
    try {
      const latestVersion =
        await this.artifactRepository.findMaxVersionByToolName(
          payload.tool_name,
        );
      const version = (latestVersion ?? 0) + 1;
      const artifact = await this.artifactRepository.create({
        tool_name: payload.tool_name,
        language: payload.language,
        source_code: payload.source_code,
        test_spec: payload.test_spec ?? null,
        schema: payload.schema,
        checksum: this.computeChecksum(payload.source_code),
        version,
        status: 'draft',
        is_active: false,
      });

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.create.succeeded',
        outcome: 'success',
        toolName: artifact.tool_name,
        payload: { artifact_id: artifact.id, version: artifact.version },
      });

      return artifact;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.create.failed',
        outcome: 'failure',
        toolName: payload.tool_name,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async listCandidates(
    filters: ToolCandidateListFilters,
  ): Promise<{ items: IToolArtifact[]; total: number }> {
    const [items, total] = await this.artifactRepository.findPaged(
      filters.limit,
      filters.offset,
      {
        status: filters.status,
        tool_name: filters.tool_name,
      },
    );

    return { items, total };
  }

  async getCandidate(id: string): Promise<IToolArtifact> {
    const artifact = await this.artifactRepository.findById(id);
    if (!artifact) {
      throw new NotFoundException(`Candidate ${id} not found`);
    }
    return artifact;
  }

  async listValidationRuns(
    artifactId: string,
    pagination: { limit: number; offset: number },
  ): Promise<{ items: IToolValidationRun[]; total: number }> {
    await this.getCandidate(artifactId);
    const [items, total] =
      await this.validationRunRepository.findByArtifactIdPaged(
        artifactId,
        pagination.limit,
        pagination.offset,
      );
    return { items, total };
  }

  async validateCandidate(artifactId: string): Promise<{
    artifact: IToolArtifact;
    validation_run: IToolValidationRun;
  }> {
    const artifact = await this.getCandidate(artifactId);
    try {
      const result = await this.sandboxService.validateCandidate({
        language: artifact.language,
        source_code: artifact.source_code,
      });

      const validationRun = await this.validationRunRepository.create({
        artifact_id: artifact.id,
        sandbox_image: result.sandbox_image,
        status: result.status,
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        duration_ms: result.duration_ms,
        policy_denials: result.policy_denials ?? null,
      });

      const updatedArtifact = await this.artifactRepository.update(
        artifact.id,
        {
          latest_validation_run_id: validationRun.id,
          validated_at: new Date(),
          status: result.status === 'passed' ? 'validated' : 'failed',
        },
      );
      if (!updatedArtifact) {
        throw new NotFoundException(`Candidate ${artifact.id} not found`);
      }

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.validate.completed',
        outcome: this.mapValidationOutcome(result.status),
        toolName: updatedArtifact.tool_name,
        payload: {
          artifact_id: updatedArtifact.id,
          validation_run_id: validationRun.id,
          status: result.status,
        },
      });

      return {
        artifact: updatedArtifact,
        validation_run: validationRun,
      };
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.validate.failed',
        outcome: 'failure',
        toolName: artifact.tool_name,
        payload: { artifact_id: artifact.id },
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async publishCandidate(artifactId: string): Promise<{
    artifact: IToolArtifact;
    registry: IToolRegistry;
  }> {
    const artifact = await this.getCandidate(artifactId);
    try {
      await this.requireLatestPassedValidation(artifact);
      const publishedArtifact = await this.activatePublishedArtifact(artifact);
      const registry =
        await this.upsertRegistryForPublishedArtifact(publishedArtifact);

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.publish.succeeded',
        outcome: 'success',
        toolName: publishedArtifact.tool_name,
        payload: {
          artifact_id: publishedArtifact.id,
          registry_id: registry.id,
          version: publishedArtifact.version,
        },
      });

      return { artifact: publishedArtifact, registry };
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.candidate.publish.failed',
        outcome: 'failure',
        toolName: artifact.tool_name,
        payload: { artifact_id: artifact.id },
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  private async requireLatestPassedValidation(
    artifact: IToolArtifact,
  ): Promise<void> {
    const latestValidationRun =
      await this.validationRunRepository.findLatestByArtifactId(artifact.id);
    if (!latestValidationRun || latestValidationRun.status !== 'passed') {
      throw new BadRequestException(
        'Candidate must have a passed latest validation run before publish',
      );
    }
  }

  private async activatePublishedArtifact(
    artifact: IToolArtifact,
  ): Promise<IToolArtifact> {
    await this.artifactRepository.deactivateActiveForToolName(
      artifact.tool_name,
    );
    const publishedArtifact = await this.artifactRepository.update(
      artifact.id,
      {
        status: 'published',
        is_active: true,
        published_at: new Date(),
      },
    );
    if (!publishedArtifact) {
      throw new NotFoundException(`Candidate ${artifact.id} not found`);
    }

    return publishedArtifact;
  }

  private async upsertRegistryForPublishedArtifact(
    publishedArtifact: IToolArtifact,
  ): Promise<IToolRegistry> {
    const registryPayload =
      this.buildRegistryPublicationPayload(publishedArtifact);
    const existingRegistry = await this.registryRepository.findByName(
      publishedArtifact.tool_name,
    );
    const registry = existingRegistry
      ? await this.registryRepository.update(
          existingRegistry.id,
          registryPayload as QueryDeepPartialEntity<ToolRegistry>,
        )
      : await this.registryRepository.create({
          ...registryPayload,
          tier_restriction: 0,
        });

    if (!registry) {
      throw new NotFoundException(
        `Tool registry ${publishedArtifact.tool_name} not found`,
      );
    }

    return registry;
  }

  private buildRegistryPublicationPayload(
    publishedArtifact: IToolArtifact,
  ): Partial<IToolRegistry> {
    const callback: IToolApiCallback = {
      method: 'POST',
      path_template: `/api/tools/runtime/${publishedArtifact.tool_name}/execute`,
    };

    return {
      name: publishedArtifact.tool_name,
      schema: publishedArtifact.schema,
      typescript_code: publishedArtifact.source_code,
      language: publishedArtifact.language,
      publication_status: 'published',
      published_artifact_id: publishedArtifact.id,
      published_version: publishedArtifact.version,
      api_callback: callback,
    };
  }

  private computeChecksum(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private mapValidationOutcome(
    status: IToolValidationRun['status'],
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
