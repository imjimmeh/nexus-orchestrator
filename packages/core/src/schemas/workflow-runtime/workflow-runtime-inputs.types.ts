import { z } from "zod";
import {
  getCapabilitiesSchema,
  getAgentProfilesSchema,
  getAgentProfileSchema,
  listAgentProfileNamesSchema,
  webFetchInputSchema,
  queryMemoryBodySchema,
  queryMemoryFeedbackBodySchema,
  recordLearningBodySchema,
  rememberBodySchema,
  getTodoListBodySchema,
  manageTodoListBodySchema,
  scheduleListBodySchema,
  scheduleIdentitySchema,
  createScheduleSchema,
  updateScheduleSchema,
  listScheduleRunsSchema,
  listWorkflowsSchema,
  workflowIdentitySchema,
  workflowCreateSchema,
  workflowUpdateSchema,
  searchWorkflowsSchema,
  readWorkflowSummarySchema,
  publishSpecsSchema,
  validateSpecsSchema,
  invokeAgentWorkflowSchema,
  completeOrchestrationSchema,
  recordInvestigationFindingSchema,
  submitOrchestrationDecisionSchema,
  createAgentProfileSchema,
  searchSkillsSchema,
  skillManifestIdentitySchema,
  searchPlaybooksSchema,
  playbookIdentitySchema,
  strategicIntentBodySchema,
  webSearchInputSchema,
} from "./workflow-runtime-inputs.schemas";
import {
  runtimeRecordLearningBodySchema,
  runtimeRememberBodySchema,
  runtimeRecordStrategicIntentBodySchema,
  runtimeReadStrategicIntentBodySchema,
} from "./workflow-runtime-lifecycle.schema";

export type GetCapabilitiesInput = z.infer<typeof getCapabilitiesSchema>;
export type GetAgentProfilesInput = z.infer<typeof getAgentProfilesSchema>;
export type GetAgentProfileInput = z.infer<typeof getAgentProfileSchema>;
export type ListAgentProfileNamesInput = z.infer<
  typeof listAgentProfileNamesSchema
>;
export type WebSearchInput = z.infer<typeof webSearchInputSchema>;
export type WebFetchInput = z.infer<typeof webFetchInputSchema>;
export type QueryMemoryBodyInput = z.infer<typeof queryMemoryBodySchema>;
export type QueryMemoryFeedbackBodyInput = z.infer<
  typeof queryMemoryFeedbackBodySchema
>;
export type RecordLearningBodyInput = z.infer<typeof recordLearningBodySchema>;
export type RememberBodyInput = z.infer<typeof rememberBodySchema>;
export type RuntimeRecordLearningBodyInput = z.infer<
  typeof runtimeRecordLearningBodySchema
>;
export type RuntimeRememberBodyInput = z.infer<
  typeof runtimeRememberBodySchema
>;
export type RuntimeRecordStrategicIntentBodyInput = z.infer<
  typeof runtimeRecordStrategicIntentBodySchema
>;
export type RuntimeReadStrategicIntentBodyInput = z.infer<
  typeof runtimeReadStrategicIntentBodySchema
>;
export type StrategicIntentBodyInput = z.infer<
  typeof strategicIntentBodySchema
>;
export type GetTodoListBodyInput = z.infer<typeof getTodoListBodySchema>;
export type ManageTodoListBodyInput = z.infer<typeof manageTodoListBodySchema>;
export type ScheduleListBodyInput = z.infer<typeof scheduleListBodySchema>;
export type ScheduleIdentityInput = z.infer<typeof scheduleIdentitySchema>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
export type ListScheduleRunsInput = z.infer<typeof listScheduleRunsSchema>;
export type ListWorkflowsInput = z.infer<typeof listWorkflowsSchema>;
export type WorkflowIdentityInput = z.infer<typeof workflowIdentitySchema>;
export type WorkflowCreateInput = z.infer<typeof workflowCreateSchema>;
export type WorkflowUpdateInput = z.infer<typeof workflowUpdateSchema>;
export type SearchWorkflowsInput = z.infer<typeof searchWorkflowsSchema>;
export type ReadWorkflowSummaryInput = z.infer<
  typeof readWorkflowSummarySchema
>;
export type PublishSpecsInput = z.infer<typeof publishSpecsSchema>;
export type ValidateSpecsInput = z.infer<typeof validateSpecsSchema>;
export type InvokeAgentWorkflowInput = z.infer<
  typeof invokeAgentWorkflowSchema
>;
export type CompleteOrchestrationInput = z.infer<
  typeof completeOrchestrationSchema
>;
export type RecordInvestigationFindingInput = z.infer<
  typeof recordInvestigationFindingSchema
>;
export type SubmitOrchestrationDecisionInput = z.infer<
  typeof submitOrchestrationDecisionSchema
>;
export type CreateAgentProfileInput = z.infer<typeof createAgentProfileSchema>;
export type SearchSkillsInput = z.infer<typeof searchSkillsSchema>;
export type SkillManifestIdentityInput = z.infer<
  typeof skillManifestIdentitySchema
>;
export type SearchPlaybooksInput = z.infer<typeof searchPlaybooksSchema>;
export type PlaybookIdentityInput = z.infer<typeof playbookIdentitySchema>;

// Backward-compatible aliases retained for API/controller type imports.
export type GetCapabilitiesBody = GetCapabilitiesInput;
export type GetAgentProfilesBody = GetAgentProfilesInput;
export type GetAgentProfileBody = GetAgentProfileInput;
export type ListAgentProfileNamesBody = ListAgentProfileNamesInput;
export type WebSearchBody = WebSearchInput;
export type WebFetchBody = WebFetchInput;
export type QueryMemoryBody = QueryMemoryBodyInput;
export type QueryMemoryFeedbackBody = QueryMemoryFeedbackBodyInput;
export type RecordLearningBody = RecordLearningBodyInput;
export type RememberBody = RememberBodyInput;
export type RuntimeRecordLearningBody = RuntimeRecordLearningBodyInput;
export type RuntimeRememberBody = RuntimeRememberBodyInput;
export type RuntimeRecordStrategicIntentBody =
  RuntimeRecordStrategicIntentBodyInput;
export type RuntimeReadStrategicIntentBody =
  RuntimeReadStrategicIntentBodyInput;
export type StrategicIntentBody = StrategicIntentBodyInput;
export type GetTodoListBody = GetTodoListBodyInput;
export type ManageTodoListBody = ManageTodoListBodyInput;
export type ScheduleListBody = ScheduleListBodyInput;
export type ScheduleIdentityBody = ScheduleIdentityInput;
export type CreateScheduleBody = CreateScheduleInput;
export type UpdateScheduleBody = UpdateScheduleInput;
export type ScheduleRunsBody = ListScheduleRunsInput;
export type WorkflowListBody = ListWorkflowsInput;
export type WorkflowIdentityBody = WorkflowIdentityInput;
export type WorkflowMutationBody = WorkflowCreateInput;
export type WorkflowUpdateBody = WorkflowUpdateInput;
export type SearchWorkflowsBody = SearchWorkflowsInput;
export type ReadWorkflowSummaryBody = ReadWorkflowSummaryInput;
export type PublishSpecsBody = PublishSpecsInput;
export type ValidateSpecsBody = ValidateSpecsInput;
export type InvokeAgentWorkflowBody = InvokeAgentWorkflowInput;
export type CompleteOrchestrationBody = CompleteOrchestrationInput;
export type RecordInvestigationFindingBody = RecordInvestigationFindingInput;
export type SubmitOrchestrationDecisionBody = SubmitOrchestrationDecisionInput;
export type CreateAgentProfileBody = CreateAgentProfileInput;
export type SearchSkillsBody = SearchSkillsInput;
export type SkillManifestIdentityBody = SkillManifestIdentityInput;
export type SearchPlaybooksBody = SearchPlaybooksInput;
export type PlaybookIdentityBody = PlaybookIdentityInput;
