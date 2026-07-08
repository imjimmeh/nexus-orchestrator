import { z } from "zod";

export const WorkflowLaunchSourceSchema = z.enum([
  "manual",
  "project_scoped",
  "rerun_with_edits",
  "preset",
]);

export const WorkflowLaunchContextSchema = z.object({
  scopeId: z.string().nullable().optional(),
  contextId: z.string().nullable().optional(),
});

export const WorkflowLaunchInputContractSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["string", "number", "boolean", "json", "string_array"]),
  required: z.boolean(),
  default: z.unknown().optional(),
});

export const WorkflowLaunchContractSchema = z.object({
  workflowId: z.string().min(1),
  workflowName: z.string().min(1),
  triggerType: z.enum(["event", "webhook", "manual", "lifecycle"]),
  launchable: z.boolean(),
  context: z.enum(["none", "required"]),
  inputs: z.array(WorkflowLaunchInputContractSchema),
  allowRawJson: z.boolean(),
});

export const WorkflowLaunchEligibilityReasonCodeSchema = z.enum([
  "WORKFLOW_NOT_MANUAL",
  "CONTEXT_REQUIRED",
  "SCOPE_REQUIRED",
  "CONTEXT_ID_REQUIRED",
]);

export const WorkflowLaunchEligibilityReasonSchema = z.object({
  code: WorkflowLaunchEligibilityReasonCodeSchema,
  message: z.string().min(1),
});

export const WorkflowLaunchEligibilitySchema = z.object({
  eligible: z.boolean(),
  reasons: z.array(WorkflowLaunchEligibilityReasonSchema),
});

export const WorkflowLaunchValidationIssueCodeSchema = z.enum([
  "WORKFLOW_NOT_MANUAL",
  "CONTEXT_REQUIRED",
  "SCOPE_REQUIRED",
  "CONTEXT_ID_REQUIRED",
  "INVALID_TRIGGER_DATA",
  "MISSING_REQUIRED_INPUT",
  "INVALID_INPUT_TYPE",
]);

export const WorkflowLaunchValidationIssueSchema = z.object({
  code: WorkflowLaunchValidationIssueCodeSchema,
  message: z.string().min(1),
  field: z.string().optional(),
});

export const WorkflowLaunchValidationResultSchema = z.object({
  valid: z.boolean(),
  issues: z.array(WorkflowLaunchValidationIssueSchema),
  normalizedTriggerData: z.record(z.string(), z.unknown()),
  normalizedContext: WorkflowLaunchContextSchema,
});

export const WorkflowLaunchDescriptorSchema = z.object({
  workflowRowId: z.string().min(1),
  workflowDefinitionId: z.string().min(1),
  workflowName: z.string().min(1),
  isActive: z.boolean(),
  description: z.string().optional(),
  contract: WorkflowLaunchContractSchema,
  eligibility: WorkflowLaunchEligibilitySchema,
});

export type WorkflowLaunchSource = z.infer<typeof WorkflowLaunchSourceSchema>;
export type WorkflowLaunchContext = z.infer<typeof WorkflowLaunchContextSchema>;
export type WorkflowLaunchInputContract = z.infer<
  typeof WorkflowLaunchInputContractSchema
>;
export type WorkflowLaunchContract = z.infer<
  typeof WorkflowLaunchContractSchema
>;
export type WorkflowLaunchEligibilityReasonCode = z.infer<
  typeof WorkflowLaunchEligibilityReasonCodeSchema
>;
export type WorkflowLaunchEligibilityReason = z.infer<
  typeof WorkflowLaunchEligibilityReasonSchema
>;
export type WorkflowLaunchEligibility = z.infer<
  typeof WorkflowLaunchEligibilitySchema
>;
export type WorkflowLaunchValidationIssueCode = z.infer<
  typeof WorkflowLaunchValidationIssueCodeSchema
>;
export type WorkflowLaunchValidationIssue = z.infer<
  typeof WorkflowLaunchValidationIssueSchema
>;
export type WorkflowLaunchValidationResult = z.infer<
  typeof WorkflowLaunchValidationResultSchema
>;
export type WorkflowLaunchDescriptor = z.infer<
  typeof WorkflowLaunchDescriptorSchema
>;
