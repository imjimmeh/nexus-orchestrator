import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';
import type { ToolRegistryService } from '../tool-registry/tool-registry.service';
import type { ToolRegistryRepository } from './database/repositories/tool-registry.repository';
import type { CanonicalCapabilityDefinition } from '../capability-infra/canonical-capability.types';

const createCanonicalEntry = (
  overrides: Partial<CanonicalCapabilityDefinition> = {},
): CanonicalCapabilityDefinition => ({
  name: 'query_memory',
  description: 'Query memory context',
  schema: { type: 'object' },
  typescriptCode: 'export const tool = {};',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['context'],
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/query-memory',
  },
  source: 'decorator_provider',
  ...overrides,
});

describe('CapabilityRegistrarService', () => {
  it('upserts canonical capabilities when no conflicts are present', async () => {
    const toolRegistry = {
      upsertTool: vi.fn().mockResolvedValue({ id: 'tool-1' }),
    } as unknown as ToolRegistryService;
    const toolRegistryRepository = {
      findByName: vi.fn().mockResolvedValue(null),
    } as unknown as ToolRegistryRepository;

    const service = new CapabilityRegistrarService(
      toolRegistry,
      toolRegistryRepository,
    );

    const result = await service.registerCanonicalCapabilities([
      createCanonicalEntry(),
    ]);

    expect(result).toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
      conflicts: [],
    });
    expect(toolRegistry.upsertTool).toHaveBeenCalledTimes(1);
  });

  it('throws on conflicting duplicate canonical definitions in strict mode', async () => {
    const toolRegistry = {
      upsertTool: vi.fn().mockResolvedValue({ id: 'tool-1' }),
    } as unknown as ToolRegistryService;
    const toolRegistryRepository = {
      findByName: vi.fn().mockResolvedValue(null),
    } as unknown as ToolRegistryRepository;

    const service = new CapabilityRegistrarService(
      toolRegistry,
      toolRegistryRepository,
    );

    await expect(
      service.registerCanonicalCapabilities(
        [
          createCanonicalEntry(),
          createCanonicalEntry({
            schema: {
              type: 'object',
              properties: { scope_id: { type: 'string' } },
            },
          }),
        ],
        { strictConflicts: true },
      ),
    ).rejects.toThrow('Conflicting canonical capability signatures');
  });

  it('registers external tool projections through tool registry service', async () => {
    const upserted = { id: 'tool-1', name: 'mcp:server/tool' };
    const toolRegistry = {
      upsertTool: vi.fn().mockResolvedValue(upserted),
    } as unknown as ToolRegistryService;
    const toolRegistryRepository = {
      findByName: vi.fn().mockResolvedValue(null),
    } as unknown as ToolRegistryRepository;

    const service = new CapabilityRegistrarService(
      toolRegistry,
      toolRegistryRepository,
    );

    const result = await service.registerToolProjection({
      source: 'external_mcp',
      sourceMetadata: { server_id: 'server-1' },
      tool: {
        name: 'mcp:server-1/tool-1',
        schema: { type: 'object' },
      },
    });

    expect(result).toEqual(upserted);
    expect(toolRegistry.upsertTool).toHaveBeenCalledTimes(1);
    expect(toolRegistry.upsertTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'mcp:server-1/tool-1',
        source: 'external_mcp',
      }),
    );
  });
});
