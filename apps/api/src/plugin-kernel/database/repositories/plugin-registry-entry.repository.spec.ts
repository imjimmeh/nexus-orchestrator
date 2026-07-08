import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Not } from 'typeorm';
import { Repository } from 'typeorm';
import { PluginRegistryEntry } from '../entities/plugin-registry-entry.entity';
import type { PluginLifecycleState } from '../entities/plugin-registry-entry.types';
import { CreatePluginRegistryEntries20260517120000 } from '../../../database/migrations/20260517120000-create-plugin-registry-entries';
import { PluginRegistryEntryRepository } from './plugin-registry-entry.repository';

type MockTypeOrmRepository = Pick<
  Repository<PluginRegistryEntry>,
  'create' | 'save' | 'findOne' | 'find' | 'update'
>;

const createTypeOrmRepository = (
  overrides: Partial<MockTypeOrmRepository> = {},
): MockTypeOrmRepository => ({
  create: vi.fn(),
  save: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  ...overrides,
});

const createRepository = (
  typeormRepository: Partial<MockTypeOrmRepository> = {},
): PluginRegistryEntryRepository =>
  new PluginRegistryEntryRepository(
    createTypeOrmRepository(
      typeormRepository,
    ) as Repository<PluginRegistryEntry>,
  );

const createEntry = (
  overrides: Partial<PluginRegistryEntry> = {},
): PluginRegistryEntry => ({
  id: 'entry-1',
  plugin_id: 'example.plugin',
  version: '1.0.0',
  name: 'Example Plugin',
  description: null,
  author: null,
  source_type: 'package',
  source: '@example/plugin',
  lifecycle_state: 'installed',
  enabled: false,
  trust_level: 'third_party',
  isolation_mode: 'worker_process',
  requested_permissions: [],
  granted_permissions: [],
  scan_result: null,
  compatibility_result: null,
  contributions: [],
  last_error: null,
  installed_at: new Date('2026-05-17T12:00:00.000Z'),
  scanned_at: null,
  enabled_at: null,
  disabled_at: null,
  quarantined_at: null,
  uninstalled_at: null,
  metadata: null,
  created_at: new Date('2026-05-17T12:00:00.000Z'),
  updated_at: new Date('2026-05-17T12:00:00.000Z'),
  ...overrides,
});

describe('PluginRegistryEntryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves a registry entry', async () => {
    const data = {
      plugin_id: 'example.plugin',
      version: '1.0.0',
      name: 'Example Plugin',
    } satisfies Partial<PluginRegistryEntry>;
    const entry = createEntry(data);
    const typeormRepository = createTypeOrmRepository({
      create: vi.fn().mockReturnValue(entry),
      save: vi.fn().mockResolvedValue(entry),
    });
    const repository = createRepository(typeormRepository);

    const result = await repository.saveEntry(data);

    expect(typeormRepository.create).toHaveBeenCalledWith(data);
    expect(typeormRepository.save).toHaveBeenCalledWith(entry);
    expect(result).toBe(entry);
  });

  it('saves a registry entry with a transaction-scoped repository', async () => {
    const data = {
      plugin_id: 'example.plugin',
      version: '1.0.0',
      name: 'Example Plugin',
    } satisfies Partial<PluginRegistryEntry>;
    const entry = createEntry(data);
    const typeormRepository = createTypeOrmRepository();
    const transactionalRepository = createTypeOrmRepository({
      create: vi.fn().mockReturnValue(entry),
      save: vi.fn().mockResolvedValue(entry),
    });
    const manager = {
      getRepository: vi.fn().mockReturnValue(transactionalRepository),
    };
    const repository = createRepository(typeormRepository);

    const result = await repository.saveEntry(data, manager);

    expect(manager.getRepository).toHaveBeenCalledWith(PluginRegistryEntry);
    expect(typeormRepository.create).not.toHaveBeenCalled();
    expect(transactionalRepository.create).toHaveBeenCalledWith(data);
    expect(transactionalRepository.save).toHaveBeenCalledWith(entry);
    expect(result).toBe(entry);
  });

  it('finds an entry by plugin id and version', async () => {
    const entry = createEntry();
    const typeormRepository = createTypeOrmRepository({
      findOne: vi.fn().mockResolvedValue(entry),
    });
    const repository = createRepository(typeormRepository);

    const result = await repository.findByPluginIdAndVersion(
      'example.plugin',
      '1.0.0',
    );

    expect(typeormRepository.findOne).toHaveBeenCalledWith({
      where: { plugin_id: 'example.plugin', version: '1.0.0' },
    });
    expect(result).toBe(entry);
  });

  it('lists active entries ordered by plugin id and version', async () => {
    const entries = [createEntry()];
    const typeormRepository = createTypeOrmRepository({
      find: vi.fn().mockResolvedValue(entries),
    });
    const repository = createRepository(typeormRepository);

    const result = await repository.listActiveEntries();

    expect(typeormRepository.find).toHaveBeenCalledWith({
      where: { lifecycle_state: Not('uninstalled') },
      order: { plugin_id: 'ASC', version: 'ASC' },
    });
    expect(result).toBe(entries);
  });

  it('lists active entries with lifecycle filters', async () => {
    const entries = [
      createEntry({
        lifecycle_state: 'enabled',
        enabled: true,
        trust_level: 'bundled',
      }),
    ];
    const typeormRepository = createTypeOrmRepository({
      find: vi.fn().mockResolvedValue(entries),
    });
    const repository = createRepository(typeormRepository);

    const result = await repository.listActiveEntries({
      state: 'enabled',
      enabled: true,
      trustLevel: 'bundled',
    });

    expect(typeormRepository.find).toHaveBeenCalledWith({
      where: {
        lifecycle_state: 'enabled',
        enabled: true,
        trust_level: 'bundled',
      },
      order: { plugin_id: 'ASC', version: 'ASC' },
    });
    expect(result).toBe(entries);
  });

  it.each([
    ['enabled', true, 'enabled_at'],
    ['disabled', false, 'disabled_at'],
    ['quarantined', false, 'quarantined_at'],
    ['uninstalled', false, 'uninstalled_at'],
  ] as const)(
    'marks lifecycle state %s with enabled=%s and timestamp %s',
    async (state, enabled, timestampColumn) => {
      const timestamp = new Date('2026-05-17T12:30:00.000Z');
      const reloaded = createEntry({
        lifecycle_state: state,
        enabled,
        [timestampColumn]: timestamp,
      });
      const typeormRepository = createTypeOrmRepository({
        update: vi.fn().mockResolvedValue({ affected: 1 }),
        findOne: vi.fn().mockResolvedValue(reloaded),
      });
      const repository = createRepository(typeormRepository);

      const result = await repository.markLifecycleState(
        'entry-1',
        'installed',
        state satisfies PluginLifecycleState,
        timestamp,
      );

      expect(typeormRepository.update).toHaveBeenCalledWith(
        { id: 'entry-1', lifecycle_state: 'installed' },
        {
          lifecycle_state: state,
          enabled,
          [timestampColumn]: timestamp,
        },
      );
      expect(typeormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
      });
      expect(result).toBe(reloaded);
    },
  );

  it('marks non-active lifecycle states without changing enabled', async () => {
    const timestamp = new Date('2026-05-17T12:30:00.000Z');
    const typeormRepository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi
        .fn()
        .mockResolvedValue(createEntry({ lifecycle_state: 'scanned' })),
    });
    const repository = createRepository(typeormRepository);

    await repository.markLifecycleState(
      'entry-1',
      'installed',
      'scanned',
      timestamp,
    );

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'entry-1', lifecycle_state: 'installed' },
      { lifecycle_state: 'scanned', scanned_at: timestamp },
    );
  });

  it('persists extra lifecycle data while marking state', async () => {
    const timestamp = new Date('2026-05-17T12:30:00.000Z');
    const extraData = {
      scan_result: { verdict: 'passed' },
      compatibility_result: { api: 'compatible' },
    } satisfies Partial<PluginRegistryEntry>;
    const typeormRepository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(
        createEntry({
          lifecycle_state: 'scanned',
          ...extraData,
        }),
      ),
    });
    const repository = createRepository(typeormRepository);

    await repository.markLifecycleState(
      'entry-1',
      'installed',
      'scanned',
      timestamp,
      extraData,
    );

    expect(typeormRepository.update).toHaveBeenCalledWith(
      { id: 'entry-1', lifecycle_state: 'installed' },
      {
        lifecycle_state: 'scanned',
        scanned_at: timestamp,
        scan_result: { verdict: 'passed' },
        compatibility_result: { api: 'compatible' },
      },
    );
  });

  it('returns null without reloading when expected lifecycle state does not match', async () => {
    const timestamp = new Date('2026-05-17T12:30:00.000Z');
    const typeormRepository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 0 }),
      findOne: vi.fn(),
    });
    const repository = createRepository(typeormRepository);

    const result = await repository.markLifecycleState(
      'entry-1',
      'installed',
      'scanned',
      timestamp,
    );

    expect(result).toBeNull();
    expect(typeormRepository.findOne).not.toHaveBeenCalled();
  });
});

describe('CreatePluginRegistryEntries20260517120000', () => {
  it('constrains registry enum-like columns at the database layer', async () => {
    const queries: string[] = [];
    const migration = new CreatePluginRegistryEntries20260517120000();
    const queryRunner = {
      query: vi.fn((query: string) => {
        queries.push(query);
        return Promise.resolve();
      }),
    };

    await migration.up(queryRunner);

    const createTableSql = queries.join('\n');
    expect(createTableSql).toContain('chk_plugin_registry_entries_source_type');
    expect(createTableSql).toContain(
      "source_type IN ('package', 'local', 'bundled')",
    );
    expect(createTableSql).toContain(
      'chk_plugin_registry_entries_lifecycle_state',
    );
    expect(createTableSql).toContain(
      "lifecycle_state IN ('discovered', 'installed', 'scanned', 'enabled', 'disabled', 'quarantined', 'uninstalled')",
    );
    expect(createTableSql).toContain('chk_plugin_registry_entries_trust_level');
    expect(createTableSql).toContain(
      "trust_level IN ('bundled', 'local_trusted', 'third_party', 'quarantined')",
    );
    expect(createTableSql).toContain(
      'chk_plugin_registry_entries_isolation_mode',
    );
    expect(createTableSql).toContain(
      "isolation_mode IN ('none', 'worker_process', 'container')",
    );
  });
});
