import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ToolArtifact } from '../entities/tool-artifact.entity';

@Injectable()
export class ToolArtifactRepository {
  constructor(
    @InjectRepository(ToolArtifact)
    private readonly repository: Repository<ToolArtifact>,
  ) {}

  async findById(id: string): Promise<ToolArtifact | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findLatestByToolName(toolName: string): Promise<ToolArtifact | null> {
    return this.repository.findOne({
      where: { tool_name: toolName },
      order: { version: 'DESC' },
    });
  }

  async findByToolNamePaged(
    toolName: string,
    limit = 20,
    offset = 0,
  ): Promise<[ToolArtifact[], number]> {
    return this.repository.findAndCount({
      where: { tool_name: toolName },
      order: { version: 'DESC', created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async findPaged(
    limit = 20,
    offset = 0,
    filters?: {
      status?: ToolArtifact['status'];
      tool_name?: string;
    },
  ): Promise<[ToolArtifact[], number]> {
    const queryBuilder = this.repository
      .createQueryBuilder('artifact')
      .orderBy('artifact.created_at', 'DESC')
      .addOrderBy('artifact.version', 'DESC')
      .take(limit)
      .skip(offset);

    if (filters?.status) {
      queryBuilder.andWhere('artifact.status = :status', {
        status: filters.status,
      });
    }

    if (filters?.tool_name) {
      queryBuilder.andWhere('artifact.tool_name = :toolName', {
        toolName: filters.tool_name,
      });
    }

    return queryBuilder.getManyAndCount();
  }

  async findActivePublishedByToolName(
    toolName: string,
  ): Promise<ToolArtifact | null> {
    return this.repository.findOne({
      where: {
        tool_name: toolName,
        is_active: true,
        status: 'published',
      },
      order: { version: 'DESC' },
    });
  }

  async findMaxVersionByToolName(toolName: string): Promise<number | null> {
    const row = await this.repository
      .createQueryBuilder('artifact')
      .select('MAX(artifact.version)', 'maxVersion')
      .where('artifact.tool_name = :toolName', { toolName })
      .getRawOne<{ maxVersion: string | null }>();

    if (!row?.maxVersion) {
      return null;
    }

    return Number(row.maxVersion);
  }

  async create(data: Partial<ToolArtifact>): Promise<ToolArtifact> {
    const artifact = this.repository.create(data);
    return this.repository.save(artifact);
  }

  async deactivateActiveForToolName(toolName: string): Promise<void> {
    await this.repository.update(
      { tool_name: toolName, is_active: true, status: 'published' },
      { is_active: false },
    );
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ToolArtifact>,
  ): Promise<ToolArtifact | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }
}
