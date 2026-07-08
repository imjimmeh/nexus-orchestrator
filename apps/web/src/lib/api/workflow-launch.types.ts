/**
 * Workflow CRUD + launch-contract types — moved out of `./types.ts` so
 * the rest of the web API client can consume a stable surface while the
 * legacy `./types.ts` is incrementally depopulated by child-7.
 *
 * Foundational types (`Timestamps`) come from `./common.types`. The
 * launch contract + execution request family is colocated here because
 * the request shape references the contract descriptor directly.
 */

import type { PaginationQueryRequest } from "@nexus/core";
import type { Timestamps } from "./common.types";

export interface CreateWorkflowRequest {
  name: string;
  yaml_definition: string;
  is_active?: boolean;
}

export interface UpdateWorkflowRequest {
  name?: string;
  yaml_definition?: string;
  is_active?: boolean;
}

export type WorkflowLaunchSource =
  | "manual"
  | "project_scoped"
  | "rerun_with_edits"
  | "preset";

export type WorkflowLaunchContextRequirement = "none" | "required";

export type WorkflowLaunchInputType =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "string_array";

export interface WorkflowLaunchInputContract {
  key: string;
  label: string;
  description?: string;
  type: WorkflowLaunchInputType;
  required: boolean;
  default?: unknown;
}

export interface WorkflowLaunchContract {
  workflowId: string;
  workflowName: string;
  triggerType: "manual" | "event" | "webhook";
  launchable: boolean;
  context: WorkflowLaunchContextRequirement;
  inputs: WorkflowLaunchInputContract[];
  allowRawJson: boolean;
}

export interface WorkflowLaunchEligibilityReason {
  code: string;
  message: string;
}

export interface WorkflowLaunchEligibility {
  eligible: boolean;
  reasons: WorkflowLaunchEligibilityReason[];
}

export interface WorkflowLaunchPreset extends Timestamps {
  id: string;
  workflow_id: string;
  project_id: string | null;
  name: string;
  trigger_data: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
}

export interface WorkflowLaunchDescriptor {
  workflowRowId: string;
  workflowDefinitionId: string;
  workflowName: string;
  isActive: boolean;
  description?: string;
  contract: WorkflowLaunchContract;
  eligibility: WorkflowLaunchEligibility;
}

export interface WorkflowLaunchContractResponse extends WorkflowLaunchDescriptor {
  presets: WorkflowLaunchPreset[];
}

export interface WorkflowLaunchContextQuery {
  projectId?: string;
  workItemId?: string;
}

export interface CreateWorkflowLaunchPresetRequest {
  name: string;
  project_id?: string;
  trigger_data?: Record<string, unknown>;
}

export interface UpdateWorkflowLaunchPresetRequest {
  name?: string;
  trigger_data?: Record<string, unknown>;
}

export interface ExecuteWorkflowRequest {
  // Legacy alias used by existing callers.
  input?: Record<string, unknown>;
  trigger_data?: Record<string, unknown>;
  project_id?: string;
  work_item_id?: string;
  preset_id?: string;
  launch_source?: WorkflowLaunchSource;
  dry_run?: boolean;
}

export type ListWorkflowsParams = Partial<PaginationQueryRequest>;
