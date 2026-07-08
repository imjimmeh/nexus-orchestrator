import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from './authorization.service';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import { EnforcementModeService } from './enforcement-mode.service';
import { AuthorizationAuditService } from './authorization-audit.service';
import type { EnforcementMode } from './enforcement-mode.types';

interface RequestShape {
  user?: { userId?: string; roles?: string[] };
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authz: AuthorizationService,
    private readonly enforcement: EnforcementModeService,
    @Optional() private readonly authzAudit?: AuthorizationAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<RequestShape>();
    const userId = req.user?.userId;
    if (!userId) return false;

    const scopeNodeId = this.resolveScopeNodeId(req);
    const [resource] = required.split(':');
    const [allowed, mode] = await Promise.all([
      this.authz.can(userId, required, scopeNodeId, req.user?.roles),
      this.enforcement.getMode(resource),
    ]);

    if (allowed) {
      return true;
    }

    return this.applyEnforcementPolicy(userId, required, scopeNodeId, mode);
  }

  private resolveScopeNodeId(req: RequestShape): string {
    return (
      req.params?.scopeNodeId ??
      req.params?.scopeId ??
      req.query?.scopeNodeId ??
      (typeof req.body?.scopeNodeId === 'string'
        ? req.body.scopeNodeId
        : undefined) ??
      (typeof req.body?.parentId === 'string'
        ? req.body.parentId
        : undefined) ??
      GLOBAL_SCOPE_NODE_ID
    );
  }

  private async applyEnforcementPolicy(
    userId: string,
    required: string,
    scopeNodeId: string,
    mode: EnforcementMode,
  ): Promise<boolean> {
    if (mode === 'enforce') {
      await this.authzAudit?.recordDenial({
        actorId: userId,
        requiredPermission: required,
        scopeNodeId,
        enforcementMode: 'enforce',
      });
      return false;
    }

    // audit | warn: allow-but-record
    if (mode === 'warn') {
      this.logger.warn(
        `RBAC would-deny [${required}] for user ${userId} at scope ${scopeNodeId} (mode=warn)`,
      );
    }
    await this.authzAudit?.recordDenial({
      actorId: userId,
      requiredPermission: required,
      scopeNodeId,
      enforcementMode: mode,
    });
    return true;
  }
}
