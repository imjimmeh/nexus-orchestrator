import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { PluginToolInvocationService } from './plugin-tool-invocation.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `plugin-kernel/contributions`. Source role set:
 * `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - invokeContribution  Admin / Developer / Agent -> resources:manage
 *
 * Notes:
 *   - The plugin-tool surface is registered as a `resources:manage`
 *     capability because plugins can do arbitrary work and the
 *     existing role-list (`Admin` / `Developer` / `Agent`) is the
 *     same broad resource-management tier used by other internal
 *     tool-invocation sites.
 */

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('plugins')
export class PluginToolInvocationController {
  constructor(
    private readonly pluginToolInvocation: PluginToolInvocationService,
  ) {}

  @Post(':pluginId/:version/contributions/:contributionId/invoke')
  @RequirePermission('resources:manage')
  invokeContribution(
    @Param('pluginId') pluginId: string,
    @Param('version') version: string,
    @Param('contributionId') contributionId: string,
    @Body() input: unknown,
  ) {
    return this.pluginToolInvocation.invokeByContribution({
      pluginId,
      version,
      contributionId,
      input,
    });
  }
}
