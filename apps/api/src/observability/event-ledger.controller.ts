import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { InternalServiceScopes } from '../auth/internal-service-scopes.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { EventLedgerService } from './event-ledger.service';
import type { EmitEventLedgerParams } from './event-ledger.service';
import {
  correlationTimelineQuerySchema,
  emitInternalEventLedgerSchema as coreEmitInternalEventLedgerSchema,
  queryEventLedgerSchema,
  type CorrelationTimelineQueryRequest,
  type EmitInternalEventLedgerRequest,
  type QueryEventLedgerRequest,
} from '@nexus/core';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `observability/event-ledger`. Source role set:
 * `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - findAll               class-level `Admin`/`Developer`  -> audit:read
 *   - findByCorrelationId   class-level `Admin`/`Developer`  -> audit:read
 *   - emitInternal          `Admin`/`Developer` (write POST) -> audit:manage
 *   - findById              class-level `Admin`/`Developer`  -> audit:read
 *
 * Notes:
 *   - Three of the four handlers are read-class against the event
 *     ledger, so the controller-level `audit:read` is declared as the
 *     default and `findAll` / `findByCorrelationId` / `findById`
 *     inherit it without an explicit per-handler decorator.
 *   - `emitInternal` is a write (POST) that appends to the same
 *     ledger, so the migration promotes it to `audit:manage`.
 */

export const emitInternalEventLedgerSchema = coreEmitInternalEventLedgerSchema;

class QueryEventLedgerDto implements QueryEventLedgerRequest {
  static get schema() {
    return queryEventLedgerSchema;
  }

  domain?: string;

  eventName?: string;

  outcome?: 'success' | 'failure' | 'denied' | 'in_progress';

  severity?: 'info' | 'warn' | 'error' | 'critical';

  source?: string;

  actorType?: 'user' | 'agent' | 'system';

  actorId?: string;

  context?: {
    scopeId?: string | null;
    contextId?: string | null;
    contextType?: string | null;
  };

  workflowId?: string;

  workflowRunId?: string;

  jobId?: string;

  stepId?: string;

  toolName?: string;

  requestId?: string;

  correlationId?: string;

  occurredAfter?: string;

  occurredBefore?: string;

  limit = 100;

  offset = 0;

  search?: string;

  sortBy?: string;

  sortDir: 'asc' | 'desc' = 'desc';
}

class CorrelationTimelineQueryDto implements CorrelationTimelineQueryRequest {
  static get schema() {
    return correlationTimelineQuerySchema;
  }

  limit = 100;

  offset = 0;
}

@ApiTags('events')
@ApiBearerAuth()
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermission('audit:read')
@Controller('events')
export class EventLedgerController {
  constructor(private readonly eventLedgerService: EventLedgerService) {}

  @Get()
  @ApiOperation({ summary: 'Query correlated event ledger entries' })
  @ApiResponse({ status: 200, description: 'Paginated event ledger results' })
  async findAll(@Query() query: QueryEventLedgerDto) {
    const { events, total } = await this.eventLedgerService.query({
      domain: query.domain,
      eventName: query.eventName,
      outcome: query.outcome,
      severity: query.severity,
      source: query.source,
      actorType: query.actorType,
      actorId: query.actorId,
      context: query.context
        ? {
            scopeId: query.context.scopeId ?? null,
            contextId: query.context.contextId ?? null,
            contextType: query.context.contextType ?? null,
            scopeNodeId: null,
            scopePath: null,
          }
        : undefined,
      workflowId: query.workflowId,
      workflowRunId: query.workflowRunId,
      jobId: query.jobId,
      stepId: query.stepId,
      toolName: query.toolName,
      requestId: query.requestId,
      correlationId: query.correlationId,
      occurredAfter: query.occurredAfter
        ? new Date(query.occurredAfter)
        : undefined,
      occurredBefore: query.occurredBefore
        ? new Date(query.occurredBefore)
        : undefined,
      limit: query.limit,
      offset: query.offset,
      search: query.search,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

    return {
      data: events,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  @Get('correlation/:correlationId')
  @ApiOperation({ summary: 'Get correlated event timeline by correlation ID' })
  async findByCorrelationId(
    @Param('correlationId') correlationId: string,
    @Query() query: CorrelationTimelineQueryDto,
  ) {
    const { events, total } = await this.eventLedgerService.getByCorrelationId(
      correlationId,
      query.limit,
      query.offset,
    );

    return {
      data: events,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  @Post('internal')
  @InternalServiceScopes('core.events:write')
  @RequirePermission('audit:manage')
  @ApiOperation({ summary: 'Emit an internal event ledger entry' })
  async emitInternal(
    @ZodBody(emitInternalEventLedgerSchema)
    body: EmitInternalEventLedgerRequest,
  ) {
    await this.eventLedgerService.emitBestEffort(body as EmitEventLedgerParams);

    return { ok: true };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one event by ID' })
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    const event = await this.eventLedgerService.getById(id);
    return { data: event };
  }
}
