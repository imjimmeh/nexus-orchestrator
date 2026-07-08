import type {
  BudgetPolicy,
  BudgetQueryParams,
  BudgetSummaryParams,
  BudgetSummaryRow,
  BudgetTimelineRow,
  BudgetUsageEventResponse,
  CreateBudgetPolicyRequest,
  UpdateBudgetPolicyRequest,
} from "@nexus/core";
import type { ApiClient } from "./client";

export type {
  BudgetPolicy,
  BudgetQueryParams,
  BudgetSummaryParams,
  BudgetSummaryRow,
  BudgetTimelineRow,
  BudgetUsageEventResponse,
  CreateBudgetPolicyRequest,
  UpdateBudgetPolicyRequest,
};

export interface ListBudgetPoliciesParams {
  /** Confines the listing to policies visible at this scope node. */
  scopeNodeId?: string;
}

export interface ApiClientBudgetMethods {
  fetchPolicies(
    this: ApiClient,
    params?: ListBudgetPoliciesParams,
  ): Promise<BudgetPolicy[]>;
  createPolicy(
    this: ApiClient,
    data: CreateBudgetPolicyRequest,
  ): Promise<BudgetPolicy>;
  updatePolicy(
    this: ApiClient,
    id: string,
    data: UpdateBudgetPolicyRequest,
  ): Promise<BudgetPolicy>;
  disablePolicy(this: ApiClient, id: string): Promise<BudgetPolicy>;
  fetchBudgetSummary(
    this: ApiClient,
    params?: BudgetSummaryParams,
  ): Promise<BudgetSummaryRow[]>;
  fetchBudgetTimeline(
    this: ApiClient,
    params?: BudgetSummaryParams,
  ): Promise<BudgetTimelineRow[]>;
  fetchUsageEvents(
    this: ApiClient,
    params?: BudgetQueryParams,
  ): Promise<{ data: BudgetUsageEventResponse[]; total: number }>;
}
