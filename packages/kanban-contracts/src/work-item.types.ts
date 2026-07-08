import type { z } from "zod";

import type {
  CreateWorkItemInputSchema,
  CreateWorkItemRequestSchema,
  DispatchWorkItemInputSchema,
  MergeWorkItemInputSchema,
  UpdateWorkItemRequestSchema,
  WorkItemEscalationSchema,
  WorkItemExecutionConfigSchema,
  WorkItemFailedDeliverableSchema,
  WorkItemRecordSchema,
  WorkItemRejectionFeedbackSchema,
  WorkItemRunRequestResultSchema,
  WorkItemSchema,
  WorkItemStatusSchema,
  WorkItemSubtaskSchema,
  WorkItemSubtaskStatusSchema,
} from "./work-item.schema";

export type WorkItemStatus = z.infer<typeof WorkItemStatusSchema>;
export type WorkItemFailedDeliverable = z.infer<
  typeof WorkItemFailedDeliverableSchema
>;
export type WorkItemRejectionFeedback = z.infer<
  typeof WorkItemRejectionFeedbackSchema
>;
export type WorkItemExecutionConfig = z.infer<
  typeof WorkItemExecutionConfigSchema
>;
export type WorkItemSubtaskStatus = z.infer<typeof WorkItemSubtaskStatusSchema>;
export type WorkItemSubtask = z.infer<typeof WorkItemSubtaskSchema>;
export type WorkItemRecord = z.infer<typeof WorkItemRecordSchema>;
export type WorkItem = z.infer<typeof WorkItemSchema>;
export type CreateWorkItemInput = z.infer<typeof CreateWorkItemInputSchema>;
export type CreateWorkItemRequest = z.infer<typeof CreateWorkItemRequestSchema>;
export type UpdateWorkItemRequest = z.infer<typeof UpdateWorkItemRequestSchema>;
export type DispatchWorkItemInput = z.infer<typeof DispatchWorkItemInputSchema>;
export type MergeWorkItemInput = z.infer<typeof MergeWorkItemInputSchema>;
export type WorkItemRunRequestResult = z.infer<
  typeof WorkItemRunRequestResultSchema
>;
export type WorkItemEscalation = z.infer<typeof WorkItemEscalationSchema>;
