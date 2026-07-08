import axios, { AxiosInstance } from "axios";
import {
  getRuntimeConfig,
  resolveRuntimeBaseUrlForPath,
  resolveRuntimeConfig,
} from "../config";
import type { ResolvedRuntimeConfig } from "../config";
import { EventLedgerPage, EventLedgerQuery } from "./event-ledger.types";
import { EventLedgerPaginatedResponse, ApiResponse } from "./common.types";
import { adminApiMethods } from "./client.admin";
import { notificationApiMethods } from "./client.notifications";
import { configureApiClientAuth } from "./client.auth";
import { projectApiMethods } from "./client.projects";
import type { ApiClientProjectMethods } from "./client.projects";
import { workflowApiMethods } from "./client.workflow";
import type { ApiClientWorkflowMethods } from "./client.workflow";
import { budgetApiMethods } from "./client.budget";
import type { ApiClientBudgetMethods } from "./client.budget";
import { gitOpsApiMethods } from "./client.gitops";
import type { ApiClientGitOpsMethods } from "./client.gitops";
import { scopeApiMethods } from "./client.scope";
import type { ApiClientScopeMethods } from "./client.scope";
import { authzApiMethods } from "./client.authz";
import type { ApiClientAuthzMethods } from "./client.authz";
import { auditApiMethods } from "./client.audit";
import type { ApiClientAuditMethods } from "./client.audit";
import { fallbackChainsApiMethods } from "./client.fallback-chains";
import type { ApiClientFallbackChainsMethods } from "./client.fallback-chains";
import { invitationApiMethods } from "./client.invitations";
import type { ApiClientInvitationMethods } from "./client.invitations";
import { secretsApiMethods } from "./client.secrets";
import type { ApiClientSecretsMethods } from "./client.secrets";
import { improvementProposalsApiMethods } from "./client.improvement-proposals";
import type { ApiClientImprovementProposalsMethods } from "./client.improvement-proposals";

function appendEventLedgerParam(
  params: Record<string, string>,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) {
    return;
  }

  params[key] = String(value);
}

type ApiClientAdminMethods = typeof adminApiMethods;

function resolveFallbackRuntimeConfig(): ResolvedRuntimeConfig {
  if (typeof window !== "undefined") {
    const runtimeConfig = (
      window as Window & { __RUNTIME_CONFIG__?: ResolvedRuntimeConfig }
    ).__RUNTIME_CONFIG__;

    if (runtimeConfig) {
      return resolveRuntimeConfig(runtimeConfig);
    }
  }

  return resolveRuntimeConfig(undefined);
}

export class ApiClient {
  readonly client: AxiosInstance;
  private fallbackRuntimeConfig: ResolvedRuntimeConfig =
    resolveFallbackRuntimeConfig();

  private getResolvedBaseUrl(requestPath?: string): string {
    try {
      // Prefer singleton runtime config if loaded
      return resolveRuntimeBaseUrlForPath(getRuntimeConfig(), requestPath);
    } catch {
      // Fallback for SSR or test environments
      return resolveRuntimeBaseUrlForPath(
        this.fallbackRuntimeConfig,
        requestPath,
      );
    }
  }

  constructor() {
    this.client = axios.create({
      headers: {
        "Content-Type": "application/json",
      },
    });

    configureApiClientAuth(this.client, (requestPath?: string) =>
      this.getResolvedBaseUrl(requestPath),
    );
  }

  setBaseURL(url: string) {
    this.fallbackRuntimeConfig = resolveRuntimeConfig({
      apiUrl: url,
      coreApiUrl: url,
      kanbanApiUrl: url,
      chatApiUrl: url,
    });
  }

  async get<T>(
    url: string,
    config?: { params?: Record<string, unknown> },
  ): Promise<T> {
    const response = await this.client.get<ApiResponse<T>>(url, config);
    return response.data.data;
  }

  async post<T>(url: string, data?: unknown): Promise<T> {
    const response = await this.client.post<ApiResponse<T>>(url, data);
    return response.data.data;
  }

  async patch<T>(url: string, data: unknown): Promise<T> {
    const response = await this.client.patch<ApiResponse<T>>(url, data);
    return response.data.data;
  }

  async put<T>(url: string, data: unknown): Promise<T> {
    const response = await this.client.put<ApiResponse<T>>(url, data);
    return response.data.data;
  }

  async delete<T = void>(url: string, config?: { data?: unknown }): Promise<T> {
    const response = config
      ? await this.client.delete<ApiResponse<T>>(url, config)
      : await this.client.delete<ApiResponse<T>>(url);
    if (!response.data) {
      return undefined as T;
    }
    return response.data.data;
  }

  async getEventLedger(query: EventLedgerQuery = {}): Promise<EventLedgerPage> {
    const params: Record<string, string> = {};

    appendEventLedgerParam(params, "domain", query.domain);
    appendEventLedgerParam(params, "eventName", query.eventName);
    appendEventLedgerParam(params, "outcome", query.outcome);
    appendEventLedgerParam(params, "severity", query.severity);
    appendEventLedgerParam(params, "source", query.source);
    appendEventLedgerParam(params, "actorType", query.actorType);
    appendEventLedgerParam(params, "actorId", query.actorId);
    appendEventLedgerParam(params, "projectId", query.projectId);
    appendEventLedgerParam(params, "workItemId", query.workItemId);
    appendEventLedgerParam(params, "workflowId", query.workflowId);
    appendEventLedgerParam(params, "workflowRunId", query.workflowRunId);
    appendEventLedgerParam(params, "jobId", query.jobId);
    appendEventLedgerParam(params, "stepId", query.stepId);
    appendEventLedgerParam(params, "toolName", query.toolName);
    appendEventLedgerParam(params, "requestId", query.requestId);
    appendEventLedgerParam(params, "correlationId", query.correlationId);
    appendEventLedgerParam(params, "occurredAfter", query.occurredAfter);
    appendEventLedgerParam(params, "occurredBefore", query.occurredBefore);
    appendEventLedgerParam(params, "search", query.search);
    appendEventLedgerParam(params, "sortBy", query.sortBy);
    appendEventLedgerParam(params, "sortDir", query.sortDir);
    appendEventLedgerParam(params, "limit", query.limit);
    appendEventLedgerParam(params, "offset", query.offset);

    const response = await this.client.get<EventLedgerPaginatedResponse>(
      "/events",
      {
        params: Object.keys(params).length > 0 ? params : undefined,
      },
    );

    return {
      data: response.data.data,
      total: response.data.meta?.total ?? response.data.data.length,
      limit:
        response.data.meta?.limit ?? query.limit ?? response.data.data.length,
      offset: response.data.meta?.offset ?? query.offset ?? 0,
    };
  }
}

Object.assign(
  ApiClient.prototype,
  projectApiMethods,
  workflowApiMethods,
  adminApiMethods,
  notificationApiMethods,
  budgetApiMethods,
  gitOpsApiMethods,
  scopeApiMethods,
  authzApiMethods,
  auditApiMethods,
  fallbackChainsApiMethods,
  invitationApiMethods,
  secretsApiMethods,
  improvementProposalsApiMethods,
);

type ApiClientWithMethods = ApiClient &
  ApiClientAdminMethods &
  typeof notificationApiMethods &
  ApiClientProjectMethods &
  ApiClientWorkflowMethods &
  ApiClientBudgetMethods &
  ApiClientGitOpsMethods &
  ApiClientScopeMethods &
  ApiClientAuthzMethods &
  ApiClientAuditMethods &
  ApiClientFallbackChainsMethods &
  ApiClientInvitationMethods &
  ApiClientSecretsMethods &
  ApiClientImprovementProposalsMethods;

export const api = new ApiClient() as ApiClientWithMethods;
