import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import {
  ChatEventEnvelopeV1Schema,
  GenericDomainEventBodySchema,
  type GenericDomainEventBody,
  type ChatEventEnvelopeV1Shape,
} from '@nexus/core';
import { InternalServiceScopes } from '../auth/internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { WorkflowInternalDomainEventsService } from './workflow-internal-domain-events.service';
import { readString } from '@nexus/core';

function readStringField(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-internal-domain-events` (internal-surface
 * controller that ingests domain events into the audit/event ledger).
 * Source role set: `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - ingestChatEvent     Admin / Developer (write) -> audit:manage
 *   - ingestDomainEvent   Admin / Developer (write) -> audit:manage
 *
 * Notes:
 *   - Both handlers are write operations that append to the
 *     event/audit ledger, so the migration promotes them to
 *     `audit:manage`, matching the write side of the
 *     `observability/event-ledger` migration (`emitInternal`).
 *   - The `InternalServiceScopes` decorator remains in place: this
 *     is an internal-surface controller and the upstream guard
 *     `InternalServiceScopeGuard` continues to enforce that the
 *     caller carries an internal service scope token in addition
 *     to the user permission.
 */

@ApiTags('internal-domain-events')
@ApiBearerAuth()
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@Controller('internal')
export class WorkflowInternalDomainEventsController {
  private readonly logger = new Logger(
    WorkflowInternalDomainEventsController.name,
  );

  constructor(
    private readonly domainEvents: WorkflowInternalDomainEventsService,
  ) {}

  @Post('chat/events')
  @InternalServiceScopes('core.chat-events:write')
  @RequirePermission('audit:manage')
  @ApiOperation({
    summary: 'Ingest chat domain events through internal core contracts',
  })
  async ingestChatEvent(
    @ZodBody(ChatEventEnvelopeV1Schema) body: ChatEventEnvelopeV1Shape,
  ) {
    await this.domainEvents.ingestChatEvent(body);
    return {
      success: true,
      data: {
        accepted: true,
        event_id: body.event_id,
        eventType: body.event_type,
      },
    };
  }

  @Post(':domain/events')
  @InternalServiceScopes('core.domain-events:write')
  @RequirePermission('audit:manage')
  @ApiOperation({
    summary: 'Ingest domain events generically',
  })
  async ingestDomainEvent(
    @Param('domain') domain: string,
    @ZodBody(GenericDomainEventBodySchema) body: GenericDomainEventBody,
  ) {
    this.logger.debug(`Ingesting generic domain event for [${domain}]`);
    await this.domainEvents.ingestDomainEvent(domain, body);
    const eventRecord = body as Record<string, unknown>;

    return {
      success: true,
      data: {
        accepted: true,
        domain,
        eventId: readStringField(eventRecord, 'event_id', 'eventId'),
        eventType: readStringField(
          eventRecord,
          'event_type',
          'eventType',
          'event_name',
          'eventName',
        ),
      },
    };
  }
}
