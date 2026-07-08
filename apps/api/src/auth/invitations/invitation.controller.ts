import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { PermissionsGuard } from '../authorization/permissions.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import type { JwtUser } from '../jwt-user.types';
import { InvitationService } from './invitation.service';
import type { CreateInvitationBody } from './invitation.types';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Post('scopes/:scopeNodeId/invitations')
  @RequirePermission('roles:manage')
  async issue(
    @Param('scopeNodeId') scopeNodeId: string,
    @Body() body: CreateInvitationBody,
    @Req() req: { user: JwtUser },
  ) {
    const { invitation, rawToken } = await this.invitations.createInvitation({
      scopeNodeId,
      roleId: body.roleId,
      email: body.email,
      invitedByUserId: req.user.userId,
    });
    return { success: true, data: { invitation, inviteToken: rawToken } };
  }

  @Get('scopes/:scopeNodeId/invitations')
  @RequirePermission('roles:read')
  async list(@Param('scopeNodeId') scopeNodeId: string) {
    return {
      success: true,
      data: await this.invitations.listInvitationsAtNode(scopeNodeId),
    };
  }

  // NOTE: this route has no `:scopeNodeId` param, so `PermissionsGuard`
  // resolves its coarse scope check against the global root — it only
  // gates whether the actor can manage roles *somewhere*. The real
  // subtree-scoped authorization (does this actor manage the invitation's
  // OWN scope subtree) is enforced inside `InvitationService.revokeInvitation`,
  // which is the actual authority here.
  @Delete('invitations/:id')
  @RequirePermission('roles:manage')
  @HttpCode(204)
  async revoke(
    @Param('id') id: string,
    @Req() req: { user: JwtUser },
  ): Promise<void> {
    await this.invitations.revokeInvitation(id, req.user.userId);
  }
}
