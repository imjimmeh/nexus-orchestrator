import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ToolRegistry } from '../entities/tool-registry.entity';

@Injectable()
export class ToolRegistryRepository {
  constructor(
    @InjectRepository(ToolRegistry)
    private readonly repository: Repository<ToolRegistry>,
  ) {}

  async findAll(): Promise<ToolRegistry[]> {
    return this.repository.find();
  }

  async findByName(name: string): Promise<ToolRegistry | null> {
    return this.repository.findOne({ where: { name } });
  }

  async findByNamePrefix(prefix: string): Promise<ToolRegistry[]> {
    return this.repository
      .createQueryBuilder('tool_registry')
      .where("tool_registry.name LIKE :pattern ESCAPE '\\'", {
        pattern: `${this.escapeLikePattern(prefix)}%`,
      })
      .orderBy('tool_registry.name', 'ASC')
      .getMany();
  }

  private escapeLikePattern(value: string): string {
    return value
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_');
  }

  async findByMcpServerId(serverId: string): Promise<ToolRegistry[]> {
    return this.repository
      .createQueryBuilder('tool_registry')
      .where('tool_registry.mcp_server_id = :serverId', { serverId })
      .orderBy('tool_registry.name', 'ASC')
      .getMany();
  }

  async findById(id: string): Promise<ToolRegistry | null> {
    return this.repository.findOne({ where: { id } });
  }

  async create(data: Partial<ToolRegistry>): Promise<ToolRegistry> {
    const tool = this.repository.create(data);
    return this.repository.save(tool);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ToolRegistry>,
  ): Promise<ToolRegistry | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  /**
   * Atomic upsert keyed on the unique `name` column.
   *
   * Uses PostgreSQL `INSERT … ON CONFLICT (name) DO UPDATE` via TypeORM's
   * `repository.upsert`, eliminating the read-then-write race window that
   * the legacy `findByName` + `create`/`update` flow suffers from. After
   * the upsert the row is re-read so the caller receives the full entity
   * (including server-generated columns such as `id` and `updated_at`).
   */
  async upsertByName(
    data: Partial<ToolRegistry>,
  ): Promise<ToolRegistry | null> {
    if (!data.name) {
      throw new Error('Tool name is required for upsertByName');
    }
    await this.repository.upsert(data as QueryDeepPartialEntity<ToolRegistry>, [
      'name',
    ]);
    return this.findByName(data.name);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
