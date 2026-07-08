import type { ApiClient } from "./client";
import type {
  PaginatedResponse,
  ProviderOAuthAuthorizeRequest,
  ProviderOAuthAuthorizeResponse,
  ProviderOAuthCallbackRequest,
  ProviderOAuthStatus,
  OAuthStartResult,
  OAuthSessionStatus,
} from "./common.types";
import type {
  AgentProfile,
  AgentSkill,
  AgentSkillFile,
  CreateAgentProfileRequest,
  CreateAgentSkillRequest,
  ListAgentProfilesParams,
  UpdateAgentProfileRequest,
  UpdateAgentSkillRequest,
  UpsertAgentSkillFileRequest,
} from "./agents.types";
import type {
  CreateModelRequest,
  LLMModel,
  ListModelsParams,
  UpdateModelRequest,
} from "./models.types";
import type {
  CreateProviderRequest,
  ListProvidersParams,
  LLMProvider,
  UpdateProviderRequest,
} from "./providers.types";
import type {
  CreateToolApprovalRuleRequest,
  ToolApprovalRule,
  ToolApprovalRuleEffect,
  ToolApprovalRuleScope,
  ToolCallApprovalRequest,
  UpdateToolApprovalRuleRequest,
} from "./tool-policy.types";
import type {
  DoctorRepairExecutionResult,
  DoctorRepairHistoryPage,
  DoctorRepairHistoryStatus,
  DoctorReportEnvelope,
  ExecuteDoctorRepairRequest,
  LifecycleResumeSummary,
} from "./doctor.types";
import type {
  EffectiveConfig,
  ModelPreset,
  ProviderPreset,
} from "./presets.types";
import type { Workflow } from "./workflows.types";

function paramsToRecord(
  params?: Record<string, unknown>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!params) return result;
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = String(value);
    }
  }
  return result;
}

export const adminApiMethods = {
  async getProviders(
    this: ApiClient,
    params?: ListProvidersParams,
  ): Promise<LLMProvider[]> {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    return this.get<LLMProvider[]>("/ai-config/providers", {
      params: Object.keys(query).length > 0 ? query : undefined,
    });
  },

  async getProvidersPage(
    this: ApiClient,
    params?: ListProvidersParams,
  ): Promise<PaginatedResponse<LLMProvider>> {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    const response = await this.client.get<PaginatedResponse<LLMProvider>>(
      "/ai-config/providers",
      { params: Object.keys(query).length > 0 ? query : undefined },
    );
    return response.data;
  },

  async getProvider(this: ApiClient, id: string): Promise<LLMProvider> {
    return this.get<LLMProvider>(`/ai-config/providers/${id}`);
  },

  async createProvider(
    this: ApiClient,
    data: CreateProviderRequest,
  ): Promise<LLMProvider> {
    return this.post<LLMProvider>("/ai-config/providers", data);
  },

  async updateProvider(
    this: ApiClient,
    id: string,
    data: UpdateProviderRequest,
  ): Promise<LLMProvider> {
    return this.patch<LLMProvider>(`/ai-config/providers/${id}`, data);
  },

  async deleteProvider(this: ApiClient, id: string): Promise<void> {
    return this.delete(`/ai-config/providers/${id}`);
  },

  async getProviderPresets(this: ApiClient): Promise<ProviderPreset[]> {
    const response = await this.client.get<{
      success: boolean;
      data: ProviderPreset[];
    }>("/ai-config/providers/presets");
    return response.data.data;
  },

  async getModels(
    this: ApiClient,
    params?: ListModelsParams,
  ): Promise<LLMModel[]> {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    return this.get<LLMModel[]>("/ai-config/models", {
      params: Object.keys(query).length > 0 ? query : undefined,
    });
  },

  async getModelsPage(
    this: ApiClient,
    params?: ListModelsParams,
  ): Promise<PaginatedResponse<LLMModel>> {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    const response = await this.client.get<PaginatedResponse<LLMModel>>(
      "/ai-config/models",
      { params: Object.keys(query).length > 0 ? query : undefined },
    );
    return response.data;
  },

  async getModel(this: ApiClient, id: string): Promise<LLMModel> {
    return this.get<LLMModel>(`/ai-config/models/${id}`);
  },

  async createModel(
    this: ApiClient,
    data: CreateModelRequest,
  ): Promise<LLMModel> {
    return this.post<LLMModel>("/ai-config/models", data);
  },

  async updateModel(
    this: ApiClient,
    id: string,
    data: UpdateModelRequest,
  ): Promise<LLMModel> {
    return this.patch<LLMModel>(`/ai-config/models/${id}`, data);
  },

  async deleteModel(this: ApiClient, id: string): Promise<void> {
    return this.delete(`/ai-config/models/${id}`);
  },

  async getModelPresets(this: ApiClient): Promise<ModelPreset[]> {
    const response = await this.client.get<{
      success: boolean;
      data: ModelPreset[];
    }>("/ai-config/models/presets");
    return response.data.data;
  },

  async getAgentProfiles(
    this: ApiClient,
    params?: ListAgentProfilesParams,
  ): Promise<AgentProfile[]> {
    const query = paramsToRecord(params as Record<string, unknown> | undefined);
    return this.get<AgentProfile[]>("/ai-config/agent-profiles", {
      params: Object.keys(query).length > 0 ? query : undefined,
    });
  },

  async getAgentProfile(this: ApiClient, id: string): Promise<AgentProfile> {
    return this.get<AgentProfile>(`/ai-config/agent-profiles/${id}`);
  },

  async createAgentProfile(
    this: ApiClient,
    data: CreateAgentProfileRequest,
  ): Promise<AgentProfile> {
    return this.post<AgentProfile>("/ai-config/agent-profiles", data);
  },

  async updateAgentProfile(
    this: ApiClient,
    id: string,
    data: UpdateAgentProfileRequest,
  ): Promise<AgentProfile> {
    return this.patch<AgentProfile>(`/ai-config/agent-profiles/${id}`, data);
  },

  async deleteAgentProfile(this: ApiClient, id: string): Promise<void> {
    return this.delete(`/ai-config/agent-profiles/${id}`);
  },

  async getAgentProfileSkills(
    this: ApiClient,
    profileId: string,
  ): Promise<AgentSkill[]> {
    return this.get<AgentSkill[]>(
      `/ai-config/agent-profiles/${profileId}/skills`,
    );
  },

  async replaceAgentProfileSkills(
    this: ApiClient,
    profileId: string,
    skillIds: string[],
  ): Promise<AgentSkill[]> {
    return this.put<AgentSkill[]>(
      `/ai-config/agent-profiles/${profileId}/skills`,
      {
        skill_ids: skillIds,
      },
    );
  },

  async getAgentSkills(
    this: ApiClient,
    params?: { includeInactive?: boolean },
  ): Promise<AgentSkill[]> {
    return this.get<AgentSkill[]>("/ai-config/skills", {
      params: {
        include_inactive: params?.includeInactive ? "true" : undefined,
      },
    });
  },

  async getAgentSkill(this: ApiClient, id: string): Promise<AgentSkill> {
    return this.get<AgentSkill>(`/ai-config/skills/${id}`);
  },

  async createAgentSkill(
    this: ApiClient,
    data: CreateAgentSkillRequest,
  ): Promise<AgentSkill> {
    return this.post<AgentSkill>("/ai-config/skills", data);
  },

  async updateAgentSkill(
    this: ApiClient,
    id: string,
    data: UpdateAgentSkillRequest,
  ): Promise<AgentSkill> {
    return this.patch<AgentSkill>(`/ai-config/skills/${id}`, data);
  },

  async deleteAgentSkill(this: ApiClient, id: string): Promise<void> {
    return this.delete(`/ai-config/skills/${id}`);
  },

  async getAgentSkillFiles(
    this: ApiClient,
    id: string,
  ): Promise<AgentSkillFile[]> {
    return this.get<AgentSkillFile[]>(`/ai-config/skills/${id}/files`);
  },

  async upsertAgentSkillFile(
    this: ApiClient,
    id: string,
    data: UpsertAgentSkillFileRequest,
  ): Promise<AgentSkillFile[]> {
    return this.put<AgentSkillFile[]>(`/ai-config/skills/${id}/files`, data);
  },

  async deleteAgentSkillFile(
    this: ApiClient,
    id: string,
    relativePath: string,
  ): Promise<AgentSkillFile[]> {
    return this.delete<AgentSkillFile[]>(
      `/ai-config/skills/${id}/files?path=${encodeURIComponent(relativePath)}`,
    );
  },

  async getPendingToolCallApprovalRequests(
    this: ApiClient,
    params?: { projectId?: string; workflowRunId?: string },
  ): Promise<ToolCallApprovalRequest[]> {
    return this.get<ToolCallApprovalRequest[]>(
      "/tool-call-approval-requests/pending",
      { params },
    );
  },

  async approveToolCallRequest(
    this: ApiClient,
    id: string,
    body: {
      alwaysAllowExact?: boolean;
      alwaysAllowSimilar?: boolean;
      allowThisSession?: boolean;
      similarPatterns?: Array<{
        path: string;
        operator: string;
        value: string;
      }>;
    },
  ): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(
      `/tool-call-approval-requests/${encodeURIComponent(id)}/approve`,
      body,
    );
  },

  async rejectToolCallRequest(
    this: ApiClient,
    id: string,
    body: { reason?: string },
  ): Promise<{ ok: boolean }> {
    return this.post<{ ok: boolean }>(
      `/tool-call-approval-requests/${encodeURIComponent(id)}/reject`,
      body,
    );
  },

  async listToolApprovalRules(
    this: ApiClient,
    params?: {
      scopeType?: ToolApprovalRuleScope;
      scopeId?: string;
      toolName?: string;
      effect?: ToolApprovalRuleEffect;
    },
  ): Promise<ToolApprovalRule[]> {
    return this.get<ToolApprovalRule[]>("/tool-approval-rules", { params });
  },

  async getToolApprovalRule(
    this: ApiClient,
    id: string,
  ): Promise<ToolApprovalRule> {
    return this.get<ToolApprovalRule>(
      `/tool-approval-rules/${encodeURIComponent(id)}`,
    );
  },

  async createToolApprovalRule(
    this: ApiClient,
    data: CreateToolApprovalRuleRequest,
  ): Promise<ToolApprovalRule> {
    return this.post<ToolApprovalRule>("/tool-approval-rules", data);
  },

  async updateToolApprovalRule(
    this: ApiClient,
    id: string,
    data: UpdateToolApprovalRuleRequest,
  ): Promise<ToolApprovalRule> {
    return this.patch<ToolApprovalRule>(
      `/tool-approval-rules/${encodeURIComponent(id)}`,
      data,
    );
  },

  async deleteToolApprovalRule(
    this: ApiClient,
    id: string,
  ): Promise<{ ok: boolean }> {
    return this.delete<{ ok: boolean }>(
      `/tool-approval-rules/${encodeURIComponent(id)}`,
    );
  },

  async getDoctorReportEnvelope(
    this: ApiClient,
  ): Promise<DoctorReportEnvelope> {
    return this.get<DoctorReportEnvelope>("/operations/doctor");
  },

  async executeDoctorRepair(
    this: ApiClient,
    data: ExecuteDoctorRepairRequest,
  ): Promise<DoctorRepairExecutionResult> {
    return this.post<DoctorRepairExecutionResult>(
      "/operations/doctor/repair",
      data,
    );
  },

  async getDoctorRepairHistory(
    this: ApiClient,
    params?: {
      limit?: number;
      offset?: number;
      action_id?: string;
      status?: DoctorRepairHistoryStatus;
    },
  ): Promise<DoctorRepairHistoryPage> {
    const query = new URLSearchParams();
    if (typeof params?.limit === "number") {
      query.set("limit", String(params.limit));
    }
    if (typeof params?.offset === "number") {
      query.set("offset", String(params.offset));
    }
    if (typeof params?.action_id === "string" && params.action_id.length > 0) {
      query.set("action_id", params.action_id);
    }
    if (typeof params?.status === "string" && params.status.length > 0) {
      query.set("status", params.status);
    }

    const suffix = query.toString();
    const endpoint =
      suffix.length > 0
        ? `/operations/doctor/history?${suffix}`
        : "/operations/doctor/history";

    return this.get<DoctorRepairHistoryPage>(endpoint);
  },

  async getLifecycleResumeSummary(
    this: ApiClient,
  ): Promise<LifecycleResumeSummary> {
    return this.get<LifecycleResumeSummary>(
      "/operations/lifecycle/resume-summary",
    );
  },

  async initiateProviderOAuth(
    this: ApiClient,
    providerId: string,
    data: ProviderOAuthAuthorizeRequest,
  ): Promise<ProviderOAuthAuthorizeResponse> {
    return this.post<ProviderOAuthAuthorizeResponse>(
      `/ai-config/providers/${providerId}/oauth/authorize`,
      data,
    );
  },

  async completeProviderOAuthCallback(
    this: ApiClient,
    data: ProviderOAuthCallbackRequest,
  ): Promise<ProviderOAuthStatus> {
    return this.post<ProviderOAuthStatus>(
      "/ai-config/providers/oauth/callback",
      data,
    );
  },

  async getProviderOAuthStatus(
    this: ApiClient,
    providerId: string,
  ): Promise<ProviderOAuthStatus> {
    return this.get<ProviderOAuthStatus>(
      `/ai-config/providers/${providerId}/oauth/status`,
    );
  },

  async startProviderOAuth(
    this: ApiClient,
    providerId: string,
    enterpriseUrl?: string,
  ): Promise<OAuthStartResult> {
    const response = await this.client.post<{
      success: boolean;
      data: OAuthStartResult;
    }>(`/ai-config/providers/${providerId}/oauth/start`, {
      enterprise_url: enterpriseUrl,
    });
    return response.data.data;
  },

  async submitProviderOAuthCode(
    this: ApiClient,
    providerId: string,
    sessionId: string,
    code: string,
  ): Promise<void> {
    await this.client.post(
      `/ai-config/providers/${providerId}/oauth/submit-code`,
      { session_id: sessionId, code },
    );
  },

  async getProviderOAuthSessionStatus(
    this: ApiClient,
    providerId: string,
    sessionId: string,
  ): Promise<OAuthSessionStatus> {
    const response = await this.client.get<{
      success: boolean;
      data: OAuthSessionStatus;
    }>(`/ai-config/providers/${providerId}/oauth/session/${sessionId}`);
    return response.data.data;
  },

  async resolveAgentProfile(
    this: ApiClient,
    name: string,
    scopeNodeId?: string,
  ): Promise<EffectiveConfig<AgentProfile>> {
    return this.get<EffectiveConfig<AgentProfile>>(
      `/ai-config/agent-profiles/resolve/${name}`,
      { params: { scopeNodeId } },
    );
  },

  async forkAgentForScope(
    this: ApiClient,
    baseProfileId: string,
    scopeNodeId: string,
    data: Partial<UpdateAgentProfileRequest>,
  ): Promise<AgentProfile> {
    return this.post<AgentProfile>(
      `/ai-config/agent-profiles/${baseProfileId}/scopes/${scopeNodeId}/override`,
      data,
    );
  },

  async resolveWorkflow(
    this: ApiClient,
    name: string,
    scopeNodeId?: string,
  ): Promise<EffectiveConfig<Workflow>> {
    return this.get<EffectiveConfig<Workflow>>(`/workflows/resolve/${name}`, {
      params: { scopeNodeId },
    });
  },

  async forkWorkflowForScope(
    this: ApiClient,
    baseWorkflowId: string,
    scopeNodeId: string,
    yamlDefinition: string,
  ): Promise<Workflow> {
    return this.post<Workflow>(
      `/workflows/${baseWorkflowId}/scopes/${scopeNodeId}/override`,
      { yaml_definition: yamlDefinition },
    );
  },
};
