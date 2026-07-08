import { Injectable, Logger } from '@nestjs/common';
import type { IToolRegistry } from '@nexus/core';
import { ToolRegistryService } from './tool-registry.service';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { mapCapabilityEntryToToolRegistryPayload } from '../capability-infra/capability-manifest-to-tool-registry.mapper';
import type {
  CanonicalCapabilityDefinition,
  CanonicalCapabilityRegistrationSummary,
  ToolProjectionRegistrationRequest,
} from '../capability-infra/canonical-capability.types';

@Injectable()
export class CapabilityRegistrarService {
  private readonly logger = new Logger(CapabilityRegistrarService.name);

  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolRegistryRepository: ToolRegistryRepository,
  ) {}

  async registerCanonicalCapabilities(
    entries: ReadonlyArray<CanonicalCapabilityDefinition>,
    options?: {
      strictConflicts?: boolean;
      continueOnError?: boolean;
    },
  ): Promise<CanonicalCapabilityRegistrationSummary> {
    const strictConflicts =
      options?.strictConflicts ?? this.resolveStrictConflictMode();
    const continueOnError = options?.continueOnError ?? true;

    const summary: CanonicalCapabilityRegistrationSummary = {
      attempted: entries.length,
      succeeded: 0,
      failed: 0,
      conflicts: [],
    };

    this.assertNoInMemoryConflicts(entries, strictConflicts, summary);

    for (const entry of entries) {
      try {
        await this.assertNoRegistryConflict(entry, strictConflicts, summary);
        await this.toolRegistry.upsertTool(
          mapCapabilityEntryToToolRegistryPayload(entry),
        );
        summary.succeeded += 1;
      } catch (error) {
        summary.failed += 1;
        const message = (error as Error).message;
        this.logger.warn(
          `Capability registration failed for ${entry.name}: ${message}`,
        );
        if (!continueOnError) {
          throw error;
        }
      }
    }

    return summary;
  }

  async registerToolProjection(
    request: ToolProjectionRegistrationRequest,
  ): Promise<IToolRegistry> {
    return this.toolRegistry.upsertTool({
      ...request.tool,
      source: request.source,
    });
  }

  private assertNoInMemoryConflicts(
    entries: ReadonlyArray<CanonicalCapabilityDefinition>,
    strict: boolean,
    summary: CanonicalCapabilityRegistrationSummary,
  ): void {
    const signatureByName = new Map<string, string>();

    for (const entry of entries) {
      const signature = this.computeCapabilitySignature(
        mapCapabilityEntryToToolRegistryPayload(entry),
      );
      const existingSignature = signatureByName.get(entry.name);
      if (!existingSignature) {
        signatureByName.set(entry.name, signature);
        continue;
      }

      if (existingSignature !== signature) {
        const message = `Conflicting canonical capability signatures for ${entry.name}`;
        summary.conflicts.push(message);
        if (strict) {
          throw new Error(message);
        }
        this.logger.warn(message);
      }
    }
  }

  private async assertNoRegistryConflict(
    entry: CanonicalCapabilityDefinition,
    strict: boolean,
    summary: CanonicalCapabilityRegistrationSummary,
  ): Promise<void> {
    const existing = await this.toolRegistryRepository.findByName(entry.name);
    if (!existing) {
      return;
    }

    const expected = mapCapabilityEntryToToolRegistryPayload(entry);
    const existingSignature = this.computeCapabilitySignature(existing);
    const expectedSignature = this.computeCapabilitySignature(expected);

    if (existingSignature === expectedSignature) {
      return;
    }

    const message = `Registry conflict for capability ${entry.name}: existing tool projection differs from canonical definition`;
    summary.conflicts.push(message);
    if (strict) {
      throw new Error(message);
    }
    this.logger.warn(message);
  }

  private computeCapabilitySignature(tool: Partial<IToolRegistry>): string {
    return JSON.stringify({
      name: tool.name,
      schema: tool.schema ?? null,
      tier_restriction: tool.tier_restriction ?? null,
      transport: tool.transport ?? null,
      runtime_owner: tool.runtime_owner ?? null,
      api_callback: tool.api_callback ?? null,
    });
  }

  private resolveStrictConflictMode(): boolean {
    const raw = process.env.CAPABILITY_REGISTRAR_STRICT;
    if (!raw) {
      return false;
    }

    const normalized = raw.trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
  }
}
