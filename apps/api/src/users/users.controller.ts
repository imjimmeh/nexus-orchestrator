import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateUserRequestSchema,
  ListUsersQuerySchema,
  ResetPasswordSchema,
  UpdateUserRequestSchema,
} from '@nexus/core';
import type {
  CreateUserRequest,
  ListUsersQuery,
  ResetPasswordInput,
  UpdateUserRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';
import { RoleAssignmentService } from '../auth/authorization/role-assignment.service';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import { User } from './database/entities/user.entity';
import { UsersService } from './users.service';
import type { PaginatedUsersResult } from './users.service.types';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;

function emptyUserDirectory(query: ListUsersQuery): PaginatedUsersResult {
  return {
    data: [],
    total: 0,
    page: query.page ?? DEFAULT_PAGE,
    limit: query.limit ?? DEFAULT_LIMIT,
    totalPages: 0,
  };
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly scopeAccess: ScopeAccessService,
    private readonly roleAssignments: RoleAssignmentService,
  ) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'List all users with pagination and filtering' })
  async listUsers(
    @ZodQuery(ListUsersQuerySchema) query: ListUsersQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const { scopeNodeId, ...rest } = query;

    // No scopeNodeId: the master user directory is a platform-plane
    // surface (users have no scope column), so the full directory is
    // returned unfiltered — matching the existing users:read guard.
    if (!scopeNodeId) {
      const result = await this.usersService.listUsers(rest);
      return this.wrapUserDirectory(result);
    }

    // With a scopeNodeId: confine to the effective membership at that
    // accessible subtree (via RoleAssignmentService) rather than adding a
    // scope column to `users`. An out-of-subtree scopeNodeId yields an empty
    // directory (default-deny).
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'users:read',
      scopeNodeId,
    );
    if (scopeIds.length === 0) {
      return { success: true, data: emptyUserDirectory(query) };
    }

    // Effective (not exact-node) membership: walks the scope closure so a user
    // whose role is assigned at an ANCESTOR scope — and who therefore has
    // inherited access at this descendant — is included, matching the
    // effective-membership model used elsewhere (e.g. ScopeMembersPanel).
    const members =
      await this.roleAssignments.listEffectiveMembersAtNode(scopeNodeId);
    const userIds = [...new Set(members.map((member) => member.userId))];
    if (userIds.length === 0) {
      return { success: true, data: emptyUserDirectory(query) };
    }

    const result = await this.usersService.listUsers({ ...rest, userIds });
    return this.wrapUserDirectory(result);
  }

  private wrapUserDirectory(result: PaginatedUsersResult) {
    return {
      success: true,
      data: {
        ...result,
        data: result.data.map((user) => this.mapUserToResponse(user)),
      },
    };
  }

  @Get(':id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Get user details by ID' })
  async getUser(@Param('id') id: string) {
    const user = await this.usersService.getUserById(id);
    return { success: true, data: this.mapUserToResponse(user) };
  }

  private mapUserToResponse(user: User) {
    const roles = (user.userRoles ?? [])
      .map((userRole) => userRole.role?.name)
      .filter((name): name is string => typeof name === 'string');

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString(),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  @Post()
  @RequirePermission('users:create')
  @ApiOperation({ summary: 'Create a new user' })
  async createUser(@ZodBody(CreateUserRequestSchema) dto: CreateUserRequest) {
    const user = await this.usersService.createUser(dto);
    return { success: true, data: this.mapUserToResponse(user) };
  }

  @Patch(':id')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Update user details' })
  async updateUser(
    @Param('id') id: string,
    @ZodBody(UpdateUserRequestSchema) dto: UpdateUserRequest,
  ) {
    const user = await this.usersService.updateUser(id, dto);
    return { success: true, data: this.mapUserToResponse(user) };
  }

  @Delete(':id')
  @RequirePermission('users:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disable a user (soft delete)' })
  async disableUser(@Param('id') id: string) {
    await this.usersService.disableUser(id);
  }

  @Post(':id/reset-password')
  @RequirePermission('users:update')
  @ApiOperation({ summary: 'Reset user password' })
  async resetPassword(
    @Param('id') id: string,
    @ZodBody(ResetPasswordSchema) dto: ResetPasswordInput,
  ) {
    await this.usersService.resetPassword(id, dto.newPassword);
    return { success: true, message: 'Password reset successfully' };
  }
}
