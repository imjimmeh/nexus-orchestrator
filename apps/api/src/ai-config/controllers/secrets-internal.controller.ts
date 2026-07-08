import {
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalServiceScopeGuard } from '../../auth/internal-service-scope.guard';
import { InternalServiceScopes } from '../../auth/internal-service-scopes.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { SecretCrudService } from '../../security/services/secret-crud.service';
import {
  CreateSecretSchema,
  retrieveSecretSchema,
  type CreateSecretRequest,
  type RetrieveSecretRequest,
} from '@nexus/core';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `ai-config/secrets-internal`. Source role set:
 * `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - retrieveSecret  Admin / Developer -> secrets:manage
 *   - upsertSecret    Admin / Developer -> secrets:manage
 *
 * Notes:
 *   - Both handlers operate on the secrets resource at the same
 *     management tier as the legacy role-list (the `Admin`/`Developer`
 *     tier), so a single `secrets:manage` permission is applied at
 *     the class level. Both read and write paths inherit it without
 *     an explicit per-handler override.
 *   - The `InternalServiceScopes` decorator remains in place: this
 *     is an internal-surface controller and the upstream guard
 *     `InternalServiceScopeGuard` continues to enforce that the
 *     caller carries an internal service scope token in addition
 *     to the user permission.
 */

@ApiTags('internal')
@Controller('internal/secrets')
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermission('secrets:manage')
export class SecretsInternalController {
  constructor(private readonly secretCrud: SecretCrudService) {}

  @Post('retrieve')
  @InternalServiceScopes('core.secrets:read')
  @ApiOperation({
    summary: 'Retrieve decrypted secret value (internal use only)',
  })
  async retrieveSecret(
    @ZodBody(retrieveSecretSchema) body: RetrieveSecretRequest,
  ) {
    const secret = await this.secretCrud.findByIdRaw(body.secretId);
    if (!secret) {
      throw new NotFoundException(`Secret ${body.secretId} not found`);
    }

    return {
      secretValue: secret.decryptedValue,
    };
  }

  @Post('upsert')
  @InternalServiceScopes('core.secrets:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Create or update a secret by name (idempotent). Returns the sanitized secret metadata. Internal use only.',
  })
  async upsertSecret(
    @ZodBody(CreateSecretSchema) body: CreateSecretRequest,
  ): Promise<{ secret: { id: string; name: string }; created: boolean }> {
    const result = await this.secretCrud.upsertByName(body);
    return {
      secret: {
        id: result.secret.id,
        name: result.secret.name,
      },
      created: result.created,
    };
  }
}
