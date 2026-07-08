import { vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ToolSeederService } from './tool-seeder.service';
import { ToolCatalogService } from '../tool-registry/tool-catalog.service';
import { CapabilityContractValidatorService } from './capability-contract-validator.service';
import { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';

describe('ToolSeederService', () => {
  let service: ToolSeederService;
  let toolCatalog: Mocked<Partial<ToolCatalogService>>;
  let capabilityRegistrar: Mocked<Partial<CapabilityRegistrarService>>;
  let contractValidator: Mocked<Partial<CapabilityContractValidatorService>>;

  beforeEach(async () => {
    toolCatalog = {
      getBuiltInCapabilityEntries: vi.fn().mockReturnValue([
        {
          name: 'query_memory',
          description: 'Query memory',
          schema: { type: 'object' },
          typescriptCode: 'export const tool = {}',
          transport: 'api_callback',
          tierRestriction: 1,
          runtimeOwner: 'api',
          policyTags: ['context'],
          apiCallback: {
            method: 'POST',
            pathTemplate: '/api/workflow-runtime/query-memory',
          },
        },
        {
          name: 'spawn_subagent_async',
          description: 'Spawn subagent',
          schema: { type: 'object' },
          typescriptCode: 'export const tool = {}',
          transport: 'api_callback',
          tierRestriction: 1,
          runtimeOwner: 'api',
          policyTags: ['mutating'],
          apiCallback: {
            method: 'POST',
            pathTemplate: '/api/workflow-runtime/spawn-subagent-async',
          },
        },
        {
          name: 'open_war_room',
          description: 'Open war room',
          schema: { type: 'object' },
          typescriptCode: 'export const tool = {}',
          transport: 'api_callback',
          tierRestriction: 1,
          runtimeOwner: 'api',
          policyTags: ['mutating'],
          apiCallback: {
            method: 'POST',
            pathTemplate: '/api/workflow-runtime/war-room/open',
          },
        },
      ]),
    };

    capabilityRegistrar = {
      registerCanonicalCapabilities: vi.fn().mockResolvedValue({
        attempted: 2,
        succeeded: 2,
        failed: 0,
        conflicts: [],
      }),
    };

    contractValidator = {
      validateOrThrow: vi.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolSeederService,
        {
          provide: ToolCatalogService,
          useValue: toolCatalog,
        },
        {
          provide: CapabilityRegistrarService,
          useValue: capabilityRegistrar,
        },
        {
          provide: CapabilityContractValidatorService,
          useValue: contractValidator,
        },
      ],
    }).compile();

    service = module.get<ToolSeederService>(ToolSeederService);
  });

  it('should upsert all built-in tools on module init', async () => {
    await service.onApplicationBootstrap();

    expect(toolCatalog.getBuiltInCapabilityEntries).toHaveBeenCalledTimes(1);
    expect(
      capabilityRegistrar.registerCanonicalCapabilities,
    ).toHaveBeenCalledTimes(1);
    expect(
      capabilityRegistrar.registerCanonicalCapabilities,
    ).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'query_memory',
          source: 'decorator_provider',
        }),
        expect.objectContaining({
          name: 'spawn_subagent_async',
          source: 'decorator_provider',
        }),
        expect.objectContaining({
          name: 'open_war_room',
          source: 'decorator_provider',
        }),
      ]),
      expect.objectContaining({ continueOnError: true }),
    );
    expect(
      capabilityRegistrar.registerCanonicalCapabilities,
    ).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'nexus' + '_orchestrator' }),
      ]),
      expect.anything(),
    );
    expect(contractValidator.validateOrThrow).toHaveBeenCalledTimes(1);
  });

  it('should continue seeding if one tool fails', async () => {
    capabilityRegistrar.registerCanonicalCapabilities = vi
      .fn()
      .mockResolvedValue({
        attempted: 2,
        succeeded: 1,
        failed: 1,
        conflicts: [],
      });

    await service.onApplicationBootstrap();

    expect(
      capabilityRegistrar.registerCanonicalCapabilities,
    ).toHaveBeenCalledTimes(1);
  });
});
