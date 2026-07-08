import { vi } from 'vitest';
import type { Mocked } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ContainerTier, IToolRegistry } from '@nexus/core';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { ToolRegistryRepository } from './database/repositories/tool-registry.repository';
import { ToolValidationService } from '../tool-registry/tool-validation.service';
import { ToolPayloadMapper } from '../tool-registry/tool-payload.mapper';
import { ToolTierPolicyService } from '../tool-registry/tool-tier-policy.service';
import { EventLedgerService } from '../observability/event-ledger.service';

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;
  let repository: Mocked<Partial<ToolRegistryRepository>>;
  let validator: Mocked<Partial<ToolValidationService>>;
  let eventLedger: Mocked<Partial<EventLedgerService>>;

  const validSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
  };

  const validTool: Partial<IToolRegistry> = {
    name: 'sample_tool',
    schema: validSchema,
    typescript_code: 'export const tool = { execute: async () => "ok" };',
    tier_restriction: 1,
  };

  const pluginTool: Partial<IToolRegistry> = {
    name: 'plugin:com.acme.workflow-tools:summarize',
    schema: validSchema,
    typescript_code: 'export const tool = { execute: async () => "ok" };',
    tier_restriction: 0,
    runtime_owner: 'api',
    transport: 'api_callback',
    api_callback: {
      method: 'POST',
      path_template:
        '/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
      body_mapping: { input: '$', operation: 'execute' },
    },
  };

  beforeEach(async () => {
    repository = {
      create: vi.fn().mockImplementation((data: Partial<IToolRegistry>) => ({
        id: 'tool-id',
        ...data,
      })),
      findByName: vi.fn().mockResolvedValue(null),
      findById: vi.fn().mockResolvedValue(null),
      update: vi
        .fn()
        .mockImplementation((id: string, data: Partial<IToolRegistry>) => ({
          id,
          ...data,
        })),
      upsertByName: vi
        .fn()
        .mockImplementation((data: Partial<IToolRegistry>) => ({
          id: 'tool-id',
          ...data,
        })),
      findAll: vi.fn().mockResolvedValue([]),
      findByNamePrefix: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    };

    validator = {
      validateTypeScript: vi.fn().mockReturnValue({ valid: true, errors: [] }),
      validateSchema: vi.fn().mockReturnValue({ valid: true, errors: [] }),
    };

    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        ToolPayloadMapper,
        ToolTierPolicyService,
        {
          provide: ToolRegistryRepository,
          useValue: repository,
        },
        {
          provide: ToolValidationService,
          useValue: validator,
        },
        {
          provide: EventLedgerService,
          useValue: eventLedger,
        },
      ],
    }).compile();

    service = module.get<ToolRegistryService>(ToolRegistryService);
  });

  it('should create a tool when payload is valid', async () => {
    const result = await service.createTool(validTool);

    expect(validator.validateTypeScript).toHaveBeenCalledTimes(1);
    expect(validator.validateSchema).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith({
      name: validTool.name,
      schema: validTool.schema,
      typescript_code: validTool.typescript_code,
      tier_restriction: validTool.tier_restriction,
      source: 'manual',
    });
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'tool',
        eventName: 'tool.registry.create.succeeded',
        outcome: 'success',
      }),
    );
    expect(result).toMatchObject({ id: 'tool-id', name: 'sample_tool' });
  });

  it('should force source to manual even if the caller supplies a different value', async () => {
    await service.createTool({
      ...validTool,
      source: 'decorator_provider',
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'manual' }),
    );
  });

  it('should reject create when required fields are missing', async () => {
    await expect(
      service.createTool({ name: 'missing_schema' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should validate only provided fields on update', async () => {
    await service.updateTool('existing-id', {
      name: 'updated_name',
      tier_restriction: 2,
    });

    expect(validator.validateTypeScript).not.toHaveBeenCalled();
    expect(validator.validateSchema).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('existing-id', {
      name: 'updated_name',
      tier_restriction: 2,
    });
  });

  it('should throw NotFoundException when update returns null', async () => {
    repository.update = vi.fn().mockResolvedValue(null);

    await expect(
      service.updateTool('missing-id', { name: 'updated' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject plugin projection upsert when an existing tool is not the same plugin projection', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'manual-tool-id',
      ...pluginTool,
      transport: 'runner_local',
      api_callback: null,
    });

    await expect(service.upsertTool(pluginTool)).rejects.toThrow(
      ConflictException,
    );
    expect(repository.upsertByName).not.toHaveBeenCalled();
  });

  it('should upsert plugin projection when the existing projection has the same callback path', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'existing-plugin-tool-id',
      ...pluginTool,
    });
    repository.upsertByName = vi
      .fn()
      .mockImplementation((data: Partial<IToolRegistry>) => ({
        id: 'existing-plugin-tool-id',
        ...data,
      }));

    const result = await service.upsertTool(pluginTool);

    expect(repository.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({
        api_callback: pluginTool.api_callback,
      }),
    );
    expect(repository.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'existing-plugin-tool-id' });
  });

  it('should use atomic upsert and emit created event for new non-plugin tool', async () => {
    repository.findByName = vi.fn().mockResolvedValue(null);
    repository.upsertByName = vi
      .fn()
      .mockImplementation((data: Partial<IToolRegistry>) => ({
        id: 'new-tool-id',
        ...data,
      }));

    const result = await service.upsertTool(validTool);

    expect(repository.upsertByName).toHaveBeenCalledWith(
      expect.objectContaining({ name: validTool.name }),
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.registry.upsert.created',
        outcome: 'success',
        toolId: 'new-tool-id',
        toolName: validTool.name,
      }),
    );
    expect(result).toMatchObject({ id: 'new-tool-id', name: validTool.name });
  });

  it('should use atomic upsert and emit updated event for existing non-plugin tool', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'existing-tool-id',
      ...validTool,
    });
    repository.upsertByName = vi
      .fn()
      .mockImplementation((data: Partial<IToolRegistry>) => ({
        id: 'existing-tool-id',
        ...data,
      }));

    const result = await service.upsertTool(validTool);

    expect(repository.upsertByName).toHaveBeenCalledTimes(1);
    expect(eventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tool.registry.upsert.updated',
        outcome: 'success',
        toolId: 'existing-tool-id',
        toolName: validTool.name,
      }),
    );
    expect(result).toMatchObject({ id: 'existing-tool-id' });
  });

  it.each([
    'dynamic_tool',
    'mcp:filesystem:list_files',
    'acp:assistant:delegate',
  ])(
    'should use atomic upsert for non-plugin tool name %s',
    async (toolName) => {
      repository.findByName = vi.fn().mockResolvedValue({
        id: 'existing-tool-id',
        ...validTool,
        name: toolName,
      });
      repository.upsertByName = vi
        .fn()
        .mockImplementation((data: Partial<IToolRegistry>) => ({
          id: 'existing-tool-id',
          ...data,
        }));

      const result = await service.upsertTool({
        ...validTool,
        name: toolName,
      });

      expect(repository.upsertByName).toHaveBeenCalledWith(
        expect.objectContaining({
          name: toolName,
          schema: validSchema,
          typescript_code: validTool.typescript_code,
          tier_restriction: validTool.tier_restriction,
        }),
      );
      expect(repository.upsertByName).toHaveBeenCalledWith(
        expect.not.objectContaining({ id: expect.anything() }),
      );
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'existing-tool-id' });
    },
  );

  it('should reject ordinary upsert when an existing tool is a plugin projection', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'existing-plugin-tool-id',
      ...pluginTool,
    });

    await expect(
      service.upsertTool({
        ...validTool,
        name: 'plugin:com.acme.workflow-tools:summarize',
      }),
    ).rejects.toThrow(ConflictException);
    expect(repository.upsertByName).not.toHaveBeenCalled();
  });

  it('should reject plugin-prefixed upsert when the incoming payload is not a plugin projection', async () => {
    repository.findByName = vi.fn().mockResolvedValue(null);

    await expect(
      service.upsertTool({
        ...validTool,
        name: 'plugin:com.acme.workflow-tools:summarize',
      }),
    ).rejects.toThrow(ConflictException);
    expect(repository.upsertByName).not.toHaveBeenCalled();
  });

  it('should delete an exact plugin projection only when callback ownership matches', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'existing-plugin-tool-id',
      ...pluginTool,
    });

    const result = await service.deletePluginProjectionTool({
      name: 'plugin:com.acme.workflow-tools:summarize',
      apiCallbackPath:
        '/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
    });

    expect(repository.remove).toHaveBeenCalledWith('existing-plugin-tool-id');
    expect(result).toEqual({ status: 'deleted' });
  });

  it('should report cleanup conflict for exact plugin tool names owned by another source', async () => {
    repository.findByName = vi.fn().mockResolvedValue({
      id: 'manual-tool-id',
      ...pluginTool,
      transport: 'runner_local',
      api_callback: null,
    });

    const result = await service.deletePluginProjectionTool({
      name: 'plugin:com.acme.workflow-tools:summarize',
      apiCallbackPath:
        '/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
    });

    expect(repository.remove).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'conflict',
      errorMessage:
        'Tool name plugin:com.acme.workflow-tools:summarize is owned by another source',
    });
  });

  it.each([
    'dynamic_tool',
    'mcp:filesystem:list_files',
    'acp:assistant:delegate',
  ])(
    'should not delete non-plugin tool name %s through plugin projection cleanup',
    async (toolName) => {
      repository.findByName = vi.fn().mockResolvedValue({
        id: 'existing-tool-id',
        ...validTool,
        name: toolName,
      });

      const result = await service.deletePluginProjectionTool({
        name: toolName,
        apiCallbackPath:
          '/api/plugins/com.acme.workflow-tools/1.2.3/contributions/summarize/invoke',
      });

      expect(repository.remove).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: 'conflict',
        errorMessage: `Tool name ${toolName} is owned by another source`,
      });
    },
  );

  it('should filter tools by tier policy', async () => {
    repository.findAll = vi.fn().mockResolvedValue([
      { id: '1', tier_restriction: 1 },
      { id: '2', tier_restriction: 2 },
      { id: '3', tier_restriction: 3 },
    ] as IToolRegistry[]);

    const tools = await service.getToolsForTier(ContainerTier.HEAVY);

    expect(tools).toHaveLength(2);
    expect(tools.map((tool) => tool.id)).toEqual(['1', '2']);
  });

  it('should delete tools matching a deterministic name prefix', async () => {
    repository.findByNamePrefix = vi.fn().mockResolvedValue([
      { id: 'tool-1', name: 'plugin:com.acme:first' },
      { id: 'tool-2', name: 'plugin:com.acme:second' },
    ] as IToolRegistry[]);

    const deleted = await service.deleteToolsByNamePrefix('plugin:com.acme:');

    expect(repository.findByNamePrefix).toHaveBeenCalledWith(
      'plugin:com.acme:',
    );
    expect(repository.remove).toHaveBeenCalledWith('tool-1');
    expect(repository.remove).toHaveBeenCalledWith('tool-2');
    expect(deleted.map((tool) => tool.name)).toEqual([
      'plugin:com.acme:first',
      'plugin:com.acme:second',
    ]);
  });
});
