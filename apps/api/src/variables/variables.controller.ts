import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  UpsertScopedVariableSchema,
  type UpsertScopedVariableRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { JwtUser } from '../auth/jwt-user.types';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { ScopedVariableRepository } from './database/repositories/scoped-variable.repository';
import { ScopedVariableAuditRepository } from './database/repositories/scoped-variable-audit.repository';
import { VariableResolverService } from './variable-resolver.service';

@ApiTags('variables')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('variables')
export class VariablesController {
  constructor(
    private readonly repository: ScopedVariableRepository,
    private readonly auditRepo: ScopedVariableAuditRepository,
    private readonly resolver: VariableResolverService,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  /** GET /variables/audit must precede GET /variables to avoid route shadowing. */
  @Get('audit')
  @ApiOperation({
    summary: 'List audit history for a scope (optionally by key)',
  })
  @ApiQuery({ name: 'scopeId', required: false })
  @ApiQuery({ name: 'key', required: false })
  async audit(@Query('scopeId') scopeId?: string, @Query('key') key?: string) {
    const data = await this.auditRepo.listFor(scopeId ?? null, key);
    return { success: true, data };
  }

  @Get('effective')
  @ApiOperation({ summary: 'Resolve effective variables for a scope' })
  @ApiQuery({ name: 'scopeId', required: false })
  async effective(@Query('scopeId') scopeId?: string) {
    const data = await this.resolver.resolveEffective(scopeId ?? null);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List variables for a scope (or global)' })
  @ApiQuery({ name: 'scopeId', required: false })
  async list(
    @Query('scopeId') scopeId: string | undefined,
    @Req() req: { user: JwtUser },
  ) {
    if (!scopeId) {
      const rows = await this.repository.listForScope(null);
      return { success: true, data: rows };
    }

    // Scoped (non-global) variables are confined to the caller's accessible
    // scope subtree; an out-of-subtree scopeId yields an empty result
    // (default-deny) rather than falling back to the global tier.
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'settings:read',
      scopeId,
    );
    if (scopeIds.length === 0) {
      return { success: true, data: [] };
    }

    const rows = await this.repository.listForScope(scopeId);
    return { success: true, data: rows };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a variable' })
  async upsert(
    @ZodBody(UpsertScopedVariableSchema) dto: unknown,
    @Req() req: { user: JwtUser },
  ) {
    const input = dto as UpsertScopedVariableRequest;
    const data = await this.repository.upsert(input, req.user.userId);
    return { success: true, data };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a variable by key + scope' })
  @ApiQuery({ name: 'key', required: true })
  @ApiQuery({ name: 'scopeId', required: false })
  async remove(
    @Query('key') key: string,
    @Query('scopeId') scopeId: string | undefined,
    @Req() req: { user: JwtUser },
  ) {
    await this.repository.deleteByKeyAndScope(
      key,
      scopeId ?? null,
      req.user.userId,
    );
    return { success: true };
  }
}
