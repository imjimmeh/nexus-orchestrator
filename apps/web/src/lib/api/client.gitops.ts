import type { ApiClient } from "./client";
import type {
  ApiClientGitOpsMethods,
  CreateGitOpsRepositoryBindingInput,
  GitOpsRepositoryBinding,
  GitOpsStatusResponse,
  UpdateGitOpsRepositoryBindingInput,
} from "./client.gitops.types";

export type { ApiClientGitOpsMethods };

export const gitOpsApiMethods: ApiClientGitOpsMethods = {
  async getGitOpsBindings(
    this: ApiClient,
    scopeNodeId?: string,
  ): Promise<GitOpsRepositoryBinding[]> {
    return this.get<GitOpsRepositoryBinding[]>("/gitops/bindings", {
      params: scopeNodeId ? { scopeNodeId } : undefined,
    });
  },

  async createGitOpsBinding(
    this: ApiClient,
    input: CreateGitOpsRepositoryBindingInput,
  ): Promise<GitOpsRepositoryBinding> {
    return this.post<GitOpsRepositoryBinding>("/gitops/bindings", input);
  },

  async updateGitOpsBinding(
    this: ApiClient,
    scopeNodeId: string,
    bindingId: string,
    input: UpdateGitOpsRepositoryBindingInput,
  ): Promise<GitOpsRepositoryBinding> {
    return this.patch<GitOpsRepositoryBinding>(
      `/gitops/bindings/${scopeNodeId}/${bindingId}`,
      input,
    );
  },

  async disableGitOpsBinding(
    this: ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<GitOpsRepositoryBinding> {
    return this.delete<GitOpsRepositoryBinding>(
      `/gitops/bindings/${scopeNodeId}/${bindingId}`,
    );
  },

  async getGitOpsStatus(this: ApiClient): Promise<GitOpsStatusResponse> {
    return this.get<GitOpsStatusResponse>("/gitops/status");
  },

  async planGitOpsBinding(
    this: ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown> {
    return this.post<unknown>(
      `/gitops/bindings/${scopeNodeId}/${bindingId}/plan`,
    );
  },

  async applyGitOpsBinding(
    this: ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown> {
    return this.post<unknown>(
      `/gitops/bindings/${scopeNodeId}/${bindingId}/apply`,
    );
  },

  async syncGitOpsBindingOutbound(
    this: ApiClient,
    scopeNodeId: string,
    bindingId: string,
  ): Promise<unknown> {
    return this.post<unknown>(
      `/gitops/bindings/${scopeNodeId}/${bindingId}/outbound-sync`,
    );
  },

  async runReconcile(this: ApiClient, dryRun: boolean): Promise<unknown> {
    return this.post<unknown>("/gitops/reconcile", { dryRun });
  },
};
