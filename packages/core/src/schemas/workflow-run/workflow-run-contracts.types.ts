import { z } from "zod";
import { ExecutionContextSchema } from "../execution-context.schema";
import {
  WorkflowRunMetadataV1Schema,
  WorkflowRunExternalMcpMountV1Schema,
  WorkflowRunRequestV1Schema,
  WorkflowRunAcceptedV1Schema,
  WorkflowRunExecutionStatusV1Schema,
  WorkflowRunStatusV1Schema,
  WorkflowRunControlActionV1Schema,
  WorkflowRunControlRequestV1Schema,
  WorkflowRunScopeCancelRequestV1Schema,
  WorkflowRunScopeCancelResultV1Schema,
  WorkflowRunControlResultV1Schema,
} from "./workflow-run-contracts.schema";

export type WorkflowRunMetadataV1Shape = z.infer<
  typeof WorkflowRunMetadataV1Schema
>;
export type WorkflowRunContextV1Shape = z.infer<typeof ExecutionContextSchema>;
export type WorkflowRunExternalMcpMountV1Shape = z.infer<
  typeof WorkflowRunExternalMcpMountV1Schema
>;
export type WorkflowRunRequestV1Shape = z.infer<
  typeof WorkflowRunRequestV1Schema
>;
export type WorkflowRunAcceptedV1Shape = z.infer<
  typeof WorkflowRunAcceptedV1Schema
>;
export type WorkflowRunExecutionStatusV1Shape = z.infer<
  typeof WorkflowRunExecutionStatusV1Schema
>;
export type WorkflowRunStatusV1Shape = z.infer<
  typeof WorkflowRunStatusV1Schema
>;
export type WorkflowRunControlActionV1Shape = z.infer<
  typeof WorkflowRunControlActionV1Schema
>;
export type WorkflowRunControlRequestV1Shape = z.infer<
  typeof WorkflowRunControlRequestV1Schema
>;
export type WorkflowRunScopeCancelRequestV1Shape = z.infer<
  typeof WorkflowRunScopeCancelRequestV1Schema
>;
export type WorkflowRunControlResultV1Shape = z.infer<
  typeof WorkflowRunControlResultV1Schema
>;
export type WorkflowRunScopeCancelResultV1Shape = z.infer<
  typeof WorkflowRunScopeCancelResultV1Schema
>;

// Backward-compatible type aliases (without Shape suffix) — single source of truth from Zod schemas
export type WorkflowRunMetadataV1 = WorkflowRunMetadataV1Shape;
export type WorkflowRunContextV1 = WorkflowRunContextV1Shape;
export type WorkflowRunExternalMcpMountV1 = WorkflowRunExternalMcpMountV1Shape;
export type WorkflowRunRequestV1 = WorkflowRunRequestV1Shape;
export type WorkflowRunAcceptedV1 = WorkflowRunAcceptedV1Shape;
export type WorkflowRunExecutionStatusV1 = WorkflowRunExecutionStatusV1Shape;
export type WorkflowRunStatus = WorkflowRunExecutionStatusV1;
export type WorkflowRunStatusV1 = WorkflowRunStatusV1Shape;
export type WorkflowRunControlActionV1 = WorkflowRunControlActionV1Shape;
export type WorkflowRunControlRequestV1 = WorkflowRunControlRequestV1Shape;
export type WorkflowRunControlResultV1 = WorkflowRunControlResultV1Shape;
export type WorkflowRunScopeCancelRequestV1 =
  WorkflowRunScopeCancelRequestV1Shape;
export type WorkflowRunScopeCancelResultV1 =
  WorkflowRunScopeCancelResultV1Shape;
