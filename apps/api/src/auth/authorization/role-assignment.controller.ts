import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { EffectiveMember } from '@nexus/core';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermission } from './require-permission.decorator';
import { RoleAssignmentService } from './role-assignment.service';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { RoleRepository } from '../database/repositories/role.repository';
import { Role } from '../database/entities/role.entity';

interface RoleAssignmentBody {
  userId: string;
  roleId: string;
}

interface ApiEnvelope<T> {
  success: true;
  data: T;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RoleAssignmentController {
  constructor(
    private readonly assignments: RoleAssignmentService,
    private readonly roleRepository: RoleRepository,
  ) {}

  @Post('scopes/:scopeNodeId/role-assignments')
  @RequirePermission('roles:manage')
  async assign(
    @Param('scopeNodeId') scopeNodeId: string,
    @Body() body: RoleAssignmentBody,
  ): Promise<ApiEnvelope<RoleAssignment>> {
    const data = await this.assignments.assignRole(
      body.userId,
      body.roleId,
      scopeNodeId,
    );
    return { success: true, data };
  }

  @Delete('scopes/:scopeNodeId/role-assignments')
  @RequirePermission('roles:manage')
  @HttpCode(204)
  async revoke(
    @Param('scopeNodeId') scopeNodeId: string,
    @Body() body: RoleAssignmentBody,
  ): Promise<void> {
    await this.assignments.revokeRole(body.userId, body.roleId, scopeNodeId);
  }

  @Get('scopes/:scopeNodeId/role-assignments')
  @RequirePermission('roles:read')
  async listAtNode(
    @Param('scopeNodeId') scopeNodeId: string,
  ): Promise<ApiEnvelope<RoleAssignment[]>> {
    const data = await this.assignments.listAssignmentsAtNode(scopeNodeId);
    return { success: true, data };
  }

  @Get('users/:userId/role-assignments')
  @RequirePermission('roles:read')
  async listForUser(
    @Param('userId') userId: string,
  ): Promise<ApiEnvelope<RoleAssignment[]>> {
    const data = await this.assignments.listAssignmentsForUser(userId);
    return { success: true, data };
  }

  @Get('scopes/:scopeNodeId/members')
  @RequirePermission('roles:read')
  async listMembers(
    @Param('scopeNodeId') scopeNodeId: string,
  ): Promise<ApiEnvelope<EffectiveMember[]>> {
    const data = await this.assignments.listEffectiveMembersAtNode(scopeNodeId);
    return { success: true, data };
  }

  @Get('roles')
  @RequirePermission('roles:read')
  async listRoles(): Promise<ApiEnvelope<Role[]>> {
    const data = await this.roleRepository.find();
    return { success: true, data };
  }
}
