import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { WorkflowSkillBindingsModule } from '../workflow/workflow-skill-bindings/workflow-skill-bindings.module';
import { PromotedLessonsService } from './promoted-lessons.service';
import { SelfImprovementController } from './self-improvement.controller';

/**
 * `SelfImprovementModule` — apps/web control plane read surface for
 * the improvement pipeline (`GET /self-improvement/promoted-lessons`).
 *
 * `PromotedLessonsService` is a thin aggregator that fans out to four
 * already-registered repositories (no module-internal repositories):
 *   - `MemorySegmentLearningCandidateRepository` (from `DatabaseModule`,
 *     for the promoted-segment listing)
 *   - `LearningCandidateRepository` (from `DatabaseModule`, for the
 *     per-segment candidate detail row)
 *   - `RuntimeFeedbackSignalGroupRepository` (from `DatabaseModule`,
 *     for the candidate -> source signal group pointer)
 *   - `WorkflowSkillBindingRepository` (from `DatabaseModule`, for the
 *     active binding listing)
 *   - `ImprovementProposalRepository` (from `DatabaseModule`, for the
 *     per-binding `reuseCount7d` count)
 * The two cross-module dependencies are:
 *   - `AuthModule` — for `JwtAuthGuard`.
 *   - `AuthorizationModule` — for `PermissionsGuard` + the
 *     `improvements:read` permission check.
 *   - `WorkflowSkillBindingsModule` — kept consistent with
 *     `ImprovementModule`'s edge (no `forwardRef`, per
 *     `apps/AGENTS.md` cycle table — `WorkflowSkillBindingsModule`
 *     does not transitively depend on `SelfImprovementModule`).
 *
 * The service is exported for future sub-modules that may want to
 * reuse the same read pipeline (e.g. a follow-on card).
 */
@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    WorkflowSkillBindingsModule,
  ],
  controllers: [SelfImprovementController],
  providers: [PromotedLessonsService],
  exports: [PromotedLessonsService],
})
export class SelfImprovementModule {}
