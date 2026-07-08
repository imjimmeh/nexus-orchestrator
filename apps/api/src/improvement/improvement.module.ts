import { forwardRef, Module } from '@nestjs/common';
import { AiConfigModule } from '../ai-config/ai-config.module';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { ConfigResolutionModule } from '../config-resolution/config-resolution.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { RedisModule } from '../redis/redis.module';
import { ScopeModule } from '../scope/scope.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { WorkflowCoreModule } from '../workflow/workflow-core.module';
import { WorkflowSkillBindingsModule } from '../workflow/workflow-skill-bindings/workflow-skill-bindings.module';
import { WorkflowSkillBindingService } from '../workflow/workflow-skill-bindings/workflow-skill-binding.service';
import { ImprovementProposalsController } from './improvement-proposals.controller';
import { ImprovementProposalService } from './improvement-proposal.service';
import { ImprovementGovernancePolicyService } from './governance/improvement-governance-policy.service';
import { ImprovementApplierRegistry } from './appliers/improvement-applier.registry';
import { SkillCreateApplier } from './appliers/skill-create.applier';
import { SkillAssignmentApplier } from './appliers/skill-assignment.applier';
import { AgentProfileChangeApplier } from './appliers/agent-profile-change.applier';
import { WorkflowDefinitionChangeApplier } from './appliers/workflow-definition-change.applier';
import { CodeChangeApplier } from './appliers/code-change.applier';
import { SkillCreateCompletionListener } from './skill-create-completion.listener';
import { IMPROVEMENT_APPLIERS } from './appliers/improvement-applier.types';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import { ImprovementTaskEventPublisher } from './improvement-task-event.publisher';
import { CodeChangeDedupService } from './code-change-dedup.service';
import { CodeChangeProposalIntakeService } from './code-change-proposal-intake.service';
import { SkillScopeConfirmationService } from './skill-scope-confirmation.service';

/**
 * `ImprovementModule` — Epic A REST + DI surface for the self-improvement
 * pipeline's proposal lifecycle (submit → govern → approve/reject → apply →
 * rollback).
 *
 * `ImprovementProposalRepository` is not declared as a local provider: it is
 * one of `DatabaseModule`'s centrally-registered repositories (bound against
 * the shared `TypeOrmModule.forFeature(entities)` registration there), so
 * this module only needs to import `DatabaseModule` to inject it.
 *
 * `SkillCreateCompletionListener` applies Epic B `assignment_targets` via
 * `WorkflowSkillBindingService`, so this module imports
 * `WorkflowSkillBindingsModule` for that DI edge. It also validates
 * `provenance.scope_id` against `ScopeService.isLiveScope` before applying
 * the origin scope or feeding it into the auto-apply clamp, so this module
 * imports `ScopeModule` (only depends on `AuthModule`/`AuthorizationModule`,
 * both already imported above, so no circularity).
 *
 * `SkillCreateApplier` depends on the concrete `WorkflowEngineService` to
 * dispatch the `create_skill` materialization workflow, so this module
 * imports `WorkflowCoreModule` (mirroring `LearningModule`, whose
 * `SkillProposalService`/listeners have the same dependency) — wrapped in
 * `forwardRef` because `WorkflowRetrospectiveModule` (whose
 * `RetrospectiveOutputRouter` injects `ImprovementProposalService`) sits
 * downstream of `WorkflowCoreModule` in the module graph
 * (`WorkflowCoreModule -> SessionModule -> MemoryModule -> ... ->
 * WorkflowRetrospectiveModule -> ImprovementModule -> WorkflowCoreModule`);
 * without the `forwardRef` on both edges, Nest's circular static import
 * resolution leaves one of the module classes `undefined` at bootstrap.
 *
 * `SkillAssignmentApplier` (Epic B, standalone `skill_assignment` proposal
 * kind — binding an ALREADY-EXISTING skill to new targets) is built via a
 * `useFactory` provider rather than plain constructor injection: its
 * `skills`/`bindings` params are narrow by-name gateways adapted from the
 * concrete `AgentSkillsService`/`WorkflowSkillBindingService`, so the
 * factory is the one place that wiring lives (see the provider below).
 *
 * `WorkflowDefinitionChangeApplier` (Epic D, `workflow_definition_change`)
 * reuses `WorkflowRepositoryAggregator`/`WorkflowParserService`/
 * `WorkflowValidationService`/`WORKFLOW_PERSISTENCE_SERVICE` — all exported
 * by `WorkflowCoreModule`, already imported above for `SkillCreateApplier` —
 * plus an `@Optional()` `ConfigResolutionCache` for cache invalidation after
 * a successful apply/rollback. `WorkflowCoreModule` does NOT re-export
 * `ConfigResolutionCache` (it only imports `ConfigResolutionModule` for its
 * own internal use), so this module imports `ConfigResolutionModule`
 * directly for that DI edge.
 *
 * `ImprovementTaskEventPublisher` (Epic E) appends neutral
 * `improvement.task.requested.v1` envelopes onto the shared core lifecycle
 * Redis stream — the same stream `WorkflowCoreLifecycleStreamPublisher`
 * writes to — so this module imports `RedisModule` for the
 * `RedisStreamService` DI edge.
 *
 * `CodeChangeApplier` (Epic E, `code_change`) only depends on
 * `ImprovementTaskEventPublisher` and `EventLedgerService` — both already
 * wired above (`RedisModule`, `ObservabilityModule`) — so it needs no
 * additional module import.
 *
 * `CodeChangeDedupService` (Epic E) only needs `ImprovementProposalRepository`
 * — it deliberately does not inject `CANDIDATE_SIMILARITY`/
 * `EmbeddingSimilarityService` (see that service's doc comment: the shared
 * service's RRF-fused score can never cross the configured similarity
 * threshold, so wiring it in would be dead weight), so this module has no DI
 * edge to `MemorySignalsModule`. `CodeChangeProposalIntakeService` wraps
 * `CodeChangeDedupService` plus `submitProposal` as the mandatory entry point
 * for `code_change` producers (Epic D), so it is exported alongside
 * `ImprovementProposalService`.
 */
@Module({
  imports: [
    AiConfigModule,
    AuthModule,
    AuthorizationModule,
    ConfigResolutionModule,
    DatabaseModule,
    ObservabilityModule,
    RedisModule,
    ScopeModule,
    SystemSettingsModule,
    WorkflowSkillBindingsModule,
    forwardRef(() => WorkflowCoreModule),
  ],
  controllers: [ImprovementProposalsController],
  providers: [
    ImprovementProposalService,
    ImprovementGovernancePolicyService,
    ImprovementApplierRegistry,
    ImprovementTaskEventPublisher,
    CodeChangeDedupService,
    CodeChangeProposalIntakeService,
    SkillCreateApplier,
    AgentProfileChangeApplier,
    WorkflowDefinitionChangeApplier,
    CodeChangeApplier,
    SkillCreateCompletionListener,
    SkillScopeConfirmationService,
    {
      // SkillAssignmentApplier's `skills`/`bindings` constructor params are
      // narrow by-name gateways (see skill-assignment.types.ts), not the
      // concrete AgentSkillsService/WorkflowSkillBindingService — those
      // services key profile mutations off `profileId`, while an
      // `assignment_targets` entry only carries a `profileName`. This
      // factory adapts the concrete services to that gateway shape, the
      // same adapter-object-literal approach SkillCreateCompletionListener
      // uses inline for the create-flow's add-only path.
      provide: SkillAssignmentApplier,
      useFactory: (
        skillsService: AgentSkillsService,
        bindings: WorkflowSkillBindingService,
        proposals: ImprovementProposalRepository,
        profileSkillBindings: AgentProfileSkillBindingService,
      ) =>
        new SkillAssignmentApplier(
          {
            skillExists: (name) => skillsService.skillExists(name),
            addProfileSkills: async (profileName, skillNames) => {
              await skillsService.addProfileSkillsByProfileName(
                profileName,
                skillNames,
              );
            },
            addScopedProfileSkill: async (input) => {
              await profileSkillBindings.addProfileScopedBinding({
                skillName: input.skillName,
                scopeNodeId: input.scopeNodeId,
                profileName: input.profileName,
              });
            },
            removeProfileSkills: async (profileName, skillNames) => {
              await skillsService.removeProfileSkillsByProfileName(
                profileName,
                skillNames,
              );
            },
          },
          {
            addBinding: (input) => bindings.addBinding(input),
            removeBinding: (input) => bindings.removeBinding(input),
          },
          proposals,
        ),
      inject: [
        AgentSkillsService,
        WorkflowSkillBindingService,
        ImprovementProposalRepository,
        AgentProfileSkillBindingService,
      ],
    },
    {
      provide: IMPROVEMENT_APPLIERS,
      useFactory: (
        skillCreateApplier: SkillCreateApplier,
        skillAssignmentApplier: SkillAssignmentApplier,
        agentProfileChangeApplier: AgentProfileChangeApplier,
        workflowDefinitionChangeApplier: WorkflowDefinitionChangeApplier,
        codeChangeApplier: CodeChangeApplier,
      ) => [
        skillCreateApplier,
        skillAssignmentApplier,
        agentProfileChangeApplier,
        workflowDefinitionChangeApplier,
        codeChangeApplier,
      ],
      inject: [
        SkillCreateApplier,
        SkillAssignmentApplier,
        AgentProfileChangeApplier,
        WorkflowDefinitionChangeApplier,
        CodeChangeApplier,
      ],
    },
  ],
  exports: [ImprovementProposalService, CodeChangeProposalIntakeService],
})
export class ImprovementModule {}
