import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';
import { ConfigExportService } from './config-export.service';
import { ReconciliationService } from './reconciliation.service';
import { GitOpsStatusService } from './gitops-status.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { GitOpsOutboundSyncService } from './gitops-outbound-sync.service';
import { GITOPS_CONFIG } from './gitops.constants';
import type { GitOpsConfig } from './gitops.constants.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  type CreateGitOpsRepositoryBindingDto,
  type ListGitOpsRepositoryBindingsQueryDto,
  type UpdateGitOpsRepositoryBindingDto,
} from './dto/gitops-repository-binding.dto.types';
import {
  createGitOpsRepositoryBindingSchema,
  gitOpsRepositoryBindingIdSchema,
  listGitOpsRepositoryBindingsQuerySchema,
  updateGitOpsRepositoryBindingSchema,
} from './dto/gitops-repository-binding.dto';

interface AuthedRequest {
  user: { userId: string };
}

@ApiTags('gitops')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('gitops')
export class GitOpsController {
  constructor(
    private readonly exporter: ConfigExportService,
    private readonly recon: ReconciliationService,
    private readonly statusSvc: GitOpsStatusService,
    @Inject(GITOPS_CONFIG) private readonly config: GitOpsConfig,
    private readonly bindings: GitOpsRepositoryBindingService,
    private readonly inbound: GitOpsInboundReconcileService,
    private readonly outbound: GitOpsOutboundSyncService,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  @Get('status')
  @RequirePermission('gitops:read')
  async getStatus() {
    const data = await this.statusSvc.getStatus();
    return { success: true, data };
  }

  @Get('export')
  @RequirePermission('gitops:read')
  async export() {
    const data = await this.exporter.exportToFiles();
    return { success: true, data };
  }

  @Post('validate')
  @RequirePermission('gitops:manage')
  validate(@Body() _body: { dir: string }) {
    // ConfigValidationService requires filesystem and DB context providers wired at runtime.
    // Full wiring is deferred to the reconciler work (EPIC-204I).
    return {
      success: true,
      data: {
        message: 'validation endpoint not yet wired to runtime providers',
      },
    };
  }

  @Post('reconcile')
  @RequirePermission('gitops:manage')
  @Header('Deprecation', 'true')
  async reconcile(
    @Req() req: AuthedRequest,
    @Body() body: { dryRun?: boolean },
  ) {
    const repo = { repoUrl: this.config.repoUrl, ref: this.config.ref };
    const ctx = { actorId: req.user.userId };
    const data =
      body.dryRun === false
        ? await this.recon.apply(repo, ctx)
        : await this.recon.plan(repo, ctx);
    return { success: true, data };
  }

  @Get('drift')
  @RequirePermission('gitops:manage')
  async drift(@Req() req: AuthedRequest) {
    const data = await this.recon.detectDrift(
      { repoUrl: this.config.repoUrl, ref: this.config.ref },
      { actorId: req.user.userId },
    );
    return { success: true, data };
  }

  @Get('bindings')
  @RequirePermission('gitops:read')
  async listBindings(
    @Query(new ZodValidationPipe(listGitOpsRepositoryBindingsQuerySchema))
    query: ListGitOpsRepositoryBindingsQueryDto,
    @Req() req: AuthedRequest,
  ) {
    // GitOps bindings always belong to a specific scope node (no
    // platform/global bindings), so an out-of-subtree scopeNodeId yields an
    // empty result rather than falling back to the caller's full accessible
    // set.
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'gitops:read',
      query.scopeNodeId,
    );
    if (scopeIds.length === 0) {
      return { success: true, data: [] };
    }
    const data = await this.bindings.list(query.scopeNodeId);
    return { success: true, data };
  }

  @Post('bindings')
  @RequirePermission('gitops:manage')
  async createBinding(
    @Body(new ZodValidationPipe(createGitOpsRepositoryBindingSchema))
    body: CreateGitOpsRepositoryBindingDto,
  ) {
    const data = await this.bindings.create(body);
    return { success: true, data };
  }

  @Get('bindings/:scopeNodeId/:bindingId')
  @RequirePermission('gitops:read')
  async getBinding(
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.bindings.get(bindingId, scopeNodeId);
    return { success: true, data };
  }

  @Patch('bindings/:scopeNodeId/:bindingId')
  @RequirePermission('gitops:manage')
  async updateBinding(
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
    @Body(new ZodValidationPipe(updateGitOpsRepositoryBindingSchema))
    body: UpdateGitOpsRepositoryBindingDto,
  ) {
    const data = await this.bindings.update(bindingId, scopeNodeId, body);
    return { success: true, data };
  }

  @Delete('bindings/:scopeNodeId/:bindingId')
  @RequirePermission('gitops:manage')
  async disableBinding(
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.bindings.disable(bindingId, scopeNodeId);
    return { success: true, data };
  }

  @Post('bindings/:scopeNodeId/:bindingId/validate')
  @RequirePermission('gitops:manage')
  async validateBinding(
    @Req() req: AuthedRequest,
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.inbound.validate(scopeNodeId, bindingId, {
      actorId: req.user.userId,
    });
    return { success: true, data };
  }

  @Post('bindings/:scopeNodeId/:bindingId/plan')
  @RequirePermission('gitops:manage')
  async planBinding(
    @Req() req: AuthedRequest,
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.inbound.plan(scopeNodeId, bindingId, {
      actorId: req.user.userId,
    });
    return { success: true, data };
  }

  @Post('bindings/:scopeNodeId/:bindingId/apply')
  @RequirePermission('gitops:manage')
  async applyBinding(
    @Req() req: AuthedRequest,
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.inbound.apply(scopeNodeId, bindingId, {
      actorId: req.user.userId,
    });
    return { success: true, data };
  }

  @Post('bindings/:scopeNodeId/:bindingId/outbound-sync')
  @RequirePermission('gitops:manage')
  async syncBindingOutbound(
    @Req() req: AuthedRequest,
    @Param(
      'scopeNodeId',
      new ZodValidationPipe(gitOpsRepositoryBindingIdSchema),
    )
    scopeNodeId: string,
    @Param('bindingId', new ZodValidationPipe(gitOpsRepositoryBindingIdSchema))
    bindingId: string,
  ) {
    const data = await this.outbound.sync(scopeNodeId, bindingId, {
      actorId: req.user.userId,
    });
    return { success: true, data };
  }
}
