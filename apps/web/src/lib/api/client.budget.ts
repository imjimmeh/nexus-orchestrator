import type { ApiClient } from "./client";
import type {
  BudgetPolicy,
  BudgetQueryParams,
  CreateBudgetPolicyRequest,
  ListBudgetPoliciesParams,
  UpdateBudgetPolicyRequest,
  ApiClientBudgetMethods,
  BudgetSummaryParams,
  BudgetSummaryRow,
  BudgetTimelineRow,
  BudgetUsageEventResponse,
} from "./client.budget.types";

export type { ApiClientBudgetMethods };

export const budgetApiMethods: ApiClientBudgetMethods = {
  async fetchPolicies(
    this: ApiClient,
    params?: ListBudgetPoliciesParams,
  ): Promise<BudgetPolicy[]> {
    return this.get<BudgetPolicy[]>(
      "/cost-governance/policies",
      params ? { params: params as Record<string, unknown> } : undefined,
    );
  },

  async createPolicy(
    this: ApiClient,
    data: CreateBudgetPolicyRequest,
  ): Promise<BudgetPolicy> {
    return this.post<BudgetPolicy>("/cost-governance/policies", data);
  },

  async updatePolicy(
    this: ApiClient,
    id: string,
    data: UpdateBudgetPolicyRequest,
  ): Promise<BudgetPolicy> {
    return this.patch<BudgetPolicy>(
      `/cost-governance/policies/${encodeURIComponent(id)}`,
      data,
    );
  },

  async disablePolicy(this: ApiClient, id: string): Promise<BudgetPolicy> {
    return this.delete<BudgetPolicy>(
      `/cost-governance/policies/${encodeURIComponent(id)}`,
    );
  },

  async fetchBudgetSummary(
    this: ApiClient,
    params?: BudgetSummaryParams,
  ): Promise<BudgetSummaryRow[]> {
    return this.get<BudgetSummaryRow[]>(
      "/cost-governance/summary",
      params ? { params: params as Record<string, unknown> } : undefined,
    );
  },

  async fetchBudgetTimeline(
    this: ApiClient,
    params?: BudgetSummaryParams,
  ): Promise<BudgetTimelineRow[]> {
    return this.get<BudgetTimelineRow[]>(
      "/cost-governance/summary/timeline",
      params ? { params: params as Record<string, unknown> } : undefined,
    );
  },

  async fetchUsageEvents(
    this: ApiClient,
    params?: BudgetQueryParams,
  ): Promise<{ data: BudgetUsageEventResponse[]; total: number }> {
    const response = await this.get<{
      data: BudgetUsageEventResponse[];
      total?: number;
    }>(
      "/cost-governance/usage",
      params ? { params: params as Record<string, unknown> } : undefined,
    );

    return {
      data: response.data,
      total: response.total ?? response.data.length,
    };
  },
};
