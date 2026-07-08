import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { SecretUsageLookupService } from '../secret-usage-lookup.service';

@ApiTags('security-secrets')
@ApiBearerAuth()
@Controller('security/secrets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SecretsPublicController {
  constructor(private readonly usageLookup: SecretUsageLookupService) {}

  @Get(':id/usages')
  @RequirePermission('secrets:read')
  @ApiOperation({
    summary: 'List references to a secret without exposing its value',
  })
  async listSecretUsages(@Param('id') id: string) {
    return { success: true, data: await this.usageLookup.findUsages(id) };
  }
}
