/**
 * REST surface for the apps/web control plane's self-improvement
 * cards: `GET /self-improvement/promoted-lessons` is the single
 * endpoint that powers both `PromotedLessonsCard` and
 * `SkillBindingUsageCard`.
 *
 * --------------------------------------------------------------------
 * Task 3.1 / Milestone 1 — permission + mostSpecificSource rationale
 * --------------------------------------------------------------------
 *
 * 1. `improvements:read` is reused here INSTEAD of the spec's
 *    `self_improvement:read` because `permission-catalog.ts` does not
 *    have a `self_improvement` resource. The catalog is generated
 *    from `RESOURCES = [ 'scopes', 'resources', 'workflows', 'agents',
 *    'skills', 'approvals', 'goals', 'memory', 'secrets', 'budgets',
 *    'roles', 'users', 'settings', 'gitops', 'audit', 'improvements' ]`
 *    (see `apps/api/src/auth/authorization/permission-catalog.ts`).
 *    Adding a new `self_improvement` resource would require a catalog
 *    migration + a role/role-binding re-evaluation; reusing
 *    `improvements:read` keeps the slice scope-bounded to the
 *    existing operator-facing role grants. The same role that can
 *    list improvement proposals via `GET /improvement/proposals` can
 *    see the control plane summary.
 *
 * 2. `'profile'` is intentionally OMITTED from `mostSpecificSource`
 *    because `workflow_skill_bindings` does NOT represent profile
 *    scope — that table stores workflow- and step-scoped runtime
 *    bindings only. Profile-scoped skill assignments live on the
 *    agent profile / skill binding table and surface via
 *    `resolveAgentAssignedSkills` (the `profileSkills` bucket in
 *    `effective-skills.types.ts`). The full source taxonomy is
 *    `step | workflow | profile` (most specific first); this route
 *    only surfaces the two scopes the binding table can represent.
 *    See `apps/api/src/workflow/agent-prompt/effective-skills.types.ts`.
 *
 * --------------------------------------------------------------------
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import {
  type PromotedLessonsQuery,
  type PromotedLessonsResponse,
  promotedLessonsQuerySchema,
} from './promoted-lessons.service.types';
import { PromotedLessonsService } from './promoted-lessons.service';

@ApiTags('self-improvement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('self-improvement')
export class SelfImprovementController {
  constructor(
    private readonly promotedLessonsService: PromotedLessonsService,
  ) {}

  @Get('promoted-lessons')
  @RequirePermission('improvements:read')
  @ApiOperation({
    summary:
      'List promoted learning candidates + active workflow skill bindings for the control plane',
  })
  async getPromotedLessons(
    @ZodQuery(promotedLessonsQuerySchema) query: PromotedLessonsQuery,
  ): Promise<{ success: true; data: PromotedLessonsResponse }> {
    const data = await this.promotedLessonsService.getPromotedLessons(query);
    return { success: true, data };
  }
}
