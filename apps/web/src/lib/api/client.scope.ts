import type { ApiClient } from "./client";
import type {
  ApiClientScopeMethods,
  CreateRoleAssignmentDto,
  CreateScopeNodeDto,
  EffectiveMember,
  MoveScopeNodeDto,
  RoleAssignment,
  Role,
  ScopeNode,
  ScopeNodeType,
  UpdateScopeNodeDto,
} from "./client.scope.types";

export type { ApiClientScopeMethods };

export const scopeApiMethods: ApiClientScopeMethods = {
  async getScopeTree(this: ApiClient): Promise<ScopeNode> {
    return this.get<ScopeNode>("/scopes/tree");
  },

  async getScopeNode(this: ApiClient, id: string): Promise<ScopeNode> {
    return this.get<ScopeNode>(`/scopes/${id}`);
  },

  async createScopeNode(
    this: ApiClient,
    dto: CreateScopeNodeDto,
  ): Promise<ScopeNode> {
    return this.post<ScopeNode>("/scopes", dto);
  },

  async assignRole(
    this: ApiClient,
    scopeNodeId: string,
    dto: CreateRoleAssignmentDto,
  ): Promise<RoleAssignment> {
    return this.post<RoleAssignment>(
      `/scopes/${scopeNodeId}/role-assignments`,
      dto,
    );
  },

  async getRoles(this: ApiClient): Promise<Role[]> {
    return this.get<Role[]>("/roles");
  },

  async getScopeMembers(
    this: ApiClient,
    scopeNodeId: string,
  ): Promise<EffectiveMember[]> {
    return this.get<EffectiveMember[]>(`/scopes/${scopeNodeId}/members`);
  },

  async revokeMemberRole(
    this: ApiClient,
    scopeNodeId: string,
    dto: { userId: string; roleId: string },
  ): Promise<void> {
    return this.delete<void>(`/scopes/${scopeNodeId}/role-assignments`, {
      data: dto,
    });
  },

  async updateScopeNode(
    this: ApiClient,
    id: string,
    dto: UpdateScopeNodeDto,
  ): Promise<ScopeNode> {
    return this.patch<ScopeNode>(`/scopes/${id}`, dto);
  },

  async moveScopeNode(
    this: ApiClient,
    id: string,
    dto: MoveScopeNodeDto,
  ): Promise<void> {
    return this.patch<void>(`/scopes/${id}/move`, dto);
  },

  async archiveScopeNode(this: ApiClient, id: string): Promise<void> {
    return this.post<void>(`/scopes/${id}/archive`);
  },

  async getAllowedChildTypes(
    this: ApiClient,
    id: string,
  ): Promise<ScopeNodeType[]> {
    return this.get<ScopeNodeType[]>(`/scopes/${id}/allowed-child-types`);
  },
};
