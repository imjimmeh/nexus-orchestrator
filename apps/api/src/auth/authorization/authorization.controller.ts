import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { AuthorizationService } from './authorization.service';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';

interface AuthenticatedRequest {
  user: { userId: string; roles?: string[] };
}

@Controller('me')
@UseGuards(JwtAuthGuard)
export class AuthorizationController {
  constructor(private readonly authz: AuthorizationService) {}

  @Get('permissions')
  async myPermissions(
    @Request() req: AuthenticatedRequest,
    @Query('scopeNodeId') scopeNodeId: string = GLOBAL_SCOPE_NODE_ID,
  ) {
    const perms = await this.authz.getEffectivePermissions(
      req.user.userId,
      scopeNodeId,
      req.user.roles,
    );
    return {
      scopeNodeId,
      permissions: [...perms].sort(),
    };
  }
}
