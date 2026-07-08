import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AcpServer } from '../entities/acp-server.entity';

@Injectable()
export class AcpServerRepository {
  constructor(
    @InjectRepository(AcpServer)
    private readonly repository: Repository<AcpServer>,
  ) {}

  async findAll(): Promise<AcpServer[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }

  async findEnabled(): Promise<AcpServer[]> {
    return this.repository.find({
      where: { enabled: true },
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<AcpServer | null> {
    return this.repository.findOne({ where: { id } });
  }

  async create(data: Partial<AcpServer>): Promise<AcpServer> {
    const server = this.repository.create(data);
    return this.repository.save(server);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<AcpServer>,
  ): Promise<AcpServer | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
