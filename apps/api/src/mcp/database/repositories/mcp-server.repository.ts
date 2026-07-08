import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { McpServer } from '../entities/mcp-server.entity';

@Injectable()
export class McpServerRepository {
  constructor(
    @InjectRepository(McpServer)
    private readonly repository: Repository<McpServer>,
  ) {}

  async findAll(): Promise<McpServer[]> {
    return this.repository.find({
      order: {
        name: 'ASC',
      },
    });
  }

  async findEnabled(): Promise<McpServer[]> {
    return this.repository.find({
      where: {
        enabled: true,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  async findById(id: string): Promise<McpServer | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByName(name: string): Promise<McpServer | null> {
    return this.repository.findOne({ where: { name } });
  }

  async create(data: Partial<McpServer>): Promise<McpServer> {
    const server = this.repository.create(data);
    return this.repository.save(server);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<McpServer>,
  ): Promise<McpServer | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
