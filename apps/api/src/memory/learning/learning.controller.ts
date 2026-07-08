import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  archiveLearningCandidateSchema,
  bulkArchiveLearningCandidatesSchema,
  bulkPromoteLearningCandidatesSchema,
  bulkRejectLearningCandidatesSchema,
  listLearningCandidatesSchema,
  promoteLearningCandidateSchema,
  rejectLearningCandidateSchema,
} from '@nexus/core';
import type {
  ArchiveLearningCandidateRequest,
  BulkArchiveLearningCandidatesRequest,
  BulkPromoteLearningCandidatesRequest,
  BulkRejectLearningCandidatesRequest,
  ListLearningCandidatesRequest,
  PromoteLearningCandidateRequest,
  RejectLearningCandidateRequest,
} from '@nexus/core';
import { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodParam } from '../../common/decorators/zod-param.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { LearningCandidateDecisionService } from './learning-candidate-decision.service';
import { LearningPromotionService } from './learning-promotion.service';
import { LearningService } from './learning.service';

const candidateIdSchema = z.uuid();

type ListLearningCandidatesDto = ListLearningCandidatesRequest;
type PromoteLearningCandidateDto = PromoteLearningCandidateRequest;
type RejectLearningCandidateDto = RejectLearningCandidateRequest;
type ArchiveLearningCandidateDto = ArchiveLearningCandidateRequest;
type BulkRejectLearningCandidatesDto = BulkRejectLearningCandidatesRequest;
type BulkArchiveLearningCandidatesDto = BulkArchiveLearningCandidatesRequest;
type BulkPromoteLearningCandidatesDto = BulkPromoteLearningCandidatesRequest;
type LearningPromotionSparseResponse = Pick<
  Awaited<ReturnType<LearningPromotionService['promoteCandidate']>>,
  'candidate_id' | 'memory_segment_id' | 'status' | 'policy_decision'
>;
type BulkPromoteResultItem = {
  candidateId: string;
  result?: LearningPromotionSparseResponse;
  error?: string;
};

function sparsifyPromotionResult(
  result: LearningPromotionSparseResponse,
): LearningPromotionSparseResponse {
  return {
    candidate_id: result.candidate_id,
    memory_segment_id: result.memory_segment_id,
    status: result.status,
    policy_decision: result.policy_decision,
  };
}

@ApiTags('memory-learning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('memory/learning')
export class LearningController {
  constructor(
    private readonly learningService: LearningService,
    private readonly learningPromotionService: LearningPromotionService,
    private readonly candidateDecisionService: LearningCandidateDecisionService,
  ) {}

  @Get('status')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'Get learning status' })
  async getStatus(): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningService['getStatus']>>;
  }> {
    const data = await this.learningService.getStatus();
    return {
      success: true,
      data,
    };
  }

  @Post('run')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Run manual learning sweep' })
  async runManualSweep(): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningService['runManualSweep']>>;
  }> {
    const data = await this.learningService.runManualSweep();
    return {
      success: true,
      data,
    };
  }

  @Get('candidates')
  @RequirePermission('memory:read')
  @ApiOperation({ summary: 'List learning candidates' })
  async listCandidates(
    @ZodQuery(listLearningCandidatesSchema)
    query: ListLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningService['listCandidates']>>;
  }> {
    const data = await this.learningService.listCandidates(query);
    return {
      success: true,
      data,
    };
  }

  @Post('promote')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Promote a learning candidate into memory' })
  async promote(
    @ZodBody(promoteLearningCandidateSchema)
    body: PromoteLearningCandidateDto,
  ): Promise<{
    success: true;
    data: LearningPromotionSparseResponse;
  }> {
    const result = await this.learningPromotionService.promoteCandidate(
      body.candidate_id,
      { requestedBy: body.requested_by },
    );

    return {
      success: true,
      data: sparsifyPromotionResult(result),
    };
  }

  @Post('candidates/:id/reject')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Reject a learning candidate' })
  async reject(
    @ZodParam('id', candidateIdSchema) id: string,
    @ZodBody(rejectLearningCandidateSchema) body: RejectLearningCandidateDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService['reject']>>;
  }> {
    const data = await this.candidateDecisionService.reject(id, body);
    return { success: true, data };
  }

  @Post('candidates/:id/archive')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Archive a learning candidate' })
  async archive(
    @ZodParam('id', candidateIdSchema) id: string,
    @ZodBody(archiveLearningCandidateSchema) body: ArchiveLearningCandidateDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService['archive']>>;
  }> {
    const data = await this.candidateDecisionService.archive(id, body);
    return { success: true, data };
  }

  @Post('candidates/bulk-reject')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Bulk reject learning candidates' })
  async bulkReject(
    @ZodBody(bulkRejectLearningCandidatesSchema)
    body: BulkRejectLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService['bulkReject']>>;
  }> {
    const data = await this.candidateDecisionService.bulkReject(body);
    return { success: true, data };
  }

  @Post('candidates/bulk-archive')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Bulk archive learning candidates' })
  async bulkArchive(
    @ZodBody(bulkArchiveLearningCandidatesSchema)
    body: BulkArchiveLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: Awaited<ReturnType<LearningCandidateDecisionService['bulkArchive']>>;
  }> {
    const data = await this.candidateDecisionService.bulkArchive(body);
    return { success: true, data };
  }

  @Post('candidates/bulk-promote')
  @RequirePermission('memory:manage')
  @ApiOperation({ summary: 'Bulk promote learning candidates' })
  async bulkPromote(
    @ZodBody(bulkPromoteLearningCandidatesSchema)
    body: BulkPromoteLearningCandidatesDto,
  ): Promise<{
    success: true;
    data: BulkPromoteResultItem[];
  }> {
    const results = await this.learningPromotionService.bulkPromote(
      body.candidate_ids,
      { requestedBy: body.requested_by },
    );
    const data: BulkPromoteResultItem[] = results.map((item) => ({
      candidateId: item.candidateId,
      result: item.result ? sparsifyPromotionResult(item.result) : undefined,
      error: item.error,
    }));

    return { success: true, data };
  }
}
