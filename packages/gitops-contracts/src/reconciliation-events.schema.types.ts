// packages/gitops-contracts/src/reconciliation-events.schema.types.ts

import { z } from "zod";
import {
  GitOpsReconciliationDeprecatedApplyEventSchema,
  GitOpsReconciliationTickCompletedEventSchema,
} from "./reconciliation-events.schema";

export type GitOpsReconciliationDeprecatedApplyEvent = z.infer<
  typeof GitOpsReconciliationDeprecatedApplyEventSchema
>;

export type GitOpsReconciliationTickCompletedEvent = z.infer<
  typeof GitOpsReconciliationTickCompletedEventSchema
>;
