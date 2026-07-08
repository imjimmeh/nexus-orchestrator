import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { ToolRegistry } from '../tool/database/entities/tool-registry.entity';
import { ToolValidationService } from './tool-validation.service';
import { IToolRegistry, ContainerTier } from '@nexus/core';
import { ToolPayloadMapper } from './tool-payload.mapper';
import { ToolTierPolicyService } from './tool-tier-policy.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

type DeletePluginProjectionToolResult =
  | { status: 'deleted' }
  | { status: 'skipped' }
  | { status: 'conflict'; errorMessage: string };

@Injectable()
export class ToolRegistryService {
  constructor(
    private readonly repository: ToolRegistryRepository,
    private readonly validator: ToolValidationService,
    private readonly payloadMapper: ToolPayloadMapper,
    private readonly tierPolicy: ToolTierPolicyService,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async createTool(data: Partial<IToolRegistry>): Promise<IToolRegistry> {
    const payload: Partial<IToolRegistry> = { ...data, source: 'manual' };

    try {
      this.validateRequiredFields(payload, [
        'name',
        'schema',
        'typescript_code',
      ]);
      this.validateTypeScriptCode(payload.typescript_code);
      this.validateSchema(payload.schema);
      const created = await this.repository.create(
        this.payloadMapper.toCreatePayload(payload),
      );

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.create.succeeded',
        outcome: 'success',
        toolId: created.id,
        toolName: created.name,
      });

      return created;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.create.failed',
        outcome: 'failure',
        toolName: payload.name,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async upsertTool(data: Partial<IToolRegistry>): Promise<IToolRegistry> {
    const toolName = data.name;

    try {
      this.validateRequiredFields(data, ['name', 'schema', 'typescript_code']);
      this.validateTypeScriptCode(data.typescript_code);
      this.validateSchema(data.schema);

      if (!toolName) {
        throw new BadRequestException('Tool name is required for upsert');
      }

      this.assertValidPluginToolUpsert(data);

      const existing = await this.repository.findByName(toolName);
      if (existing) {
        this.assertCanUpsertExistingTool(existing, data);
      }

      const result = await this.repository.upsertByName(
        this.payloadMapper.toCreatePayload(data),
      );

      if (!result) {
        throw new NotFoundException(
          `Tool with name ${toolName} not found after upsert`,
        );
      }

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: existing
          ? 'tool.registry.upsert.updated'
          : 'tool.registry.upsert.created',
        outcome: 'success',
        toolId: result.id,
        toolName: result.name,
      });

      return result;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.upsert.failed',
        outcome: 'failure',
        toolName,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async getTool(id: string): Promise<IToolRegistry> {
    const tool = await this.repository.findById(id);
    if (!tool) throw new NotFoundException(`Tool with ID ${id} not found`);
    return tool;
  }

  async updateTool(
    id: string,
    data: Partial<IToolRegistry>,
  ): Promise<IToolRegistry> {
    try {
      if (data.typescript_code !== undefined) {
        this.validateTypeScriptCode(data.typescript_code);
      }

      if (data.schema !== undefined) {
        this.validateSchema(data.schema);
      }

      const updated = await this.repository.update(
        id,
        this.payloadMapper.toUpdatePayload(
          data,
        ) as QueryDeepPartialEntity<ToolRegistry>,
      );

      if (!updated) {
        throw new NotFoundException(`Tool with ID ${id} not found`);
      }

      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.update.succeeded',
        outcome: 'success',
        toolId: updated.id,
        toolName: updated.name,
      });

      return updated;
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.update.failed',
        outcome: 'failure',
        toolId: id,
        toolName: data.name,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async getToolsForTier(tier: ContainerTier): Promise<IToolRegistry[]> {
    const allTools = await this.repository.findAll();
    return this.tierPolicy.filterToolsForTier(allTools, tier);
  }

  async deleteTool(id: string): Promise<void> {
    try {
      await this.repository.remove(id);
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.delete.succeeded',
        outcome: 'success',
        toolId: id,
      });
    } catch (error) {
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.delete.failed',
        outcome: 'failure',
        toolId: id,
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteToolsByNamePrefix(prefix: string): Promise<IToolRegistry[]> {
    const tools = await this.repository.findByNamePrefix(prefix);

    for (const tool of tools) {
      await this.repository.remove(tool.id);
      await this.eventLedger.emitBestEffort({
        domain: 'tool',
        eventName: 'tool.registry.delete.succeeded',
        outcome: 'success',
        toolId: tool.id,
        toolName: tool.name,
      });
    }

    return tools;
  }

  async deletePluginProjectionTool(params: {
    name: string;
    apiCallbackPath: string;
  }): Promise<DeletePluginProjectionToolResult> {
    const existing = await this.repository.findByName(params.name);
    if (!existing) {
      return { status: 'skipped' };
    }

    if (
      !this.isSamePluginProjection(existing, {
        name: params.name,
        runtime_owner: 'api',
        transport: 'api_callback',
        api_callback: {
          method: 'POST',
          path_template: params.apiCallbackPath,
        },
      })
    ) {
      return {
        status: 'conflict',
        errorMessage: `Tool name ${params.name} is owned by another source`,
      };
    }

    await this.repository.remove(existing.id);
    await this.eventLedger.emitBestEffort({
      domain: 'tool',
      eventName: 'tool.registry.delete.succeeded',
      outcome: 'success',
      toolId: existing.id,
      toolName: existing.name,
    });

    return { status: 'deleted' };
  }

  private assertValidPluginToolUpsert(data: Partial<IToolRegistry>): void {
    if (
      typeof data.name === 'string' &&
      data.name.startsWith('plugin:') &&
      !this.isPluginProjectionUpsert(data)
    ) {
      throw new ConflictException(
        `Tool name ${data.name} is reserved for plugin projections`,
      );
    }
  }

  private assertCanUpsertExistingTool(
    existing: IToolRegistry,
    data: Partial<IToolRegistry>,
  ): void {
    if (!this.isPluginProjectionUpsert(data)) {
      return;
    }

    if (this.isSamePluginProjection(existing, data)) {
      return;
    }

    throw new ConflictException(
      `Tool name ${data.name ?? '<unknown>'} is owned by another source`,
    );
  }

  private isPluginProjectionUpsert(data: Partial<IToolRegistry>): boolean {
    return (
      typeof data.name === 'string' &&
      data.name.startsWith('plugin:') &&
      data.runtime_owner === 'api' &&
      data.transport === 'api_callback' &&
      this.hasApiCallbackPath(data.api_callback)
    );
  }

  private isSamePluginProjection(
    existing: IToolRegistry,
    data: Partial<IToolRegistry>,
  ): boolean {
    return (
      existing.runtime_owner === 'api' &&
      existing.transport === 'api_callback' &&
      this.getApiCallbackPath(existing.api_callback) ===
        this.getApiCallbackPath(data.api_callback)
    );
  }

  private hasApiCallbackPath(callback: IToolRegistry['api_callback']): boolean {
    return this.getApiCallbackPath(callback) !== null;
  }

  private getApiCallbackPath(
    callback: IToolRegistry['api_callback'],
  ): string | null {
    if (
      typeof callback === 'object' &&
      callback !== null &&
      'path_template' in callback &&
      typeof callback.path_template === 'string'
    ) {
      return callback.path_template;
    }

    return null;
  }

  private validateRequiredFields(
    data: Partial<IToolRegistry>,
    requiredFields: Array<'name' | 'schema' | 'typescript_code'>,
  ): void {
    for (const field of requiredFields) {
      if (
        data[field] === undefined ||
        data[field] === null ||
        data[field] === ''
      ) {
        throw new BadRequestException(`Tool ${field} is required`);
      }
    }
  }

  private validateTypeScriptCode(code: unknown): void {
    if (typeof code !== 'string') {
      throw new BadRequestException('Tool typescript_code must be a string');
    }

    const tsValidation = this.validator.validateTypeScript(code);
    if (!tsValidation.valid) {
      throw new BadRequestException(
        `Invalid TypeScript code: ${tsValidation.errors.join(', ')}`,
      );
    }
  }

  private validateSchema(schema: unknown): void {
    const schemaValidation = this.validator.validateSchema(schema);
    if (!schemaValidation.valid) {
      throw new BadRequestException(
        `Invalid JSON Schema: ${schemaValidation.errors.join(', ')}`,
      );
    }
  }
}
