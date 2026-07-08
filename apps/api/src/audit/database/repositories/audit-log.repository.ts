import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, FindOptionsWhere } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';

@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repository: Repository<AuditLog>,
  ) {}

  async log(data: Partial<AuditLog>): Promise<AuditLog> {
    const entry = this.repository.create(data);
    return this.repository.save(entry);
  }

  async findAll(limit = 100, offset = 0): Promise<AuditLog[]> {
    return this.repository.find({
      order: { timestamp: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async findOlderThan(date: Date): Promise<AuditLog[]> {
    return this.repository.find({
      where: { timestamp: LessThan(date) },
    });
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async query(params: {
    scopeNodeId?: string;
    eventType?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AuditLog[]; total: number }> {
    const where: FindOptionsWhere<AuditLog> = {};
    if (params.scopeNodeId) where.resource_id = params.scopeNodeId;
    if (params.eventType) where.event_type = params.eventType;
    const [items, total] = await this.repository.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });
    return { items, total };
  }
}
