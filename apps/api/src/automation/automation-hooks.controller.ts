import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { CreateAutomationHookDto } from './dto/create-automation-hook.dto';
import { ListAutomationHooksDto } from './dto/list-automation-hooks.dto';
import { UpdateAutomationHookDto } from './dto/update-automation-hook.dto';
import { AutomationHooksService } from './automation-hooks.service';

@ApiTags('automation-hooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('automation/hooks')
export class AutomationHooksController {
  constructor(
    private readonly automationHooksService: AutomationHooksService,
  ) {}

  @Post()
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Create an automation hook' })
  async create(@Body() dto: CreateAutomationHookDto) {
    const data = await this.automationHooksService.createHook(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List automation hooks' })
  async list(@Query() query: ListAutomationHooksDto) {
    const data = await this.automationHooksService.listHooks(
      {
        scopeId: query.scopeId,
        triggerType: query.trigger_type,
      },
      {
        limit: query.limit,
        offset: query.offset,
      },
    );

    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get automation hook details' })
  async getById(@Param('id') id: string) {
    const data = await this.automationHooksService.getHook(id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Update automation hook configuration' })
  async update(@Param('id') id: string, @Body() dto: UpdateAutomationHookDto) {
    const data = await this.automationHooksService.updateHook(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('workflows:delete')
  @ApiOperation({ summary: 'Delete automation hook' })
  async remove(@Param('id') id: string) {
    await this.automationHooksService.deleteHook(id);
    return { success: true, data: { id } };
  }
}
