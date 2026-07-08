import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateModelSchema,
  ListModelsQuerySchema,
  UpdateModelSchema,
} from '@nexus/core';
import type {
  CreateModelRequest,
  ListModelsQuery,
  UpdateModelRequest,
} from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';

@ApiTags('ai-config-models')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/models')
export class ModelsController {
  constructor(private readonly aiConfigAdmin: AiConfigAdminService) {}

  @Get()
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List LLM models' })
  async listModels(@ZodQuery(ListModelsQuerySchema) query: ListModelsQuery) {
    return this.aiConfigAdmin.listModelsPaginated(query);
  }

  @Get('presets')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List LLM model presets supported by pi-runner' })
  async listPresets() {
    return this.aiConfigAdmin.listModelPresets();
  }

  @Get(':id')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get LLM model by ID' })
  async getModel(@Param('id') id: string) {
    return { success: true, data: await this.aiConfigAdmin.getModel(id) };
  }

  @Post()
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Create LLM model' })
  async createModel(@ZodBody(CreateModelSchema) dto: unknown) {
    return {
      success: true,
      data: await this.aiConfigAdmin.createModel(dto as CreateModelRequest),
    };
  }

  @Patch(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Update LLM model' })
  async updateModel(
    @Param('id') id: string,
    @ZodBody(UpdateModelSchema) dto: unknown,
  ) {
    return {
      success: true,
      data: await this.aiConfigAdmin.updateModel(id, dto as UpdateModelRequest),
    };
  }

  @Delete(':id')
  @RequirePermission('agents:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete LLM model' })
  async deleteModel(@Param('id') id: string) {
    await this.aiConfigAdmin.deleteModel(id);
  }
}
