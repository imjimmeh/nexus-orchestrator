import { describe, expect, it, vi } from 'vitest';
import { ToolRegistryRepository } from './tool-registry.repository';
import type { ToolRegistry } from '../entities/tool-registry.entity';

describe('ToolRegistryRepository', () => {
  it('escapes wildcard characters in name prefix queries', async () => {
    const getMany = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockReturnValue({ getMany });
    const where = vi.fn().mockReturnValue({ orderBy });
    const repository = new ToolRegistryRepository({
      createQueryBuilder: vi.fn().mockReturnValue({ where }),
    } as never);

    await repository.findByNamePrefix('plugin:com_acme%tools:');

    expect(where).toHaveBeenCalledWith(
      "tool_registry.name LIKE :pattern ESCAPE '\\'",
      { pattern: 'plugin:com\\_acme\\%tools:%' },
    );
  });

  it('upsertByName delegates to TypeORM upsert with name conflict path and returns the row', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ identifiers: [{ id: 'tool-id' }] });
    const findOne = vi.fn().mockResolvedValue({
      id: 'tool-id',
      name: 'test_tool',
    });
    const repository = new ToolRegistryRepository({
      upsert,
      findOne,
    } as never);

    const result = await repository.upsertByName({
      name: 'test_tool',
      schema: { type: 'object' },
      typescript_code: 'export const tool = {};',
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test_tool' }),
      ['name'],
    );
    expect(findOne).toHaveBeenCalledWith({ where: { name: 'test_tool' } });
    expect(result).toEqual({ id: 'tool-id', name: 'test_tool' });
  });

  it('upsertByName throws when name is not provided', async () => {
    const repository = new ToolRegistryRepository({} as never);

    await expect(repository.upsertByName({})).rejects.toThrow(
      'Tool name is required for upsertByName',
    );
  });
});
