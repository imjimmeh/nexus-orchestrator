import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StartupResumeCoordinator } from '../execution-lifecycle/startup-resume.coordinator';
import type { ResumeSummary } from '../execution-lifecycle/startup-resume.coordinator.types';

@ApiTags('operations-lifecycle')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operations/lifecycle')
export class OperationsLifecycleController {
  constructor(private readonly resumeCoordinator: StartupResumeCoordinator) {}

  @Get('resume-summary')
  @RequirePermission('settings:read')
  @ApiOperation({
    summary: 'Report the freeze/resume outcome from the last service restart',
  })
  getResumeSummary(): { success: true; data: ResumeSummary } {
    return {
      success: true,
      data: this.resumeCoordinator.lastResumeSummary,
    };
  }
}
