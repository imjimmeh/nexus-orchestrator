import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { MemoryMetricsService } from './memory-metrics.service';
import type { MemoryMetricsSnapshot } from './memory-metrics.types';

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memory/metrics')
export class MemoryMetricsController {
  constructor(private readonly memoryMetricsService: MemoryMetricsService) {}

  @Get()
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'Get per-backend memory observability snapshot' })
  async getSnapshot(): Promise<{ success: true; data: MemoryMetricsSnapshot }> {
    const data = await this.memoryMetricsService.getSnapshot();
    return { success: true, data };
  }
}
