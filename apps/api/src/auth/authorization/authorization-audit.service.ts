import { Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AUTHZ_EVENT_TYPES } from './authz-audit.constants';
import type {
  DenialEvent,
  RoleChangeEvent,
  ScopeCreatedEvent,
  ScopeMovedEvent,
  ScopeDeletedEvent,
  ScopeUpdatedEvent,
  ScopeArchivedEvent,
  ScopeRestoredEvent,
} from './authorization-audit.service.types';

@Injectable()
export class AuthorizationAuditService {
  private readonly logger = new Logger(AuthorizationAuditService.name);

  constructor(private readonly auditLog: AuditLogService) {}

  async recordDenial(e: DenialEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.DENIED,
      e.actorId,
      'denied',
      'denied',
      e.scopeNodeId,
      {
        requiredPermission: e.requiredPermission,
        scopePath: e.scopePath ?? null,
        enforcementMode: e.enforcementMode,
      },
    );
  }

  async recordRoleGranted(e: RoleChangeEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.ROLE_GRANTED,
      e.actorId,
      'granted',
      'success',
      e.scopeNodeId,
      {
        targetUserId: e.userId,
        roleId: e.roleId,
      },
    );
  }

  async recordRoleRevoked(e: RoleChangeEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.ROLE_REVOKED,
      e.actorId,
      'revoked',
      'success',
      e.scopeNodeId,
      {
        targetUserId: e.userId,
        roleId: e.roleId,
      },
    );
  }

  async recordScopeCreated(e: ScopeCreatedEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_CREATED,
      e.actorId,
      'created',
      'success',
      e.scopeNodeId,
      {
        parentId: e.parentId,
        type: e.type,
      },
    );
  }

  async recordScopeMoved(e: ScopeMovedEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_MOVED,
      e.actorId,
      'moved',
      'success',
      e.scopeNodeId,
      {
        oldParentId: e.oldParentId,
        newParentId: e.newParentId,
      },
    );
  }

  async recordScopeDeleted(e: ScopeDeletedEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_DELETED,
      e.actorId,
      'deleted',
      'success',
      e.scopeNodeId,
      {},
    );
  }

  async recordScopeUpdated(e: ScopeUpdatedEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_UPDATED,
      e.actorId,
      'updated',
      'success',
      e.scopeNodeId,
      {
        changedFields: e.changedFields,
        previous: e.previous,
        next: e.next,
      },
    );
  }

  async recordScopeArchived(e: ScopeArchivedEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_ARCHIVED,
      e.actorId,
      'archived',
      'success',
      e.scopeNodeId,
      {},
    );
  }

  async recordScopeRestored(e: ScopeRestoredEvent): Promise<void> {
    await this.safeLog(
      AUTHZ_EVENT_TYPES.SCOPE_RESTORED,
      e.actorId,
      'restored',
      'success',
      e.scopeNodeId,
      {},
    );
  }

  private async safeLog(
    eventType: string,
    actorId: string,
    action: string,
    result: 'success' | 'denied',
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditLog.log(
        eventType,
        actorId,
        action,
        result,
        resourceId,
        metadata,
      );
    } catch (error) {
      // Audit must never break the request it observes.
      this.logger.error(`Failed to write authz audit (${eventType})`, error);
    }
  }
}
