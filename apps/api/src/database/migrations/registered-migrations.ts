import { CreateMemoryRetentionPolicy20260715000001 } from './20260715000001-create-memory-retention-policy';
import { CreateLearningMeasurementSnapshots20260715000000 } from './20260715000000-create-learning-measurement-snapshots';
import { ResetSkillScopeData20260714050000 } from './20260714050000-reset-skill-scope-data';
import { CreateAgentProfileSkillBindings20260714040000 } from './20260714040000-create-agent-profile-skill-bindings';
import { AddToolRegistrySource20260714030000 } from './20260714030000-add-tool-registry-source';
import { CreateInvitations20260714020000 } from './20260714020000-create-invitations';
import { RenameOrgAdminToTenantAdmin20260714010000 } from './20260714010000-rename-org-admin-to-tenant-admin';
import { AddScopeNodeIsTenantRoot20260714000000 } from './20260714000000-add-scope-node-is-tenant-root';
import { CreateWorkflowSkillBindings20260714000000 } from './20260714000000-create-workflow-skill-bindings';
import { DedupLlmModelsByName20260713000000 } from './20260713000000-dedup-llm-models-by-name';
import { CreateImprovementProposals20260713000000 } from './20260713000000-create-improvement-proposals';
import { DedupToolRegistryNames20260712000000 } from './20260712000000-dedup-tool-registry-names';
import { AlterRetrospectiveQueueAddChatSession20260711000000 } from './20260711000000-alter-retrospective-queue-add-chat-session';
import { AddLearningCandidateDecisionColumns20260711000000 } from './20260711000000-add-learning-candidate-decision-columns';
import { AddExecutionLeaseColumns20260710000000 } from './20260710000000-add-execution-lease-columns';
import { AddAgentProfileRuntimeToolchains20260630120000 } from './20260630120000-add-agent-profile-runtime-toolchains';
import { AddAgentProfileFallbackChain20260629121000 } from './20260629121000-add-agent-profile-fallback-chain';
import { CreateFallbackChains20260629120500 } from './20260629120500-create-fallback-chains';
import { CreateProviderCooldowns20260629120000 } from './20260629120000-create-provider-cooldowns';
import { AddThinkingLevelColumns20260709000000 } from './20260709000000-add-thinking-level-columns';
import { CreateSignalWeightHistory20260708000000 } from './20260708000000-create-signal-weight-history';
import { AddMemorySegmentSupersession20260707000000 } from './20260707000000-add-memory-segment-supersession';
import { AddMemorySegmentGovernanceState20260706000000 } from './20260706000000-add-memory-segment-governance-state';
import { AddLearningCandidateRoutingTarget20260705000000 } from './20260705000000-add-learning-candidate-routing-target';
import { CreateRetrospectiveQueue20260704000000 } from './20260704000000-create-retrospective-queue';
import { AddEmbeddingModelColumns20260703000000 } from './20260703000000-add-embedding-model-columns';
import { EnablePgvector20260701000000 } from './20260701000000-enable-pgvector';
import { CreateMemoryEmbeddings20260702000000 } from './20260702000000-create-memory-embeddings';
import { AddAgentProfileHarnessContributions20260624000000 } from './20260624000000-add-agent-profile-harness-contributions';
import { AddRefreshTokensTokenHashUniqueIndex20260630000000 } from './20260630000000-add-refresh-tokens-token-hash-unique-index';
import { AddPrTrackingMergeConfig20260629000000 } from './20260629000000-add-pr-tracking-merge-config';
import { CreateHarnessAssets20260630000000 } from './20260630000000-create-harness-assets';
import { CreatePullRequestTracking20260628000000 } from './20260628000000-create-pull-request-tracking';
import { CreateScopedVariableAudit20260620090000 } from './20260620090000-create-scoped-variable-audit';
import { CreateScopedVariables20260619120000 } from './20260619120000-create-scoped-variables';
import { CreateMemorySegmentFeedback20260626000000 } from './20260626000000-create-memory-segment-feedback';
import { SubagentActiveUniqueness20260619100000 } from './20260619100000-subagent-active-uniqueness';
import { AddHarnessIdToChatSessions20260615120000 } from './20260615120000-add-harness-id-to-chat-sessions';
import { CreateStepSessionCheckpoint20260622000000 } from './20260622000000-create-step-session-checkpoint';
import { AddExecutionFreezeColumns20260622000000 } from './20260622000000-add-execution-freeze-columns';
import { AddMemorySegmentDecayColumns20260623000000 } from './20260623000000-add-memory-segment-decay-columns';
import { AddWorkflowRunStartCompleteTimestamps20260624000000 } from './20260624000000-add-workflow-run-start-complete-timestamps';
import { AddMemorySegmentEvictionColumns20260617000000 } from './20260617000000-add-memory-segment-eviction-columns';
import { AddStrategicIntentMemoryType20260625000000 } from './20260625000000-add-strategic-intent-memory-type';
import { AddMemoryDriftDetectedAt20260626000000 } from './20260626000000-add-memory-drift-detected-at';
import { DropSubagentExecutions20260614210000 } from './20260614210000-drop-subagent-executions';
import { BackfillSubagentDetails20260614200000 } from './20260614200000-backfill-subagent-details';
import { CreateSubagentDetails20260614190000 } from './20260614190000-create-subagent-details';
import { AddExecutionResolvedConfig20260621000000 } from './20260621000000-add-execution-resolved-config';
import { AddHumanApprovedAtToLearningCandidates20260621000000 } from './20260621000000-add-human-approved-at-to-learning-candidates';
import { AddSkillDiscoveryModeToAgentProfiles20260613120000 } from './20260613120000-add-skill-discovery-mode-to-agent-profiles';
import { BackfillBudgetUsageEventModelId20260620010000 } from './20260620010000-backfill-budget-usage-event-model-id';
import { AddBudgetUsageEventModelId20260620000000 } from './20260620000000-add-budget-usage-event-model-id';
import { CreateUserQuestionAwaits20260619000000 } from './20260619000000-create-user-question-awaits';
import { AddAgentAwaitSessionRef20260618000000 } from './20260618000000-add-agent-await-session-ref';
import { AddWorkflowRunWaitReason20260617010000 } from './20260617010000-add-workflow-run-wait-reason';
import { CreateAgentAwait20260617000000 } from './20260617000000-create-agent-await';
import { AddExecutionIdToChatSessions20260616000000 } from './20260616000000-add-execution-id-to-chat-sessions';
import { CreateExecutions20260615000000 } from './20260615000000-create-executions';
import { CreateGitopsRepositoryBindings20260611120000 } from './20260611120000-create-gitops-repository-bindings';
import { AddGitopsMetadataToConfigObjects20260611121000 } from './20260611121000-add-gitops-metadata-to-config-objects';
import { DropDeviceFlowSession20260614000000 } from './20260614000000-drop-device-flow-session';
import { DropHarnessSecretRefs20260612030000 } from './20260612030000-drop-harness-secret-refs';
import { CreateHarnessDefinition20260611000000 } from './20260611000000-create-harness-definition';
import { CreateHarnessCredentialBinding20260612000000 } from './20260612000000-create-harness-credential-binding';
import { CreateDeviceFlowSession20260612010000 } from './20260612010000-create-device-flow-session';
import { CreateScopedAiDefault20260612020000 } from './20260612020000-create-scoped-ai-default';
import { CreateRepairSession20260613020000 } from './20260613020000-create-repair-session';
import { RenameWorkflowRunTodoSourceContextItem20260613010000 } from './20260613010000-rename-workflow-run-todo-source-context-item';
import { EnableRepairDelegationDefault20260613000000 } from './20260613000000-enable-repair-delegation-default';
import { AddWorkflowRunAwaitingInput20260613000000 } from './20260613000000-add-workflow-run-awaiting-input';
import { AddManagedByTag20260612000000 } from './20260612000000-add-managed-by-tag';
import { CreateSkillsTable20260611020000 } from './20260611020000-create-skills-table';
import { AddScopeNodeArchivedAt20260611030000 } from './20260611030000-add-scope-node-archived-at';
import { ArchiveOrphanScopeNodes20260611040000 } from './20260611040000-archive-orphan-scope-nodes';
import { AddWorkflowCompositeUnique20260611010000 } from './20260611010000-add-workflow-composite-unique';
import { AddAgentProfileCompositeUnique20260611000000 } from './20260611000000-add-agent-profile-composite-unique';
import { CreateAttachmentsTables20260610120000 } from './20260610120000-create-attachments-tables';
import { AddConfigOverrideColumns20260610000000 } from './20260610000000-add-config-override-columns';
import { CreateRoleAssignments20260609020000 } from './20260609020000-create-role-assignments';
import { CreateScopeHierarchy20260609000000 } from './20260609000000-create-scope-hierarchy';
import { BackfillScopeNodes20260609010000 } from './20260609010000-backfill-scope-nodes';
import { AddSupportsVisionColumns20260608150000 } from './20260608150000-add-supports-vision-columns';
import { DropLegacyAgentProfileToolColumns20260608120000 } from './20260608120000-drop-legacy-agent-profile-tool-columns';
import { CreateDomainEventOutbox20260608120000 } from './20260608120000-create-domain-event-outbox';
import { AddLlmProviderId20260607113000 } from './20260607113000-add-llm-provider-id';
import { BackfillTotalTokenUsageCosts20260604213000 } from './20260604213000-backfill-total-token-usage-costs';
import { CreateCostGovernanceTables20260604130000 } from './20260604130000-create-cost-governance-tables';
import { AddAgentProfileProviderReference20260604132000 } from './20260604132000-add-agent-profile-provider-reference';
import { CreateProviderOAuthSessions20260604131000 } from './20260604131000-create-provider-oauth-sessions';
import { AddScopedConfigurableResourceOwnership20260604130000 } from './20260604130000-add-scoped-configurable-resource-ownership';
import { AddModelCostRateColumns20260604120000 } from './20260604120000-add-model-cost-rate-columns';
import { CreateWorkflowLifecycleResults20260603080000 } from './20260603080000-create-workflow-lifecycle-results';
import { AddSecretReferencesToMcpAcpServers20260604010718 } from './20260604010718-add-secret-references-to-mcp-acp-servers';
import { AddWorkflowSourceMetadata20260602120000 } from './20260602120000-add-workflow-source-metadata';
import { AddToolRegistryMetadata20260522152657 } from './20260522152657-add-tool-registry-metadata';
import { CreatePluginEventDeliveries20260518120000 } from './20260518120000-create-plugin-event-deliveries';
import { CreatePluginRegistryEntries20260517120000 } from './20260517120000-create-plugin-registry-entries';
import { AddRuntimeFeedbackWindowState20260517110000 } from './20260517110000-add-runtime-feedback-window-state';
import { CreateRuntimeFeedbackSignalGroups20260517100000 } from './20260517100000-create-runtime-feedback-signal-groups';
import { ApiPostCutoverBaseline20260517000000 } from './20260517000000-api-post-cutover-baseline';

export const registeredMigrations = [
  CreateMemoryRetentionPolicy20260715000001,
  CreateLearningMeasurementSnapshots20260715000000,
  ResetSkillScopeData20260714050000,
  CreateAgentProfileSkillBindings20260714040000,
  AddToolRegistrySource20260714030000,
  CreateInvitations20260714020000,
  RenameOrgAdminToTenantAdmin20260714010000,
  AddScopeNodeIsTenantRoot20260714000000,
  CreateWorkflowSkillBindings20260714000000,
  DedupLlmModelsByName20260713000000,
  CreateImprovementProposals20260713000000,
  DedupToolRegistryNames20260712000000,
  AlterRetrospectiveQueueAddChatSession20260711000000,
  AddLearningCandidateDecisionColumns20260711000000,
  AddExecutionLeaseColumns20260710000000,
  AddAgentProfileRuntimeToolchains20260630120000,
  AddAgentProfileFallbackChain20260629121000,
  CreateFallbackChains20260629120500,
  CreateProviderCooldowns20260629120000,
  AddThinkingLevelColumns20260709000000,
  CreateSignalWeightHistory20260708000000,
  AddMemorySegmentSupersession20260707000000,
  AddMemorySegmentGovernanceState20260706000000,
  AddLearningCandidateRoutingTarget20260705000000,
  CreateRetrospectiveQueue20260704000000,
  AddEmbeddingModelColumns20260703000000,
  CreateMemoryEmbeddings20260702000000,
  EnablePgvector20260701000000,
  CreateHarnessAssets20260630000000,
  AddAgentProfileHarnessContributions20260624000000,
  AddRefreshTokensTokenHashUniqueIndex20260630000000,
  AddPrTrackingMergeConfig20260629000000,
  CreatePullRequestTracking20260628000000,
  CreateMemorySegmentFeedback20260626000000,
  CreateScopedVariables20260619120000,
  CreateScopedVariableAudit20260620090000,
  SubagentActiveUniqueness20260619100000,
  AddHarnessIdToChatSessions20260615120000,
  CreateStepSessionCheckpoint20260622000000,
  AddExecutionFreezeColumns20260622000000,
  AddMemorySegmentDecayColumns20260623000000,
  AddWorkflowRunStartCompleteTimestamps20260624000000,
  AddMemorySegmentEvictionColumns20260617000000,
  AddStrategicIntentMemoryType20260625000000,
  AddMemoryDriftDetectedAt20260626000000,
  DropSubagentExecutions20260614210000,
  BackfillSubagentDetails20260614200000,
  CreateSubagentDetails20260614190000,
  AddExecutionResolvedConfig20260621000000,
  AddHumanApprovedAtToLearningCandidates20260621000000,
  AddSkillDiscoveryModeToAgentProfiles20260613120000,
  BackfillBudgetUsageEventModelId20260620010000,
  AddBudgetUsageEventModelId20260620000000,
  CreateUserQuestionAwaits20260619000000,
  AddAgentAwaitSessionRef20260618000000,
  AddWorkflowRunWaitReason20260617010000,
  CreateAgentAwait20260617000000,
  AddExecutionIdToChatSessions20260616000000,
  CreateExecutions20260615000000,
  CreateGitopsRepositoryBindings20260611120000,
  AddGitopsMetadataToConfigObjects20260611121000,
  DropDeviceFlowSession20260614000000,
  CreateRepairSession20260613020000,
  RenameWorkflowRunTodoSourceContextItem20260613010000,
  EnableRepairDelegationDefault20260613000000,
  AddWorkflowRunAwaitingInput20260613000000,
  CreateScopedAiDefault20260612020000,
  CreateDeviceFlowSession20260612010000,
  AddManagedByTag20260612000000,
  CreateSkillsTable20260611020000,
  AddScopeNodeArchivedAt20260611030000,
  ArchiveOrphanScopeNodes20260611040000,
  AddWorkflowCompositeUnique20260611010000,
  AddAgentProfileCompositeUnique20260611000000,
  CreateHarnessCredentialBinding20260612000000,
  DropHarnessSecretRefs20260612030000,
  CreateHarnessDefinition20260611000000,
  CreateAttachmentsTables20260610120000,
  AddConfigOverrideColumns20260610000000,
  CreateRoleAssignments20260609020000,
  BackfillScopeNodes20260609010000,
  CreateScopeHierarchy20260609000000,
  AddSupportsVisionColumns20260608150000,
  DropLegacyAgentProfileToolColumns20260608120000,
  CreateDomainEventOutbox20260608120000,
  AddLlmProviderId20260607113000,
  BackfillTotalTokenUsageCosts20260604213000,
  AddAgentProfileProviderReference20260604132000,
  CreateProviderOAuthSessions20260604131000,
  AddScopedConfigurableResourceOwnership20260604130000,
  CreateCostGovernanceTables20260604130000,
  AddModelCostRateColumns20260604120000,
  CreateWorkflowLifecycleResults20260603080000,
  AddSecretReferencesToMcpAcpServers20260604010718,
  AddWorkflowSourceMetadata20260602120000,
  AddToolRegistryMetadata20260522152657,
  CreatePluginEventDeliveries20260518120000,
  CreatePluginRegistryEntries20260517120000,
  AddRuntimeFeedbackWindowState20260517110000,
  CreateRuntimeFeedbackSignalGroups20260517100000,
  ApiPostCutoverBaseline20260517000000,
];
