import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { WorkflowRuntimeCapabilityLifecycleService } from './workflow-runtime-capability-lifecycle.service';
import type {
  CreateArtifactParams,
  DeleteArtifactFileParams,
  ListArtifactsParams,
  RuntimeContextInput,
  SaveScriptAsArtifactParams,
  UpsertArtifactFileParams,
} from './workflow-runtime-capability-lifecycle.types';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/artifacts` (agent runtime traffic).
 * Source role set: `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - createArtifact       Admin / Developer / Agent -> memory:create
 *   - listArtifacts        Admin / Developer / Agent -> memory:read
 *   - saveScriptAsArtifact Admin / Developer / Agent -> memory:create
 *   - listArtifactFiles    Admin / Developer / Agent -> memory:read
 *   - upsertArtifactFile   Admin / Developer / Agent -> memory:update
 *   - deleteArtifactFile   Admin / Developer / Agent -> memory:manage
 *
 * Notes:
 *   - Artifact records are durable memory-like library entries
 *     (see `ArtifactLibraryService`), so the agent's documented
 *     memory permissions map naturally to the artifact CRUD surface.
 *   - `deleteArtifactFile` is a lifecycle action the agent role
 *     cannot perform via `memory:delete` (not in its base set), so
 *     the migration's "Plus any `*:manage` permissions required for
 *     lifecycle handlers" clause applies and `memory:manage` is
 *     used.
 */

type RuntimeCapabilityContextBody = Pick<
  RuntimeContextInput,
  'workflow_run_id' | 'job_id'
>;
type CreateArtifactBody = Omit<CreateArtifactParams, 'user'>;
type ListArtifactsBody = Omit<ListArtifactsParams, 'user'>;
type UpsertArtifactFileBody = Omit<
  UpsertArtifactFileParams,
  'artifact_id' | 'user'
>;
type DeleteArtifactFileBody = Omit<
  DeleteArtifactFileParams,
  'artifact_id' | 'user'
>;
type SaveScriptAsArtifactBody = Omit<SaveScriptAsArtifactParams, 'user'>;

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeArtifactsController {
  constructor(
    private readonly lifecycleTools: WorkflowRuntimeCapabilityLifecycleService,
  ) {}

  private getRuntimeUser(
    req: AuthenticatedRequest,
  ): RuntimeContextInput['user'] {
    return req.user
      ? {
          userId: req.user.userId,
          roles: req.user.roles,
          agentProfileName: req.user.agentProfileName,
        }
      : undefined;
  }

  @Post('artifacts')
  @RequirePermission('memory:create')
  @ApiOperation({ summary: 'Create a global artifact library record.' })
  async createArtifact(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateArtifactBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.createArtifact({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('artifacts/list')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'List global artifacts with optional filtering.' })
  async listArtifacts(
    @Req() req: AuthenticatedRequest,
    @Body() body: ListArtifactsBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.listArtifacts({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('artifacts/save-script')
  @RequirePermission('memory:create')
  @ApiOperation({
    summary: 'Persist script content into the global artifact library.',
  })
  async saveScriptAsArtifact(
    @Req() req: AuthenticatedRequest,
    @Body() body: SaveScriptAsArtifactBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.saveScriptAsArtifact({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('artifacts/:artifactId/files/list')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'List files under a global artifact entry.' })
  async listArtifactFiles(
    @Req() req: AuthenticatedRequest,
    @Param('artifactId') artifactId: string,
    @Body() body: RuntimeCapabilityContextBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.listArtifactFiles({
      artifact_id: artifactId,
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Put('artifacts/:artifactId/files')
  @RequirePermission('memory:update')
  @ApiOperation({
    summary: 'Create or update a file under a global artifact entry.',
  })
  async upsertArtifactFile(
    @Req() req: AuthenticatedRequest,
    @Param('artifactId') artifactId: string,
    @Body() body: UpsertArtifactFileBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.upsertArtifactFile({
      artifact_id: artifactId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Delete('artifacts/:artifactId/files')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Delete a file from a global artifact entry.' })
  async deleteArtifactFile(
    @Req() req: AuthenticatedRequest,
    @Param('artifactId') artifactId: string,
    @Body() body: DeleteArtifactFileBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.deleteArtifactFile({
      artifact_id: artifactId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }
}
