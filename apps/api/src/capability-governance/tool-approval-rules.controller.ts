import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createToolApprovalRuleSchema,
  updateToolApprovalRuleSchema,
  type ArgumentPatternInput,
  type CreateToolApprovalRuleRequest,
  type UpdateToolApprovalRuleRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import type {
  ToolApprovalRuleEffect,
  ToolApprovalRuleScope,
} from '../tool/database/entities/tool-approval-rule.entity';
import { ToolApprovalRuleService } from './tool-approval-rule.service';

class CreateToolApprovalRuleDto implements CreateToolApprovalRuleRequest {
  static get schema() {
    return createToolApprovalRuleSchema;
  }

  scopeType!: ToolApprovalRuleScope;

  scopeId?: string | null;

  toolName!: string;

  effect!: ToolApprovalRuleEffect;

  priority?: number;

  argumentPatterns?: ArgumentPatternInput[] | null;

  createdBy?: string | null;

  expiresAt?: Date | null;
}

class UpdateToolApprovalRuleDto implements UpdateToolApprovalRuleRequest {
  static get schema() {
    return updateToolApprovalRuleSchema;
  }

  scopeType?: ToolApprovalRuleScope;

  scopeId?: string | null;

  toolName?: string;

  effect?: ToolApprovalRuleEffect;

  priority?: number;

  argumentPatterns?: ArgumentPatternInput[] | null;

  expiresAt?: Date | null;
}

@ApiTags('tool-approval-rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tool-approval-rules')
export class ToolApprovalRulesController {
  constructor(private readonly ruleService: ToolApprovalRuleService) {}

  @Get()
  @RequirePermission('approvals:manage')
  @ApiOperation({ summary: 'List tool approval rules' })
  async listRules(
    @Query('scopeType') scopeType?: ToolApprovalRuleScope,
    @Query('scopeId') scopeId?: string,
    @Query('toolName') toolName?: string,
    @Query('effect') effect?: ToolApprovalRuleEffect,
  ) {
    return this.ruleService.listRules({
      scopeType,
      scopeId,
      toolName,
      effect,
    });
  }

  @Get(':id')
  @RequirePermission('approvals:manage')
  @ApiOperation({ summary: 'Get a tool approval rule' })
  async getRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.ruleService.getRuleOrThrow(id);
  }

  @Post()
  @RequirePermission('approvals:manage')
  @ApiOperation({ summary: 'Create a tool approval rule' })
  async createRule(@Body() dto: CreateToolApprovalRuleDto) {
    return this.ruleService.createRule({
      scopeType: dto.scopeType,
      scopeId: dto.scopeId,
      toolName: dto.toolName,
      effect: dto.effect,
      priority: dto.priority,
      argumentPatterns: dto.argumentPatterns,
      createdBy: dto.createdBy,
      expiresAt: dto.expiresAt ?? null,
    });
  }

  @Patch(':id')
  @RequirePermission('approvals:manage')
  @ApiOperation({ summary: 'Update a tool approval rule' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateToolApprovalRuleDto,
  ) {
    return this.ruleService.updateRule(id, {
      scopeType: dto.scopeType,
      scopeId: dto.scopeId,
      toolName: dto.toolName,
      effect: dto.effect,
      priority: dto.priority,
      argumentPatterns: dto.argumentPatterns,
      expiresAt: dto.expiresAt,
    });
  }

  @Delete(':id')
  @RequirePermission('approvals:manage')
  @ApiOperation({ summary: 'Delete a tool approval rule' })
  async deleteRule(@Param('id', ParseUUIDPipe) id: string) {
    await this.ruleService.deleteRule(id);
    return { ok: true };
  }
}
