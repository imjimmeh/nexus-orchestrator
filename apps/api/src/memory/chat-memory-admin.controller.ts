import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  chatMemoryObservabilityQuerySchema,
  type ChatMemoryObservabilityQueryRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import { ChatMemoryAdminService } from './chat-memory-admin.service';
import { ListChatMemorySegmentsDto } from './dto/list-chat-memory-segments.dto';

type ChatMemoryObservabilityQueryDto = ChatMemoryObservabilityQueryRequest;

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memory/chat')
export class ChatMemoryAdminController {
  constructor(private readonly chatMemoryService: ChatMemoryAdminService) {}

  @Get('observability')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Get chat memory observability summary' })
  async getObservability(
    @ZodQuery(chatMemoryObservabilityQuerySchema)
    query: ChatMemoryObservabilityQueryDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<ChatMemoryAdminService['getObservability']>>;
  }> {
    const data = await this.chatMemoryService.getObservability({
      recentJobsLimit: query.jobs_limit,
      recentEventsLimit: query.events_limit,
    });

    return {
      success: true,
      data,
    };
  }

  @Get('segments')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'List chat memory segments' })
  async listSegments(@Query() query: ListChatMemorySegmentsDto): Promise<{
    success: true;
    data: Awaited<ReturnType<ChatMemoryAdminService['listSegments']>>;
  }> {
    const data = await this.chatMemoryService.listSegments({
      source: query.source,
      profileId: query.profile_id,
      chatSessionId: query.chat_session_id,
      memoryType: query.memory_type,
      query: query.query,
      includeArchived: query.include_archived,
      onlyUndistilled: query.only_undistilled,
      limit: query.limit,
      offset: query.offset,
    });

    return {
      success: true,
      data,
    };
  }
}
