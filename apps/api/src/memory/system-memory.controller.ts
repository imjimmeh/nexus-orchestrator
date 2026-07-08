import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { MemoryListingService } from './memory-listing.service';
import { ListMemorySegmentsDto } from './dto/list-memory-segments.dto';
import type { MemorySegmentsPage } from './memory-listing.types';

const SYSTEM_MEMORY_ENTITY_TYPE = 'System';

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memory/system')
export class SystemMemoryController {
  constructor(private readonly memoryListingService: MemoryListingService) {}

  @Get('segments')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'List system memory segments' })
  async listSegments(
    @Query() query: ListMemorySegmentsDto,
  ): Promise<{ success: true; data: MemorySegmentsPage }> {
    const data = await this.memoryListingService.listSegments({
      entityType: SYSTEM_MEMORY_ENTITY_TYPE,
      entityId: query.entity_id,
      memoryType: query.memory_type,
      query: query.query,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data };
  }
}
