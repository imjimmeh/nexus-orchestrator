import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  chatMemoryLimitQuerySchema,
  type ChatMemoryLimitQueryRequest,
} from '@nexus/core';
import { InternalServiceAuthGuard } from '../common/internal-service-auth.guard';
import { InternalServiceScopes } from '../common/internal-service-scopes.decorator';
import { ChatMemoryEventRepository } from '../database/repositories/chat-memory-event.repository';
import { ChatMemoryJobRepository } from '../database/repositories/chat-memory-job.repository';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';

type ChatMemoryLimitQueryDto = ChatMemoryLimitQueryRequest;

@UseGuards(InternalServiceAuthGuard)
@InternalServiceScopes('chat.memory:read')
@Controller('internal/chat-memory')
export class ChatMemoryObservabilityController {
  constructor(
    private readonly metrics: ChatMemoryMetricsService,
    private readonly jobs: ChatMemoryJobRepository,
    private readonly events: ChatMemoryEventRepository,
  ) {}

  @Get('metrics')
  getMetrics() {
    const data = this.metrics.snapshot();
    return { success: true, data };
  }

  @Get('jobs')
  async listRecentJobs(
    @ZodQuery(chatMemoryLimitQuerySchema) query: ChatMemoryLimitQueryDto,
  ) {
    const data = await this.jobs.listRecent(query.limit);
    return { success: true, data };
  }

  @Get('events')
  async listRecentEvents(
    @ZodQuery(chatMemoryLimitQuerySchema) query: ChatMemoryLimitQueryDto,
  ) {
    const data = await this.events.listRecent(query.limit);
    return { success: true, data };
  }
}
