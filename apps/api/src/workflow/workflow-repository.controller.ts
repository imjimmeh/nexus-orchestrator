import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { RepositoryWorkflowDiscoveryService } from './repository-workflow-discovery.service';
import type {
  RepositoryWorkflowDiscoveryRequest,
  RepositoryWorkflowDiscoveryResult,
} from './repository-workflow-discovery.types';

export const refreshRepositoryWorkflowsSchema = z.object({
  scopeId: z.string().min(1),
  rootPath: z.string().min(1),
  sourceRef: z.string().optional(),
});
void refreshRepositoryWorkflowsSchema;

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflows/repository')
export class WorkflowRepositoryController {
  constructor(
    private readonly discoveryService: RepositoryWorkflowDiscoveryService,
  ) {}

  @Post('refresh')
  @RequirePermission('workflows:update')
  async refreshRepositoryWorkflows(
    @Body(new ZodValidationPipe(refreshRepositoryWorkflowsSchema))
    body: RepositoryWorkflowDiscoveryRequest,
  ): Promise<RepositoryWorkflowDiscoveryResult> {
    return this.discoveryService.refreshRepositoryWorkflows(body);
  }
}
