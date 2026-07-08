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
import { CreateStandingOrderDto } from './dto/create-standing-order.dto';
import { ListStandingOrdersDto } from './dto/list-standing-orders.dto';
import { UpdateStandingOrderDto } from './dto/update-standing-order.dto';
import { StandingOrdersService } from './standing-orders.service';

@ApiTags('automation-standing-orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('automation/standing-orders')
export class StandingOrdersController {
  constructor(private readonly standingOrdersService: StandingOrdersService) {}

  @Post()
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Create a standing order policy instruction' })
  async create(@Body() dto: CreateStandingOrderDto) {
    const data = await this.standingOrdersService.createStandingOrder(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List standing orders for a project' })
  async list(@Query() query: ListStandingOrdersDto) {
    const data = await this.standingOrdersService.listStandingOrders({
      scopeId: query.scopeId,
      profileName: query.profile_name,
      includeDisabled: query.include_disabled,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
    });

    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get standing order details' })
  async getById(@Param('id') id: string) {
    const data = await this.standingOrdersService.getStandingOrder(id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Update standing order details' })
  async update(@Param('id') id: string, @Body() dto: UpdateStandingOrderDto) {
    const data = await this.standingOrdersService.updateStandingOrder(id, dto);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('workflows:delete')
  @ApiOperation({ summary: 'Delete standing order' })
  async remove(@Param('id') id: string) {
    await this.standingOrdersService.deleteStandingOrder(id);
    return { success: true, data: { id } };
  }
}
