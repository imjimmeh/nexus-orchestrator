import { Injectable, Logger } from '@nestjs/common';
import { AuditLogRepository } from './database/repositories/audit-log.repository';
import { AuditLog } from './database/entities/audit-log.entity';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly repository: AuditLogRepository) {}

  async log(
    eventType: string,
    actorId: string,
    action: string,
    result: 'success' | 'failure' | 'denied',
    resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<AuditLog> {
    const entry = await this.repository.log({
      event_type: eventType,
      actor_id: actorId,
      resource_id: resourceId,
      action,
      result,
      metadata,
    });

    if (result === 'denied' || result === 'failure') {
      this.logger.warn(
        `Security Event: ${eventType} ${action} ${result} by ${actorId}`,
      );
    }

    return entry;
  }

  async getLogs(limit?: number, offset?: number): Promise<AuditLog[]> {
    return this.repository.findAll(limit, offset);
  }

  async query(params: {
    scopeNodeId?: string;
    eventType?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: AuditLog[]; total: number }> {
    return this.repository.query(params);
  }

  async pruneOldLogs(): Promise<number> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const oldLogs = await this.repository.findOlderThan(ninetyDaysAgo);
    for (const log of oldLogs) {
      await this.repository.remove(log.id);
    }

    this.logger.log(`Pruned ${oldLogs.length.toString()} old audit logs`);
    return oldLogs.length;
  }
}
