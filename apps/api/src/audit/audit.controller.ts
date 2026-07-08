import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuditLogEntry, AuditLogResponse } from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { AuditLogService } from './audit-log.service';

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

@Controller('audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  @RequirePermission('audit:read')
  async list(
    @Query('scopeNodeId') scopeNodeId?: string,
    @Query('eventType') eventType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ success: true; data: AuditLogResponse }> {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : DEFAULT_LIMIT;
    const parsedOffset = offset ? Number.parseInt(offset, 10) : DEFAULT_OFFSET;

    const { items, total } = await this.audit.query({
      scopeNodeId,
      eventType,
      limit: parsedLimit,
      offset: parsedOffset,
    });

    const entries: AuditLogEntry[] = items.map((item) => ({
      id: item.id,
      eventType: item.event_type,
      userId: item.actor_id,
      userEmail: item.actor_id,
      scopeNodeId: item.resource_id ?? null,
      scopeNodeName: item.resource_id ?? null,
      metadata: item.metadata ?? {},
      createdAt: item.timestamp.toISOString(),
    }));

    return { success: true, data: { entries, total } };
  }
}
