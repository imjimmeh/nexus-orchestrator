/**
 * Workflow steering types shared by web client and (eventually) the backend API.
 *
 * Extracted from `./types.ts` as part of the api-types god-file split.
 * Foundational types (`Timestamps`, `AuthType`) come from `./common.types`.
 * `SteeringPlan.context_summary` is intentionally an inline object literal
 * shape — do not extract it to a named export. `child-7` will sweep the
 * re-exports in `./types.ts` once the rest of the extraction work lands.
 */

export interface SteeringProposedChange {
  type:
    | "update_artifact"
    | "create_work_item"
    | "update_work_item"
    | "invoke_workflow";
  description: string;
  path?: string;
  entity_type?: string;
  action?: string;
  workflow_name?: string;
  [key: string]: unknown;
}

export type SteeringPlanStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "modified"
  | "executing"
  | "completed";

export interface SteeringPlan {
  id: string;
  intent: string;
  target_area: string;
  description: string;
  proposed_changes: SteeringProposedChange[];
  confidence: number;
  questions_for_user: string[];
  context_summary?: {
    work_item_count: number;
    active_work_items: number;
    has_artifacts: boolean;
    recent_commits: number;
  };
  status: SteeringPlanStatus;
  created_at: string;
}
