import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IInternalToolHandler } from '@nexus/core';
import { InternalToolRegistryService } from './internal-tool-registry.service';
import { INTERNAL_TOOL_HANDLER } from './internal-tool.tokens';

describe('InternalToolRegistryService', () => {
  const buildHandler = (name: string): IInternalToolHandler => ({
    getName: () => name,
    getDefinition: () => ({
      name,
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      inputSchema: z.object({}),
    }),
    execute: () => Promise.resolve({ ok: true, name }),
  });

  it('resolves handlers and returns sorted names', async () => {
    const module = await Test.createTestingModule({
      providers: [
        InternalToolRegistryService,
        {
          provide: INTERNAL_TOOL_HANDLER,
          useValue: [buildHandler('b_tool'), buildHandler('a_tool')],
        },
      ],
    }).compile();

    const registry = module.get(InternalToolRegistryService);

    expect(registry.getToolNames()).toEqual(['a_tool', 'b_tool']);
    expect(registry.getToolDefinitions().map((entry) => entry.name)).toEqual([
      'b_tool',
      'a_tool',
    ]);
  });

  it('throws when duplicate tool names are registered', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          InternalToolRegistryService,
          {
            provide: INTERNAL_TOOL_HANDLER,
            useValue: [buildHandler('dupe_tool'), buildHandler('dupe_tool')],
          },
        ],
      }).compile(),
    ).rejects.toThrow('Duplicate internal tool handler registration');
  });

  it('executes a handler via lookup', async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true, result: 42 });
    const handler: IInternalToolHandler<{ value: number }, { ok: boolean }> = {
      getName: () => 'compute',
      getDefinition: () => ({
        name: 'compute',
        tierRestriction: 1,
        transport: 'api_callback',
        runtimeOwner: 'api',
        inputSchema: z.object({ value: z.number() }),
      }),
      execute,
    };

    const module = await Test.createTestingModule({
      providers: [
        InternalToolRegistryService,
        {
          provide: INTERNAL_TOOL_HANDLER,
          useValue: [handler],
        },
      ],
    }).compile();

    const registry = module.get(InternalToolRegistryService);
    const result = await registry.executeTool(
      'compute',
      { scopeId: 'p-1' },
      {
        value: 21,
      },
    );

    expect(result).toEqual({ ok: true, result: 42 });
    expect(execute).toHaveBeenCalledWith({ scopeId: 'p-1' }, { value: 21 });
  });

  it('throws NotFoundException when tool does not exist', async () => {
    const module = await Test.createTestingModule({
      providers: [InternalToolRegistryService],
    }).compile();

    const registry = module.get(InternalToolRegistryService);

    await expect(
      registry.executeTool('missing_tool', {}, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('has all ingestion tools registered when all handlers are provided', async () => {
    const ingestionToolNames = [
      'fetch_url',
      'web_fetch',
      'web_search',
      'read_document',
      'analyze_image',
      'extract_figma',
      'create_artifact',
      'propose_resources',
    ];

    const module = await Test.createTestingModule({
      providers: [
        InternalToolRegistryService,
        {
          provide: INTERNAL_TOOL_HANDLER,
          useValue: ingestionToolNames.map(buildHandler),
        },
      ],
    }).compile();

    const registry = module.get(InternalToolRegistryService);

    expect(registry.getToolNames()).toEqual(
      expect.arrayContaining(ingestionToolNames),
    );
  });
});
