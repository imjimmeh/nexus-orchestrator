import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ScopeService } from './scope.service';
import { CreateScopeNodeDto } from './dto/create-scope-node.dto';
import { EnsureScopeNodeDto } from './dto/ensure-scope-node.dto';
import { MoveScopeNodeDto } from './dto/move-scope-node.dto';
import { UpdateScopeNodeDto } from './dto/update-scope-node.dto';
import { JwtUser } from '../auth/jwt-user.types';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('scopes')
export class ScopeController {
  constructor(private readonly scopeService: ScopeService) {}

  @Post()
  @RequirePermission('scopes:create')
  async create(@Body() body: CreateScopeNodeDto) {
    return { success: true, data: await this.scopeService.createNode(body) };
  }

  @Post('ensure')
  @RequirePermission('scopes:create')
  async ensure(@Body() body: EnsureScopeNodeDto) {
    return { success: true, data: await this.scopeService.ensureNode(body) };
  }

  @Get('tree')
  @RequirePermission('scopes:read')
  async getTree(@Req() req: { user: JwtUser }) {
    return {
      success: true,
      data: await this.scopeService.getTree(req.user.userId),
    };
  }

  @Get('maintenance/orphans')
  @RequirePermission('scopes:manage')
  async getOrphans() {
    return {
      success: true,
      data: await this.scopeService.findOrphanedProjectNodes(),
    };
  }

  @Get(':scopeId')
  @RequirePermission('scopes:read')
  async getNode(@Param('scopeId') scopeId: string) {
    return {
      success: true,
      data: await this.scopeService.getNode(scopeId),
    };
  }

  @Post(':scopeId/archive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('scopes:manage')
  async archiveNode(
    @Param('scopeId') scopeId: string,
    @Req() req: { user: JwtUser },
  ) {
    await this.scopeService.archiveNode(scopeId, req.user.userId);
    return { success: true };
  }

  @Post(':scopeId/restore')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('scopes:manage')
  async restoreNode(
    @Param('scopeId') scopeId: string,
    @Req() req: { user: JwtUser },
  ) {
    await this.scopeService.restoreNode(scopeId, req.user.userId);
    return { success: true };
  }

  @Patch(':scopeId/move')
  @RequirePermission('scopes:update')
  async moveNode(
    @Param('scopeId') scopeId: string,
    @Body() body: MoveScopeNodeDto,
    @Req() req: { user: JwtUser },
  ) {
    await this.scopeService.moveNode(
      scopeId,
      body.newParentId,
      req.user.userId,
    );
    return { success: true };
  }

  @Patch(':scopeId')
  @RequirePermission('scopes:update')
  async update(
    @Param('scopeId') scopeId: string,
    @Body() body: UpdateScopeNodeDto,
    @Req() req: { user: JwtUser },
  ) {
    return {
      success: true,
      data: await this.scopeService.updateNode(scopeId, {
        name: body.name,
        isTenantRoot: body.isTenantRoot,
        actorId: req.user.userId,
      }),
    };
  }

  @Get(':scopeId/allowed-child-types')
  @RequirePermission('scopes:read')
  async allowedChildTypes(@Param('scopeId') scopeId: string) {
    return {
      success: true,
      data: await this.scopeService.getAllowedChildTypes(scopeId),
    };
  }
}
