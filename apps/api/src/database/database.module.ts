import { Module, Logger, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentSkillAssignmentsSeedService } from './seeds/agent/agent-skill-assignments.seed';
import {
  AgentProfilesFileSeedService,
  AgentProfileSeedService,
  AgentProfileSkillAssignmentResolverService,
} from './seeds/agent-profiles';
import { LlmModelSeedService } from './seeds/agent/llm-models.seed';
import { LlmProviderSeedService } from './seeds/agent/llm-providers.seed';
import { LlmSecretSeedService } from './seeds/security/llm-secret.seed';
import { RoleSeedService } from './seeds/authorization/roles.seed';
import { SkillSeedService } from './seeds/skills.seed';
import { SkillDependencyResolverService } from './seeds/skills';
import { SkillValidationService } from '../ai-config/skills/skill-validation.service';
import { SetupConfigSeedService } from './seeds/system/setup-config.seed';
import { StartupSeedService } from './seeds/startup-seed.service';
import { ToolApprovalRulesSeedService } from './seeds/tool/tool-approval-rules.seed';
import { WorkflowSeedService } from './seeds/workflow/workflows.seed';
import { ScopedVariableSeedService } from './seeds/variables/scoped-variables.seed';
import { Workflow } from '../workflow/database/entities/workflow.entity';
import { WorkflowLifecycleResult } from '../workflow/database/entities/workflow-lifecycle-result.entity';
import { WorkflowRun } from '../workflow/database/entities/workflow-run.entity';
import { ScheduledJob } from '../automation/database/entities/scheduled-job.entity';
import { ScheduledJobRun } from '../automation/database/entities/scheduled-job-run.entity';
import { WorkflowLaunchPreset } from '../workflow/database/entities/workflow-launch-preset.entity';
import { ToolRegistry } from '../tool/database/entities/tool-registry.entity';
import { PiSessionTree } from '../runtime/database/entities/pi-session-tree.entity';
import { PluginRegistryEntry } from '../plugin-kernel/database/entities/plugin-registry-entry.entity';
import { PluginEventDelivery } from '../plugin-kernel/database/entities/plugin-event-delivery.entity';
import { MemoryEmbedding } from '../memory/database/entities/memory-embedding.entity';
import { RetrospectiveQueue } from '../workflow/workflow-retrospective/database/entities/retrospective-queue.entity';
import { MemorySegment } from '../memory/database/entities/memory-segment.entity';
import { MemorySegmentFeedback } from '../memory/database/entities/memory-segment-feedback.entity';
import { LearningMeasurementSnapshot } from '../memory/learning/learning-convergence/database/entities/learning-measurement-snapshot.entity';
import { MemoryRetentionPolicy } from '../memory/learning/learning-convergence/database/entities/memory-retention-policy.entity';
import { SignalWeightHistory } from '../memory/database/entities/signal-weight-history.entity';
import { SubagentDetails } from '../workflow/database/entities/subagent-details.entity';
import { DelegationContract } from '../workflow/database/entities/delegation-contract.entity';
import { AuditLog } from '../audit/database/entities/audit-log.entity';
import { CostTracking } from '../system/database/entities/cost-tracking.entity';
import { SecretStore } from '../security/database/entities/secret-store.entity';
import { LlmProvider } from '../ai-config/database/entities/llm-provider.entity';
import { LlmModel } from '../ai-config/database/entities/llm-model.entity';
import { ProviderOAuthSession } from '../ai-config/database/entities/provider-oauth-session.entity';
import { ProviderCooldown } from '../ai-config/database/entities/provider-cooldown.entity';
import { FallbackChainEntity } from '../ai-config/database/entities/fallback-chain.entity';
import { McpServer } from '../mcp/database/entities/mcp-server.entity';
import { AcpServer } from '../acp/database/entities/acp-server.entity';
import { AcpDiscoveredAgent } from '../acp/database/entities/acp-discovered-agent.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { AgentSkill } from '../ai-config/database/entities/agent-skill.entity';
import { AgentProfileSkill } from '../ai-config/database/entities/agent-profile-skill.entity';
import { AgentProfileSkillBinding } from '../ai-config/database/entities/agent-profile-skill-binding.entity';
import { Skill } from '../ai-config/database/entities/skill.entity';
import { LearningCandidate } from '../memory/database/entities/learning-candidate.entity';
import { RuntimeFeedbackSignalGroup } from '../runtime/database/entities/runtime-feedback-signal-group.entity';
import { User } from '../users/database/entities/user.entity';
import { Role } from '../auth/database/entities/role.entity';
import { UserRole } from '../auth/database/entities/user-role.entity';
import { RoleAssignment } from '../auth/database/entities/role-assignment.entity';
import { Invitation } from '../auth/invitations/database/entities/invitation.entity';
import { Permission } from '../auth/database/entities/permission.entity';
import { RolePermission } from '../auth/database/entities/role-permission.entity';
import { RefreshToken } from '../security/database/entities/refresh-token.entity';
import { OrchestrationSessionState } from '../workflow/database/entities/orchestration-session-state.entity';
import { OrchestrationDecisionLogArchive } from '../workflow/database/entities/orchestration-decision-log-archive.entity';
import { WorkflowRunTodo } from '../workflow/database/entities/workflow-run-todo.entity';
import { InceptionChatMessage } from '../chat/database/entities/inception-chat-message.entity';
import { SetupConfig } from '../system/database/entities/setup-config.entity';
import { SystemSetting } from '../system/database/entities/system-setting.entity';
import { WorkflowEvent } from '../workflow/database/entities/workflow-event.entity';
import { EventLedger } from '../runtime/database/entities/event-ledger.entity';
import { ToolArtifact } from '../tool/database/entities/tool-artifact.entity';
import { WebAutomationFailureArtifact } from '../web-automation/database/entities/web-automation-failure-artifact.entity';
import { ToolValidationRun } from '../tool/database/entities/tool-validation-run.entity';
import { AutomationHook } from '../automation/database/entities/automation-hook.entity';
import { HeartbeatProfile } from '../automation/database/entities/heartbeat-profile.entity';
import { HeartbeatRun } from '../automation/database/entities/heartbeat-run.entity';
import { StandingOrder } from '../automation/database/entities/standing-order.entity';
import { AgentCommunicationThread } from '../chat/database/entities/agent-communication-thread.entity';
import { AgentCommunicationMessage } from '../chat/database/entities/agent-communication-message.entity';
import { AgentWarRoomSession } from '../war-room/database/entities/agent-war-room-session.entity';
import { AgentWarRoomParticipant } from '../war-room/database/entities/agent-war-room-participant.entity';
import { AgentWarRoomMessage } from '../war-room/database/entities/agent-war-room-message.entity';
import { AgentWarRoomBlackboard } from '../war-room/database/entities/agent-war-room-blackboard.entity';
import { AgentWarRoomSignoff } from '../war-room/database/entities/agent-war-room-signoff.entity';
import { DoctorRepairHistory } from '../runtime/database/entities/doctor-repair-history.entity';
import { Notification } from '../notifications/database/entities/notification.entity';
import { ToolApprovalRule } from '../tool/database/entities/tool-approval-rule.entity';
import { ToolCallApprovalRequest } from '../tool/database/entities/tool-call-approval-request.entity';
import { UserChannelIdentity } from '../users/database/entities/user-channel-identity.entity';
import { ChatSession } from '../chat/database/entities/chat-session.entity';
import { ChatChannelRoute } from '../chat/database/entities/chat-channel-route.entity';
import { ChatMemoryEvent } from '../chat/database/entities/chat-memory-event.entity';
import { ChatMemoryJob } from '../chat/database/entities/chat-memory-job.entity';
import { ChatMemoryPromotionAudit } from '../chat/database/entities/chat-memory-promotion-audit.entity';
import { ChatProfileMemory } from '../chat/database/entities/chat-profile-memory.entity';
import { ChatMessage } from '../chat/database/entities/chat-message.entity';
import { ChatSessionParticipant } from '../chat/database/entities/chat-session-participant.entity';
import { ChatSessionMemory } from '../chat/database/entities/chat-session-memory.entity';
import { BudgetPolicy } from '../cost-governance/database/entities/budget-policy.entity';
import { BudgetUsageEvent } from '../cost-governance/database/entities/budget-usage-event.entity';
import { BudgetDecisionEvent } from '../cost-governance/database/entities/budget-decision-event.entity';
import { GitOpsRepositoryBinding } from '../gitops/database/entities/gitops-repository-binding.entity';
import { GitOpsReconcileRun } from '../gitops/database/entities/gitops-reconcile-run.entity';
import { GitOpsPendingChange } from '../gitops/database/entities/gitops-pending-change.entity';
import { DomainEventOutboxEntity } from '../domain-events/database/entities/domain-event-outbox.entity';
import { ScopeNode } from '../scope/database/entities/scope-node.entity';
import { ScopeNodeClosure } from '../scope/database/entities/scope-node-closure.entity';
import { HarnessDefinitionEntity } from '../harness/entities/harness-definition.entity.js';
import { HarnessCredentialBindingEntity } from '../harness/entities/harness-credential-binding.entity.js';
import { ScopedAiDefaultEntity } from '../harness/entities/scoped-ai-default.entity.js';
import { Attachment } from '../attachments/database/entities/attachment.entity';
import { AttachmentLink } from '../attachments/database/entities/attachment-link.entity';
import { ExecutionEntity } from '../execution-lifecycle/database/entities/execution.entity';
import { AgentAwaitEntity } from '../workflow/workflow-await/agent-await.entity';
import { UserQuestionAwait } from '../workflow/database/entities/user-question-await.entity';
import { StepSessionCheckpointEntity } from '../workflow/workflow-session-checkpoint/step-session-checkpoint.entity';
import { ScopedVariable } from '../variables/database/entities/scoped-variable.entity';
import { ScopedVariableAudit } from '../variables/database/entities/scoped-variable-audit.entity';

import { WorkflowEventRepository } from '../workflow/database/repositories/workflow-event.repository';
import { EventLedgerRepository } from '../runtime/database/repositories/event-ledger.repository';
import { AutomationHookRepository } from '../automation/database/repositories/automation-hook.repository';
import { HeartbeatProfileRepository } from '../automation/database/repositories/heartbeat-profile.repository';
import { HeartbeatRunRepository } from '../automation/database/repositories/heartbeat-run.repository';
import { StandingOrderRepository } from '../automation/database/repositories/standing-order.repository';
import { OrchestrationSessionStateRepository } from '../workflow/database/repositories/orchestration-session-state.repository';
import { OrchestrationDecisionLogArchiveRepository } from '../workflow/database/repositories/orchestration-decision-log-archive.repository';
import { WorkflowRunTodoRepository } from '../workflow/database/repositories/workflow-run-todo.repository';
import { WorkflowRepository } from '../workflow/database/repositories/workflow.repository';
import { WorkflowLifecycleResultRepository } from '../workflow/database/repositories/workflow-lifecycle-result.repository';
import { WorkflowRunRepository } from '../workflow/database/repositories/workflow-run.repository';
import { AgentAwaitRepository } from '../workflow/workflow-await/agent-await.repository';
import { StepSessionCheckpointRepository } from '../workflow/workflow-session-checkpoint/step-session-checkpoint.repository';
import { ScheduledJobRepository } from '../automation/database/repositories/scheduled-job.repository';
import { ScheduledJobRunRepository } from '../automation/database/repositories/scheduled-job-run.repository';
import { WorkflowLaunchPresetRepository } from '../workflow/database/repositories/workflow-launch-preset.repository';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { PluginRegistryEntryRepository } from '../plugin-kernel/database/repositories/plugin-registry-entry.repository';
import { PluginEventDeliveryRepository } from '../plugin-kernel/database/repositories/plugin-event-delivery.repository';
import { MemoryEmbeddingRepository } from '../memory/database/repositories/memory-embedding.repository';
import { MemorySegmentFeedbackRepository } from '../memory/database/repositories/memory-segment-feedback.repository';
import { LearningMeasurementSnapshotRepository } from '../memory/learning/learning-convergence/database/repositories/learning-measurement-snapshot.repository';
import { MemoryRetentionPolicyRepository } from '../memory/learning/learning-convergence/database/repositories/memory-retention-policy.repository';
import { MemorySegmentCrudRepository } from '../memory/database/repositories/memory-segment.crud.repository';
import { MemorySegmentSearchRepository } from '../memory/database/repositories/memory-segment.search.repository';
import { MemorySegmentLearningCandidateRepository } from '../memory/database/repositories/memory-segment.learning-candidate.repository';
import { MemorySegmentPostmortemRepository } from '../memory/database/repositories/memory-segment.postmortem.repository';
import { MemorySegmentDecayRepository } from '../memory/database/repositories/memory-segment.decay.repository';
import { MemorySegmentEvictionRepository } from '../memory/database/repositories/memory-segment.eviction.repository';
import { MemorySegmentDriftRepository } from '../memory/database/repositories/memory-segment.drift.repository';
import { MemorySegmentAggregationRepository } from '../memory/database/repositories/memory-segment.aggregation.repository';
import { SignalWeightHistoryRepository } from '../memory/database/repositories/signal-weight-history.repository';
import { SubagentDetailsRepository } from '../workflow/database/repositories/subagent-details.repository';
import { DelegationContractRepository } from '../workflow/database/repositories/delegation-contract.repository';
import { AuditLogRepository } from '../audit/database/repositories/audit-log.repository';
import { CostTrackingRepository } from '../system/database/repositories/cost-tracking.repository';
import { SecretStoreRepository } from '../security/database/repositories/secret-store.repository';
import { LlmProviderRepository } from '../ai-config/database/repositories/llm-provider.repository';
import { LlmModelRepository } from '../ai-config/database/repositories/llm-model.repository';
import { ProviderOAuthSessionRepository } from '../ai-config/database/repositories/provider-oauth-session.repository';
import { ProviderCooldownRepository } from '../ai-config/database/repositories/provider-cooldown.repository';
import { FallbackChainRepository } from '../ai-config/database/repositories/fallback-chain.repository';
import { McpServerRepository } from '../mcp/database/repositories/mcp-server.repository';
import { AcpServerRepository } from '../acp/database/repositories/acp-server.repository';
import { AcpDiscoveredAgentRepository } from '../acp/database/repositories/acp-discovered-agent.repository';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { AgentSkillRepository } from '../ai-config/database/repositories/agent-skill.repository';
import { AgentProfileSkillRepository } from '../ai-config/database/repositories/agent-profile-skill.repository';
import { AgentProfileSkillBindingRepository } from '../ai-config/database/repositories/agent-profile-skill-binding.repository';
import { LearningCandidateRepository } from '../memory/database/repositories/learning-candidate.repository';
import { RuntimeFeedbackSignalGroupRepository } from '../runtime/database/repositories/runtime-feedback-signal-group.repository';
import { UserRepository } from '../users/database/repositories/user.repository';
import { RoleRepository } from '../auth/database/repositories/role.repository';
import { UserRoleRepository } from '../auth/database/repositories/user-role.repository';
import { RefreshTokenRepository } from '../security/database/repositories/refresh-token.repository';
import { ToolArtifactRepository } from '../tool/database/repositories/tool-artifact.repository';
import { WebAutomationFailureArtifactRepository } from '../web-automation/database/repositories/web-automation-failure-artifact.repository';
import { ToolValidationRunRepository } from '../tool/database/repositories/tool-validation-run.repository';
import { AgentCommunicationThreadRepository } from '../chat/database/repositories/agent-communication-thread.repository';
import { AgentCommunicationMessageRepository } from '../chat/database/repositories/agent-communication-message.repository';
import { AgentWarRoomSessionRepository } from '../war-room/database/repositories/agent-war-room-session.repository';
import { AgentWarRoomParticipantRepository } from '../war-room/database/repositories/agent-war-room-participant.repository';
import { AgentWarRoomMessageRepository } from '../war-room/database/repositories/agent-war-room-message.repository';
import { AgentWarRoomBlackboardRepository } from '../war-room/database/repositories/agent-war-room-blackboard.repository';
import { AgentWarRoomSignoffRepository } from '../war-room/database/repositories/agent-war-room-signoff.repository';
import { DoctorRepairHistoryRepository } from '../runtime/database/repositories/doctor-repair-history.repository';
import { NotificationRepository } from '../notifications/database/repositories/notification.repository';
import { ToolApprovalRuleRepository } from '../tool/database/repositories/tool-approval-rule.repository';
import { ToolCallApprovalRequestRepository } from '../tool/database/repositories/tool-call-approval-request.repository';
import { UserChannelIdentityRepository } from '../users/database/repositories/user-channel-identity.repository';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { BudgetPolicyRepository } from '../cost-governance/database/repositories/budget-policy.repository';
import { BudgetUsageEventRepository } from '../cost-governance/database/repositories/budget-usage-event.repository';
import { BudgetDecisionEventRepository } from '../cost-governance/database/repositories/budget-decision-event.repository';
import { GitOpsRepositoryBindingRepository } from '../gitops/database/repositories/gitops-repository-binding.repository';
import { GitOpsReconcileRunRepository } from '../gitops/database/repositories/gitops-reconcile-run.repository';
import { GitOpsPendingChangeRepository } from '../gitops/database/repositories/gitops-pending-change.repository';
import { AttachmentRepository } from '../attachments/database/repositories/attachment.repository';
import { AttachmentLinkRepository } from '../attachments/database/repositories/attachment-link.repository';
import { UserQuestionAwaitRepository } from '../workflow/database/repositories/user-question-await.repository';
import { ScopedVariableRepository } from '../variables/database/repositories/scoped-variable.repository';
import { ScopedVariableAuditRepository } from '../variables/database/repositories/scoped-variable-audit.repository';
import { FallbackChainSeedService } from './seeds/config/fallback-chains.seed';

import { PullRequestTracking } from '../common/git/integration/pull-request-tracking.entity';
import { PullRequestTrackingRepository } from '../common/git/integration/pull-request-tracking.repository';
import { ImprovementProposal } from '../improvement/database/entities/improvement-proposal.entity';
import { ImprovementProposalRepository } from '../improvement/database/repositories/improvement-proposal.repository';
import { WorkflowSkillBinding } from '../workflow/workflow-skill-bindings/workflow-skill-binding.entity';
import { WorkflowSkillBindingRepository } from '../workflow/workflow-skill-bindings/workflow-skill-binding.repository';
import { registeredMigrations } from './migrations/registered-migrations';
import { WORKFLOW_RUN_LOOKUP_SERVICE } from '../shared/interfaces/workflow-run-lookup.interface';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { getApiTypeOrmLoggingOptions } from './typeorm-logging.config';

const entities = [
  Workflow,
  WorkflowLifecycleResult,
  WorkflowRun,
  ScheduledJob,
  ScheduledJobRun,
  WorkflowLaunchPreset,
  ToolRegistry,
  PiSessionTree,
  PluginRegistryEntry,
  PluginEventDelivery,
  MemoryEmbedding,
  RetrospectiveQueue,
  MemorySegment,
  MemorySegmentFeedback,
  // Daily convergence recorder entities (work item
  // 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1). One snapshot
  // row per recorder pass + a single-row policy table that owns the
  // latest usefulness threshold.
  LearningMeasurementSnapshot,
  MemoryRetentionPolicy,
  SignalWeightHistory,
  SubagentDetails,
  ExecutionEntity,
  DelegationContract,
  AuditLog,
  CostTracking,
  SecretStore,
  LlmProvider,
  LlmModel,
  ProviderOAuthSession,
  ProviderCooldown,
  FallbackChainEntity,
  McpServer,
  AcpServer,
  AcpDiscoveredAgent,
  AgentProfile,
  AgentSkill,
  AgentProfileSkill,
  Skill,
  LearningCandidate,
  RuntimeFeedbackSignalGroup,
  User,
  Role,
  UserRole,
  RoleAssignment,
  Permission,
  RolePermission,
  RefreshToken,
  Invitation,
  OrchestrationSessionState,
  OrchestrationDecisionLogArchive,
  WorkflowRunTodo,
  InceptionChatMessage,
  SetupConfig,
  SystemSetting,
  WorkflowEvent,
  EventLedger,
  AutomationHook,
  HeartbeatProfile,
  HeartbeatRun,
  StandingOrder,
  ToolArtifact,
  WebAutomationFailureArtifact,
  ToolValidationRun,
  AgentCommunicationThread,
  AgentCommunicationMessage,
  AgentWarRoomSession,
  AgentWarRoomParticipant,
  AgentWarRoomMessage,
  AgentWarRoomBlackboard,
  AgentWarRoomSignoff,
  DoctorRepairHistory,
  Notification,
  ToolApprovalRule,
  ToolCallApprovalRequest,
  UserChannelIdentity,
  ChatSession,
  ChatChannelRoute,
  ChatMemoryEvent,
  ChatMemoryJob,
  ChatMemoryPromotionAudit,
  ChatProfileMemory,
  ChatMessage,
  ChatSessionParticipant,
  ChatSessionMemory,
  BudgetPolicy,
  BudgetUsageEvent,
  BudgetDecisionEvent,
  GitOpsRepositoryBinding,
  GitOpsReconcileRun,
  GitOpsPendingChange,
  DomainEventOutboxEntity,
  ScopeNode,
  ScopeNodeClosure,
  HarnessDefinitionEntity,
  HarnessCredentialBindingEntity,
  ScopedAiDefaultEntity,
  Attachment,
  AttachmentLink,
  AgentAwaitEntity,
  UserQuestionAwait,
  StepSessionCheckpointEntity,
  ScopedVariable,
  ScopedVariableAudit,
  PullRequestTracking,
  ImprovementProposal,
  WorkflowSkillBinding,
  AgentProfileSkillBinding,
];
const repositories = [
  WorkflowRepository,
  WorkflowLifecycleResultRepository,
  WorkflowRunRepository,
  AgentAwaitRepository,
  ScheduledJobRepository,
  ScheduledJobRunRepository,
  WorkflowLaunchPresetRepository,
  ToolRegistryRepository,
  PiSessionTreeRepository,
  PluginRegistryEntryRepository,
  PluginEventDeliveryRepository,
  MemoryEmbeddingRepository,
  MemorySegmentFeedbackRepository,
  // Daily convergence recorder repositories (work item
  // 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1). Registered
  // alongside the sibling memory repositories so any future
  // recorder / operator-UI module can inject them via DatabaseModule.
  LearningMeasurementSnapshotRepository,
  MemoryRetentionPolicyRepository,
  // Per-intent MemorySegment* repositories (strangler split of work item
  // b8c754af). Registered and exported here alongside the sibling segment
  // repositories so cross-module consumers (MemorySignalsModule,
  // WorkflowRepairModule) can resolve them, not only MemoryModule-internal ones.
  MemorySegmentCrudRepository,
  MemorySegmentSearchRepository,
  MemorySegmentLearningCandidateRepository,
  MemorySegmentPostmortemRepository,
  MemorySegmentDecayRepository,
  MemorySegmentEvictionRepository,
  MemorySegmentDriftRepository,
  MemorySegmentAggregationRepository,
  SignalWeightHistoryRepository,
  SubagentDetailsRepository,
  DelegationContractRepository,
  AuditLogRepository,
  CostTrackingRepository,
  SecretStoreRepository,
  LlmProviderRepository,
  LlmModelRepository,
  ProviderOAuthSessionRepository,
  ProviderCooldownRepository,
  FallbackChainRepository,
  McpServerRepository,
  AcpServerRepository,
  AcpDiscoveredAgentRepository,
  AgentProfileRepository,
  AgentSkillRepository,
  AgentProfileSkillRepository,
  LearningCandidateRepository,
  RuntimeFeedbackSignalGroupRepository,
  UserRepository,
  RoleRepository,
  UserRoleRepository,
  RefreshTokenRepository,
  OrchestrationSessionStateRepository,
  OrchestrationDecisionLogArchiveRepository,
  WorkflowRunTodoRepository,
  WorkflowEventRepository,
  EventLedgerRepository,
  AutomationHookRepository,
  HeartbeatProfileRepository,
  HeartbeatRunRepository,
  StandingOrderRepository,
  ToolArtifactRepository,
  WebAutomationFailureArtifactRepository,
  ToolValidationRunRepository,
  AgentCommunicationThreadRepository,
  AgentCommunicationMessageRepository,
  AgentWarRoomSessionRepository,
  AgentWarRoomParticipantRepository,
  AgentWarRoomMessageRepository,
  AgentWarRoomBlackboardRepository,
  AgentWarRoomSignoffRepository,
  DoctorRepairHistoryRepository,
  NotificationRepository,
  ToolApprovalRuleRepository,
  ToolCallApprovalRequestRepository,
  UserChannelIdentityRepository,
  ChatSessionRepository,
  BudgetPolicyRepository,
  BudgetUsageEventRepository,
  BudgetDecisionEventRepository,
  GitOpsRepositoryBindingRepository,
  GitOpsReconcileRunRepository,
  GitOpsPendingChangeRepository,
  AttachmentRepository,
  AttachmentLinkRepository,
  UserQuestionAwaitRepository,
  StepSessionCheckpointRepository,
  ScopedVariableRepository,
  ScopedVariableAuditRepository,
  PullRequestTrackingRepository,
  ImprovementProposalRepository,
  WorkflowSkillBindingRepository,
  AgentProfileSkillBindingRepository,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const shouldRunMigrations =
          configService.get<string>('TYPEORM_MIGRATIONS_RUN') !== 'false';

        return {
          type: 'postgres',
          host: configService.get<string>('DB_HOST'),
          port: configService.get<number>('DB_PORT'),
          username: configService.get<string>('DB_USERNAME'),
          password: configService.get<string>('DB_PASSWORD'),
          database: configService.get<string>('DB_DATABASE'),
          entities: entities,
          migrations: registeredMigrations,
          migrationsRun: shouldRunMigrations,
          migrationsTransactionMode: 'each',
          synchronize: false,
          ...getApiTypeOrmLoggingOptions(),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: [
    ...repositories,
    {
      provide: WORKFLOW_RUN_LOOKUP_SERVICE,
      useExisting: WorkflowRunRepository,
    },
    {
      provide: WORKFLOW_RUN_REPOSITORY_PORT,
      useExisting: WorkflowRunRepository,
    },
    AgentProfilesFileSeedService,
    AgentProfileSkillAssignmentResolverService,
    AgentProfileSeedService,
    RoleSeedService,
    SetupConfigSeedService,
    LlmSecretSeedService,
    LlmProviderSeedService,
    LlmModelSeedService,
    SkillValidationService,
    SkillDependencyResolverService,
    SkillSeedService,
    ToolApprovalRulesSeedService,
    WorkflowSeedService,
    ScopedVariableSeedService,
    AgentSkillAssignmentsSeedService,
    FallbackChainSeedService,
    StartupSeedService,
  ],
  exports: [
    TypeOrmModule,
    ...repositories,
    WORKFLOW_RUN_LOOKUP_SERVICE,
    WORKFLOW_RUN_REPOSITORY_PORT,
    AgentProfilesFileSeedService,
    AgentProfileSkillAssignmentResolverService,
    AgentProfileSeedService,
    RoleSeedService,
    SetupConfigSeedService,
    LlmSecretSeedService,
    LlmProviderSeedService,
    LlmModelSeedService,
    SkillValidationService,
    SkillDependencyResolverService,
    SkillSeedService,
    ToolApprovalRulesSeedService,
    WorkflowSeedService,
    ScopedVariableSeedService,
    AgentSkillAssignmentsSeedService,
    FallbackChainSeedService,
    StartupSeedService,
  ],
})
export class DatabaseModule implements OnModuleInit {
  /** Database persistence layer module */
  protected readonly _moduleName = 'DatabaseModule';

  private readonly logger = new Logger(DatabaseModule.name);

  constructor(private readonly startupSeedService: StartupSeedService) {}

  async onModuleInit(): Promise<void> {
    this.logger.debug('DatabaseModule onModuleInit starting seeding...');
    await this.startupSeedService.seedOnStartup();
    this.logger.debug('DatabaseModule onModuleInit seeding complete.');
  }
}
