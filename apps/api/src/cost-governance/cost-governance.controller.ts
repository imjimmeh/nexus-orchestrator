import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BudgetPolicyService } from './budget-policy.service';
import { BudgetDecisionService } from './budget-decision.service';
import { BudgetUsageEventRepository } from './database/repositories/budget-usage-event.repository';
import { BudgetDecisionEventRepository } from './database/repositories/budget-decision-event.repository';
import { BudgetPolicyRepository } from './database/repositories/budget-policy.repository';
import {
  createBudgetPolicySchema,
  updateBudgetPolicySchema,
} from './dto/budget-policy.dto';
import type {
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
} from './dto/budget-policy.dto.types';
import {
  evaluateActionSchema,
  recordUsageEventSchema,
  budgetQuerySchema,
  budgetSummarySchema,
} from './dto/budget-query.dto';
import type {
  EvaluateActionDto,
  RecordUsageEventDto,
  BudgetQueryDto,
  BudgetSummaryDto,
} from './dto/budget-query.dto.types';

interface AuthedRequest {
  user: { userId: string };
}

@ApiTags('cost-governance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('cost-governance')
export class CostGovernanceController {
  constructor(
    private readonly policyService: BudgetPolicyService,
    private readonly decisionService: BudgetDecisionService,
    private readonly usageRepo: BudgetUsageEventRepository,
    private readonly decisionRepo: BudgetDecisionEventRepository,
    private readonly policyRepo: BudgetPolicyRepository,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  @Post('policies')
  @RequirePermission('budgets:manage')
  createPolicy(
    @Body(new ZodValidationPipe(createBudgetPolicySchema))
    body: CreateBudgetPolicyDto,
  ) {
    return this.policyService.create(body);
  }

  @Get('policies')
  @RequirePermission('budgets:read')
  async listPolicies(
    @Query('scopeNodeId') scopeNodeId: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    // Only scope_type === 'scope' policies reference the multi-tenant scope
    // node hierarchy; other scope_types (global/context/workflow_definition/
    // agent_profile) are not scope-node-partitioned and remain visible,
    // matching the "platform/NULL stays visible" pattern used elsewhere.
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'budgets:read',
      scopeNodeId,
    );
    return this.policyService.listAll(scopeIds);
  }

  @Get('policies/:id')
  @RequirePermission('budgets:read')
  getPolicy(@Param('id') id: string) {
    return this.policyService.getById(id);
  }

  @Patch('policies/:id')
  @RequirePermission('budgets:manage')
  updatePolicy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBudgetPolicySchema))
    body: UpdateBudgetPolicyDto,
  ) {
    return this.policyService.update(id, body);
  }

  @Delete('policies/:id')
  @RequirePermission('budgets:manage')
  disablePolicy(@Param('id') id: string) {
    return this.policyService.disable(id);
  }

  @Post('evaluate')
  @RequirePermission('budgets:read')
  evaluateAction(
    @Body(new ZodValidationPipe(evaluateActionSchema)) body: EvaluateActionDto,
  ) {
    return this.decisionService.evaluateAction({
      scopeId: body.scope_id,
      contextType: body.context_type,
      contextId: body.context_id,
      actionType: body.action_type,
      actorType: body.actor_type,
      actorId: body.actor_id,
      providerName: body.provider_name,
      modelName: body.model_name,
      expectedTokens: body.expected_tokens,
      correlationId: body.correlation_id,
    });
  }

  @Post('usage')
  @RequirePermission('budgets:manage')
  recordUsage(
    @Body(new ZodValidationPipe(recordUsageEventSchema))
    body: RecordUsageEventDto,
  ) {
    return this.usageRepo.recordUsage(body);
  }

  @Get('usage')
  @RequirePermission('budgets:read')
  async queryUsage(
    @Query(new ZodValidationPipe(budgetQuerySchema)) query: BudgetQueryDto,
  ) {
    const [data, total] = await Promise.all([
      this.usageRepo.queryEvents({
        scopeId: query.scope_id,
        contextType: query.context_type,
        contextId: query.context_id,
        providerName: query.provider_name,
        modelName: query.model_name,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.limit,
        offset: query.offset,
      }),
      this.usageRepo.countEvents({
        scopeId: query.scope_id,
        contextType: query.context_type,
        contextId: query.context_id,
        providerName: query.provider_name,
        modelName: query.model_name,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      }),
    ]);

    return { success: true, data, total };
  }

  @Get('summary/timeline')
  @RequirePermission('budgets:read')
  async getTimeline(
    @Query(new ZodValidationPipe(budgetSummarySchema)) query: BudgetSummaryDto,
  ) {
    const rows = await this.usageRepo.getTimeline({
      scopeId: query.scope_id,
      window: query.window,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    return { success: true, data: rows };
  }

  @Get('summary')
  @RequirePermission('budgets:read')
  async getSummary(
    @Query(new ZodValidationPipe(budgetSummarySchema)) query: BudgetSummaryDto,
  ) {
    const rows = await this.usageRepo.getSummary({
      scopeId: query.scope_id,
      groupBy: query.group_by,
      window: query.window,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });

    return { success: true, data: rows };
  }

  @Get('decisions')
  @RequirePermission('budgets:read')
  queryDecisions(
    @Query(new ZodValidationPipe(budgetQuerySchema)) query: BudgetQueryDto,
  ) {
    return this.decisionRepo.findByContext(
      query.context_type ?? '',
      query.context_id ?? '',
      query.limit,
      query.offset,
    );
  }
}
