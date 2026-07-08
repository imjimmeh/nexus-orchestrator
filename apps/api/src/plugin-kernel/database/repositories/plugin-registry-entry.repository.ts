import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { ListPluginFilters } from '../../plugin-lifecycle.types';
import { PluginRegistryEntry } from '../entities/plugin-registry-entry.entity';
import type { PluginLifecycleState } from '../entities/plugin-registry-entry.types';

type PluginLifecycleTimestampColumn =
  | 'installed_at'
  | 'scanned_at'
  | 'enabled_at'
  | 'disabled_at'
  | 'quarantined_at'
  | 'uninstalled_at';

const LIFECYCLE_TIMESTAMP_COLUMNS: Partial<
  Record<PluginLifecycleState, PluginLifecycleTimestampColumn>
> = {
  installed: 'installed_at',
  scanned: 'scanned_at',
  enabled: 'enabled_at',
  disabled: 'disabled_at',
  quarantined: 'quarantined_at',
  uninstalled: 'uninstalled_at',
};

const LIFECYCLE_ENABLED_VALUES: Partial<Record<PluginLifecycleState, boolean>> =
  {
    enabled: true,
    disabled: false,
    quarantined: false,
    uninstalled: false,
  };

@Injectable()
export class PluginRegistryEntryRepository {
  constructor(
    @InjectRepository(PluginRegistryEntry)
    private readonly repository: Repository<PluginRegistryEntry>,
  ) {}

  async saveEntry(
    data: Partial<PluginRegistryEntry>,
    manager?: EntityManager,
  ): Promise<PluginRegistryEntry> {
    const repository =
      manager?.getRepository(PluginRegistryEntry) ?? this.repository;
    return repository.save(repository.create(data));
  }

  findByPluginIdAndVersion(
    pluginId: string,
    version: string,
  ): Promise<PluginRegistryEntry | null> {
    return this.repository.findOne({
      where: { plugin_id: pluginId, version },
    });
  }

  listActiveEntries(
    filters: ListPluginFilters = {},
  ): Promise<PluginRegistryEntry[]> {
    const where: FindOptionsWhere<PluginRegistryEntry> = {
      lifecycle_state: filters.state ?? Not('uninstalled'),
    };

    if (filters.enabled !== undefined) {
      where.enabled = filters.enabled;
    }

    if (filters.trustLevel !== undefined) {
      where.trust_level = filters.trustLevel;
    }

    return this.repository.find({
      where,
      order: { plugin_id: 'ASC', version: 'ASC' },
    });
  }

  listEntriesForPlugin(
    pluginId: string,
    version?: string,
  ): Promise<PluginRegistryEntry[]> {
    const where: FindOptionsWhere<PluginRegistryEntry> = {
      plugin_id: pluginId,
    };

    if (version !== undefined) {
      where.version = version;
    }

    return this.repository.find({
      where,
      order: { plugin_id: 'ASC', version: 'ASC' },
    });
  }

  async markLifecycleState(
    id: string,
    expectedState: PluginLifecycleState,
    state: PluginLifecycleState,
    timestamp: Date = new Date(),
    data: Partial<PluginRegistryEntry> = {},
    manager?: EntityManager,
  ): Promise<PluginRegistryEntry | null> {
    const repository =
      manager?.getRepository(PluginRegistryEntry) ?? this.repository;
    const updateData: Partial<PluginRegistryEntry> = {
      lifecycle_state: state,
      ...data,
    };
    const enabled = LIFECYCLE_ENABLED_VALUES[state];
    const timestampColumn = LIFECYCLE_TIMESTAMP_COLUMNS[state];

    if (enabled !== undefined) {
      updateData.enabled = enabled;
    }

    if (timestampColumn) {
      updateData[timestampColumn] = timestamp;
    }

    const result = await repository.update(
      { id, lifecycle_state: expectedState },
      updateData as QueryDeepPartialEntity<PluginRegistryEntry>,
    );

    if (result.affected === 0) {
      return null;
    }

    return repository.findOne({ where: { id } });
  }
}
