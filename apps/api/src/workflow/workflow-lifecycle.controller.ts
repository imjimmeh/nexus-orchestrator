import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  lifecycleResultsQuerySchema,
  type LifecycleResultsQueryRequest,
  type WorkflowLifecycleExecutionRequest,
  type WorkflowLifecycleExecutionResult,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkflowLifecycleResult } from './database/entities/workflow-lifecycle-result.entity';
import { WorkflowLifecycleResultRepository } from './database/repositories/workflow-lifecycle-result.repository';
import { WorkflowLifecycleExecutionService } from './workflow-lifecycle-execution.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflows/lifecycle')
export class WorkflowLifecycleController {
  constructor(
    private readonly lifecycleService: WorkflowLifecycleExecutionService,
    private readonly lifecycleResultRepo: WorkflowLifecycleResultRepository,
  ) {}

  @Get('results')
  @RequirePermission('workflows:read')
  async getResults(
    @Query(new ZodValidationPipe(lifecycleResultsQuerySchema))
    query: LifecycleResultsQueryRequest,
  ): Promise<{ success: true; data: WorkflowLifecycleResult[] }> {
    return {
      success: true,
      data: await this.lifecycleResultRepo.findFiltered(query),
    };
  }

  @Post('execute')
  @RequirePermission('workflows:update')
  async execute(
    @Body() body: WorkflowLifecycleExecutionRequest,
  ): Promise<WorkflowLifecycleExecutionResult> {
    return this.lifecycleService.executeLifecycleWorkflows(body);
  }
}
