import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  bulkApproveImprovementProposalsSchema,
  bulkRejectImprovementProposalsSchema,
  createSkillAssignmentProposalSchema,
  listImprovementProposalsSchema,
} from '@nexus/core';
import type {
  BulkApproveImprovementProposalsRequest,
  BulkRejectImprovementProposalsRequest,
  CreateSkillAssignmentProposalRequest,
  ListImprovementProposalsRequest,
} from '@nexus/core';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import type { JwtUser } from '../auth/jwt-user.types';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { ZodParam } from '../common/decorators/zod-param.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import type { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import { ImprovementProposalService } from './improvement-proposal.service';
import type {
  BulkApproveProposalOutcome,
  BulkRejectProposalOutcome,
  SubmitProposalResult,
} from './improvement-proposal.service.types';
import { UI_OPERATOR_PROVENANCE_SOURCE } from './improvement-proposal-provenance.constants';
import { SkillScopeConfirmationService } from './skill-scope-confirmation.service';

const proposalIdSchema = z.uuid();

/**
 * A human operator's explicit "assign skill" choice carries no
 * `struggle_backed`/`inference` evidence signal of its own. `inference` is
 * the closest fit for the required `evidence.evidenceClass` field, and
 * `ImprovementGovernancePolicyService` exempts anything carrying
 * `provenance.source === UI_OPERATOR_PROVENANCE_SOURCE` from that class's
 * confidence cap (see `decideGovernanceAction`), so the maximal confidence
 * here is never downgraded and the normal `skill_assignment` tier decides
 * (auto-applies under `tiered`, the default governance mode).
 */
const UI_OPERATOR_SKILL_ASSIGNMENT_EVIDENCE_CLASS = 'inference' as const;
const UI_OPERATOR_SKILL_ASSIGNMENT_CONFIDENCE = 1;

@ApiTags('improvement-proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('improvement/proposals')
export class ImprovementProposalsController {
  constructor(
    private readonly improvementProposalService: ImprovementProposalService,
    private readonly skillScopeConfirmation: SkillScopeConfirmationService,
  ) {}

  @Get()
  @RequirePermission('improvements:read')
  @ApiOperation({ summary: 'List improvement proposals' })
  async list(
    @ZodQuery(listImprovementProposalsSchema)
    query: ListImprovementProposalsRequest,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<ImprovementProposalService['list']>>;
  }> {
    const data = await this.improvementProposalService.list({
      kinds: query.kind,
      statuses: query.status,
      page: query.page,
      limit: query.limit,
    });
    return { success: true, data };
  }

  @Post()
  @RequirePermission('improvements:manage')
  @ApiOperation({
    summary:
      'Create an operator-directed skill_assignment improvement proposal',
  })
  async create(
    @ZodBody(createSkillAssignmentProposalSchema)
    body: CreateSkillAssignmentProposalRequest,
  ): Promise<{
    success: true;
    outcome: SubmitProposalResult['outcome'];
    data: ImprovementProposal | null;
  }> {
    const result = await this.improvementProposalService.submitProposal({
      kind: 'skill_assignment',
      payload: {
        skillName: body.skillName,
        assignment_targets: body.targets,
        ...(body.rationale ? { rationale: body.rationale } : {}),
      },
      evidence: { evidenceClass: UI_OPERATOR_SKILL_ASSIGNMENT_EVIDENCE_CLASS },
      confidence: UI_OPERATOR_SKILL_ASSIGNMENT_CONFIDENCE,
      provenance: { source: UI_OPERATOR_PROVENANCE_SOURCE },
    });
    return { success: true, outcome: result.outcome, data: result.proposal };
  }

  @Get(':id')
  @RequirePermission('improvements:read')
  @ApiOperation({ summary: 'Get an improvement proposal by id' })
  async get(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true; data: ImprovementProposal }> {
    const proposal = await this.improvementProposalService.getById(id);
    return { success: true, data: proposal };
  }

  @Post(':id/approve')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Approve an improvement proposal' })
  async approve(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true; data: ImprovementProposal }> {
    const data = await this.improvementProposalService.approve(id);
    return { success: true, data };
  }

  @Post(':id/reject')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Reject an improvement proposal' })
  async reject(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true; data: ImprovementProposal }> {
    const data = await this.improvementProposalService.reject(id);
    return { success: true, data };
  }

  @Post('bulk-approve')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Bulk approve improvement proposals' })
  async bulkApprove(
    @ZodBody(bulkApproveImprovementProposalsSchema)
    body: BulkApproveImprovementProposalsRequest,
  ): Promise<{ success: true; data: BulkApproveProposalOutcome[] }> {
    const data = await this.improvementProposalService.bulkApprove(
      body.proposal_ids,
    );
    return { success: true, data };
  }

  @Post('bulk-reject')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Bulk reject improvement proposals' })
  async bulkReject(
    @ZodBody(bulkRejectImprovementProposalsSchema)
    body: BulkRejectImprovementProposalsRequest,
  ): Promise<{ success: true; data: BulkRejectProposalOutcome[] }> {
    const data = await this.improvementProposalService.bulkReject(
      body.proposal_ids,
      body.reason,
    );
    return { success: true, data };
  }

  @Post(':id/rollback')
  @RequirePermission('improvements:manage')
  @ApiOperation({ summary: 'Roll back an applied improvement proposal' })
  async rollback(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true; data: ImprovementProposal }> {
    const data = await this.improvementProposalService.rollback(id);
    return { success: true, data };
  }

  @Post(':id/scope/confirm')
  @RequirePermission('improvements:manage')
  @ApiOperation({
    summary: "Confirm a skill_create proposal's recommended scope widening",
  })
  async confirmScope(
    @ZodParam('id', proposalIdSchema) id: string,
    @Req() req: { user: JwtUser },
  ): Promise<{ success: true; confirmed: boolean; reason?: string }> {
    const result = await this.skillScopeConfirmation.confirm(
      id,
      req.user.userId,
    );
    return { success: true, ...result };
  }

  @Post(':id/scope/reject')
  @RequirePermission('improvements:manage')
  @ApiOperation({
    summary: "Reject a skill_create proposal's recommended scope widening",
  })
  async rejectScope(
    @ZodParam('id', proposalIdSchema) id: string,
  ): Promise<{ success: true }> {
    await this.skillScopeConfirmation.reject(id);
    return { success: true };
  }
}
