import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { MemoryListingService } from '../memory/memory-listing.service';
import { ListMemorySegmentsDto } from '../memory/dto/list-memory-segments.dto';
import type { MemorySegmentsPage } from '../memory/memory-listing.types';

const USER_MEMORY_ENTITY_TYPE = 'User';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users/:userId/memory')
export class UserMemoryController {
  constructor(private readonly memoryListingService: MemoryListingService) {}

  @Get('segments')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'List user memory segments' })
  async listSegments(
    @Param('userId') userId: string,
    @Query() query: ListMemorySegmentsDto,
  ): Promise<{ success: true; data: MemorySegmentsPage }> {
    const data = await this.memoryListingService.listSegments({
      entityType: USER_MEMORY_ENTITY_TYPE,
      entityId: userId,
      memoryType: query.memory_type,
      query: query.query,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data };
  }
}
