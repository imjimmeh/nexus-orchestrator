export const GLOBAL_SCOPE_NODE_ID = "00000000-0000-0000-0000-000000000000";

export type ScopeNodeType = "platform" | "org" | "region" | "team" | "project";

export interface ScopeNode {
  id: string;
  parentId: string | null;
  type: ScopeNodeType;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  isTenantRoot?: boolean;
  children?: ScopeNode[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateScopeNodeDto {
  parentId: string;
  type: ScopeNodeType;
  name: string;
  slug?: string;
  isTenantRoot?: boolean;
}

export interface UpdateScopeNodeDto {
  name?: string;
  isTenantRoot?: boolean;
}

export interface MoveScopeNodeDto {
  newParentId: string;
}

export interface RoleAssignment {
  id: string;
  userId: string;
  userEmail: string;
  roleId: string;
  roleName: string;
  scopeNodeId: string;
  scopeNodeName: string;
  isDirect: boolean; // true = assigned at this node; false = inherited from ancestor
}

export interface CreateRoleAssignmentDto {
  userId: string;
  roleId: string;
}

export interface Role {
  id: string;
  name: string;
  ownerScopeNodeId: string | null; // null = system role
}

export type EffectiveMemberSource = "direct" | "inherited";

export interface EffectiveMember {
  userId: string;
  userEmail: string;
  roleId: string;
  roleName: string;
  source: EffectiveMemberSource;
  sourceScopeNodeId: string;
  sourceScopeName: string;
}

export interface ApiClientScopeMethods {
  getScopeTree(this: import("./client").ApiClient): Promise<ScopeNode>;
  getScopeNode(
    this: import("./client").ApiClient,
    id: string,
  ): Promise<ScopeNode>;
  createScopeNode(
    this: import("./client").ApiClient,
    dto: CreateScopeNodeDto,
  ): Promise<ScopeNode>;
  assignRole(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    dto: CreateRoleAssignmentDto,
  ): Promise<RoleAssignment>;
  getRoles(this: import("./client").ApiClient): Promise<Role[]>;
  getScopeMembers(
    this: import("./client").ApiClient,
    scopeNodeId: string,
  ): Promise<EffectiveMember[]>;
  revokeMemberRole(
    this: import("./client").ApiClient,
    scopeNodeId: string,
    dto: { userId: string; roleId: string },
  ): Promise<void>;
  updateScopeNode(
    this: import("./client").ApiClient,
    id: string,
    dto: UpdateScopeNodeDto,
  ): Promise<ScopeNode>;
  moveScopeNode(
    this: import("./client").ApiClient,
    id: string,
    dto: MoveScopeNodeDto,
  ): Promise<void>;
  archiveScopeNode(
    this: import("./client").ApiClient,
    id: string,
  ): Promise<void>;
  getAllowedChildTypes(
    this: import("./client").ApiClient,
    id: string,
  ): Promise<ScopeNodeType[]>;
}
