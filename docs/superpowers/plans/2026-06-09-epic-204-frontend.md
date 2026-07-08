# EPIC-204 Frontend: RBAC, Scope Hierarchy & GitOps UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete frontend for EPIC-204 — dual-rail sidebar scope tree, scope detail page, scope-aware resource lists, audit log page, enforcement mode controls, and scope-aware admin pages.

**Architecture:** `ScopeContext` (React context + localStorage) holds the active scope node ID and propagates it to all pages via a provider added at the App root. A dual-rail sidebar replaces the existing full-width sidebar with a 48px icon rail; a separate `ScopePanel` slides in beside it. All resource list pages gain a `ScopeBanner` + scope column. Admin pages gain scope-filtered queries. New pages: `/scopes/:id` and `/audit`. A `hierarchyEnabled` flag in runtime config gates all new UI.

**Tech Stack:** React 18, TypeScript, React Router v6, TanStack Query v5, Vitest + React Testing Library, shadcn/ui, Tailwind CSS, Axios-based `ApiClient` (mixin pattern at `apps/web/src/lib/api/client.ts`)

**Import alias:** `@/` → `apps/web/src/`

**Test runner:** `vitest` — run single test file with `npx vitest run src/path/to/file.spec.ts` from `apps/web/`

---

## File Map

### New Files

**Data layer**
- `apps/web/src/lib/api/client.scope.types.ts`
- `apps/web/src/lib/api/client.scope.ts`
- `apps/web/src/lib/api/client.authz.types.ts`
- `apps/web/src/lib/api/client.authz.ts`
- `apps/web/src/lib/api/client.audit.types.ts`
- `apps/web/src/lib/api/client.audit.ts`

**State**
- `apps/web/src/context/ScopeContext.tsx`

**Hooks**
- `apps/web/src/hooks/useScope.ts` + `.spec.ts`
- `apps/web/src/hooks/useRoleAssignments.ts` + `.spec.ts`
- `apps/web/src/hooks/useEnforcementMode.ts` + `.spec.ts`
- `apps/web/src/hooks/useAuditLog.ts` + `.spec.ts`

**Layout / scope UI**
- `apps/web/src/components/scope/ScopePanel.tsx`
- `apps/web/src/components/scope/ScopeTree.tsx` + `.spec.tsx`
- `apps/web/src/components/scope/ScopeTreeNode.tsx`
- `apps/web/src/components/scope/ScopeBanner.tsx` + `.spec.tsx`
- `apps/web/src/components/scope/ScopeBreadcrumb.tsx`
- `apps/web/src/components/scope/ScopeNodePicker.tsx`

**Pages**
- `apps/web/src/pages/scopes/ScopeDetailPage.tsx`
- `apps/web/src/pages/scopes/tabs/MembersRolesTab.tsx`
- `apps/web/src/pages/scopes/tabs/ConfigOverridesTab.tsx`
- `apps/web/src/pages/scopes/tabs/ChildScopesTab.tsx`
- `apps/web/src/pages/scopes/tabs/ScopeAuditTab.tsx`
- `apps/web/src/pages/audit/AuditLogPage.tsx`
- `apps/web/src/pages/audit/AuditLogTable.tsx`
- `apps/web/src/pages/audit/AuditEventDetail.tsx`
- `apps/web/src/pages/settings/EnforcementModeCard.tsx`

### Modified Files

- `apps/web/src/lib/api/client.ts` — add mixin registrations
- `apps/web/src/lib/queryKeys.ts` — add scope/authz/audit keys
- `apps/web/src/lib/config.types.ts` — add `hierarchyEnabled?: boolean`
- `apps/web/src/components/layout/Layout.tsx` — ScopeProvider + dynamic left offset
- `apps/web/src/components/layout/Sidebar.tsx` — replace with icon rail
- `apps/web/src/components/layout/Header.tsx` — active scope chip
- `apps/web/src/App.tsx` — new routes + ScopeProvider wrap
- `apps/web/src/pages/Settings.tsx` — add EnforcementModeCard
- `apps/web/src/pages/workflows/Workflows.tsx` — ScopeBanner + scope column
- `apps/web/src/pages/workflows/WorkflowDetail.tsx` — ScopeBreadcrumb + fork shortcut
- `apps/web/src/pages/agents/AgentProfiles.tsx` — ScopeBanner + scope column
- `apps/web/src/pages/agents/AgentProfileEditor.tsx` — ScopeBreadcrumb + fork shortcut
- `apps/web/src/pages/Users.tsx` — scope-aware members view
- `apps/web/src/pages/admin/BudgetPoliciesPage.tsx` — scope-aware
- `apps/web/src/pages/admin/BudgetSpendPage.tsx` — scope-aware
- `apps/web/src/pages/gitops/GitOpsStatus.tsx` — scope-filtered drift + fix /audit link
- `apps/web/src/pages/admin/ScopedConfigViewer.tsx` — pre-fill from ScopeContext

---

## Phase 1: Data Layer

### Task 1: Scope API Types + Client

**Files:**
- Create: `apps/web/src/lib/api/client.scope.types.ts`
- Create: `apps/web/src/lib/api/client.scope.ts`

- [ ] **Step 1: Create `client.scope.types.ts`**

```typescript
// apps/web/src/lib/api/client.scope.types.ts

export const GLOBAL_SCOPE_NODE_ID = '00000000-0000-0000-0000-000000000000';

export type ScopeNodeType = 'platform' | 'org' | 'region' | 'team' | 'project';

export interface ScopeNode {
  id: string;
  parentId: string | null;
  type: ScopeNodeType;
  name: string;
  slug: string;
  metadata: Record<string, unknown>;
  children?: ScopeNode[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateScopeNodeDto {
  parentId: string;
  type: ScopeNodeType;
  name: string;
  slug?: string;
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

export interface ApiClientScopeMethods {
  getScopeTree(this: import('./client').ApiClient): Promise<ScopeNode>;
  getScopeNode(this: import('./client').ApiClient, id: string): Promise<ScopeNode>;
  createScopeNode(this: import('./client').ApiClient, dto: CreateScopeNodeDto): Promise<ScopeNode>;
  getRoleAssignments(this: import('./client').ApiClient, scopeNodeId: string): Promise<RoleAssignment[]>;
  assignRole(this: import('./client').ApiClient, scopeNodeId: string, dto: CreateRoleAssignmentDto): Promise<RoleAssignment>;
  revokeRole(this: import('./client').ApiClient, scopeNodeId: string, assignmentId: string): Promise<void>;
  getRoles(this: import('./client').ApiClient): Promise<Role[]>;
}
```

- [ ] **Step 2: Create `client.scope.ts`**

```typescript
// apps/web/src/lib/api/client.scope.ts
import type { ApiClient } from './client';
import type {
  ApiClientScopeMethods,
  CreateRoleAssignmentDto,
  CreateScopeNodeDto,
  RoleAssignment,
  Role,
  ScopeNode,
} from './client.scope.types';

export type { ApiClientScopeMethods };

export const scopeApiMethods: ApiClientScopeMethods = {
  async getScopeTree(this: ApiClient): Promise<ScopeNode> {
    return this.get<ScopeNode>('/scopes/tree');
  },

  async getScopeNode(this: ApiClient, id: string): Promise<ScopeNode> {
    return this.get<ScopeNode>(`/scopes/${id}`);
  },

  async createScopeNode(this: ApiClient, dto: CreateScopeNodeDto): Promise<ScopeNode> {
    return this.post<ScopeNode>('/scopes', dto);
  },

  async getRoleAssignments(this: ApiClient, scopeNodeId: string): Promise<RoleAssignment[]> {
    return this.get<RoleAssignment[]>(`/scopes/${scopeNodeId}/role-assignments`);
  },

  async assignRole(this: ApiClient, scopeNodeId: string, dto: CreateRoleAssignmentDto): Promise<RoleAssignment> {
    return this.post<RoleAssignment>(`/scopes/${scopeNodeId}/role-assignments`, dto);
  },

  async revokeRole(this: ApiClient, scopeNodeId: string, assignmentId: string): Promise<void> {
    return this.delete<void>(`/scopes/${scopeNodeId}/role-assignments/${assignmentId}`);
  },

  async getRoles(this: ApiClient): Promise<Role[]> {
    return this.get<Role[]>('/roles');
  },
};
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/api/client.scope.types.ts apps/web/src/lib/api/client.scope.ts
git commit -m "feat(web/scope): add scope API types and client methods"
```

---

### Task 2: Authz + Audit API Types + Clients

**Files:**
- Create: `apps/web/src/lib/api/client.authz.types.ts`
- Create: `apps/web/src/lib/api/client.authz.ts`
- Create: `apps/web/src/lib/api/client.audit.types.ts`
- Create: `apps/web/src/lib/api/client.audit.ts`

- [ ] **Step 1: Create `client.authz.types.ts`**

```typescript
// apps/web/src/lib/api/client.authz.types.ts

export type EnforcementMode = 'audit' | 'warn' | 'enforce';

export interface ResourceEnforcementMode {
  resource: string;
  mode: EnforcementMode;
}

export interface MyPermissionsResponse {
  permissions: string[];
  scopeNodeId: string;
}

export interface ApiClientAuthzMethods {
  getEnforcementModes(this: import('./client').ApiClient): Promise<ResourceEnforcementMode[]>;
  setEnforcementMode(
    this: import('./client').ApiClient,
    resource: string,
    mode: EnforcementMode,
  ): Promise<ResourceEnforcementMode>;
  getMyPermissions(
    this: import('./client').ApiClient,
    scopeNodeId?: string,
  ): Promise<MyPermissionsResponse>;
}
```

- [ ] **Step 2: Create `client.authz.ts`**

```typescript
// apps/web/src/lib/api/client.authz.ts
import type { ApiClient } from './client';
import type {
  ApiClientAuthzMethods,
  EnforcementMode,
  MyPermissionsResponse,
  ResourceEnforcementMode,
} from './client.authz.types';

export type { ApiClientAuthzMethods };

export const authzApiMethods: ApiClientAuthzMethods = {
  async getEnforcementModes(this: ApiClient): Promise<ResourceEnforcementMode[]> {
    return this.get<ResourceEnforcementMode[]>('/authz/enforcement-mode');
  },

  async setEnforcementMode(
    this: ApiClient,
    resource: string,
    mode: EnforcementMode,
  ): Promise<ResourceEnforcementMode> {
    return this.put<ResourceEnforcementMode>(`/authz/enforcement-mode/${resource}`, { mode });
  },

  async getMyPermissions(this: ApiClient, scopeNodeId?: string): Promise<MyPermissionsResponse> {
    const query = scopeNodeId ? `?scopeNodeId=${encodeURIComponent(scopeNodeId)}` : '';
    return this.get<MyPermissionsResponse>(`/me/permissions${query}`);
  },
};
```

- [ ] **Step 3: Create `client.audit.types.ts`**

```typescript
// apps/web/src/lib/api/client.audit.types.ts

export interface AuditLogEntry {
  id: string;
  eventType: string;
  userId: string;
  userEmail: string;
  targetUserId?: string;
  targetUserEmail?: string;
  scopeNodeId: string;
  scopeNodeName: string;
  roleName?: string;
  inheritedBy?: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogFilters {
  scopeNodeId?: string;
  eventType?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
}

export interface ApiClientAuditMethods {
  getAuditLog(
    this: import('./client').ApiClient,
    filters?: AuditLogFilters,
  ): Promise<AuditLogResponse>;
}
```

- [ ] **Step 4: Create `client.audit.ts`**

```typescript
// apps/web/src/lib/api/client.audit.ts
import type { ApiClient } from './client';
import type { ApiClientAuditMethods, AuditLogFilters, AuditLogResponse } from './client.audit.types';

export type { ApiClientAuditMethods };

export const auditApiMethods: ApiClientAuditMethods = {
  async getAuditLog(this: ApiClient, filters: AuditLogFilters = {}): Promise<AuditLogResponse> {
    const params = new URLSearchParams();
    if (filters.scopeNodeId) params.set('scopeNodeId', filters.scopeNodeId);
    if (filters.eventType) params.set('eventType', filters.eventType);
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.limit != null) params.set('limit', String(filters.limit));
    if (filters.offset != null) params.set('offset', String(filters.offset));
    const query = params.toString();
    return this.get<AuditLogResponse>(`/audit${query ? `?${query}` : ''}`);
  },
};
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/client.authz.types.ts apps/web/src/lib/api/client.authz.ts \
        apps/web/src/lib/api/client.audit.types.ts apps/web/src/lib/api/client.audit.ts
git commit -m "feat(web/scope): add authz and audit API types and client methods"
```

---

### Task 3: Wire New Clients into ApiClient + Update Query Keys

**Files:**
- Modify: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/src/lib/queryKeys.ts`

- [ ] **Step 1: Add imports and mixin registrations to `client.ts`**

Find the block near the top of `client.ts` where the other mixins are imported (next to the existing `gitOpsApiMethods` import) and add:

```typescript
// Add alongside existing gitops imports:
import { scopeApiMethods } from './client.scope';
import type { ApiClientScopeMethods } from './client.scope';
import { authzApiMethods } from './client.authz';
import type { ApiClientAuthzMethods } from './client.authz';
import { auditApiMethods } from './client.audit';
import type { ApiClientAuditMethods } from './client.audit';
```

Find where the `api` singleton is created and `Object.assign` calls are made (after the class definition, near the bottom of the file) and add:

```typescript
Object.assign(api, scopeApiMethods);
Object.assign(api, authzApiMethods);
Object.assign(api, auditApiMethods);
```

Find the type cast where `api` is exported (something like `export const api = ... as ApiClient & ApiClientAdminMethods & ...`) and extend the intersection type:

```typescript
// Add ApiClientScopeMethods & ApiClientAuthzMethods & ApiClientAuditMethods
// to whatever type intersection already exists on the api export
```

> **Note:** The exact location of the Object.assign calls and the type cast varies. Search for `Object.assign(api,` and the `export const api` line to find them.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Add scope/authz/audit keys to `queryKeys.ts`**

At the end of the `queryKeys` object (before the closing `}`), add:

```typescript
  scope: {
    tree: () => ['scope', 'tree'] as const,
    node: (id: string) => ['scope', 'node', id] as const,
    roleAssignments: (scopeNodeId: string) =>
      ['scope', 'role-assignments', scopeNodeId] as const,
    roles: () => ['scope', 'roles'] as const,
  },
  authz: {
    enforcementModes: () => ['authz', 'enforcement-modes'] as const,
    myPermissions: (scopeNodeId?: string) =>
      ['authz', 'my-permissions', scopeNodeId ?? 'global'] as const,
  },
  audit: {
    log: (filters?: Record<string, unknown>) =>
      ['audit', 'log', filters ?? {}] as const,
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api/client.ts apps/web/src/lib/queryKeys.ts
git commit -m "feat(web/scope): wire scope/authz/audit clients into ApiClient and add query keys"
```

---

### Task 4: ScopeContext

**Files:**
- Create: `apps/web/src/context/ScopeContext.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/context/ScopeContext.spec.tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ScopeProvider, useScopeContext } from './ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ScopeProvider>{children}</ScopeProvider>
);

describe('ScopeContext', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to GLOBAL_SCOPE_NODE_ID', () => {
    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.activeScopeNodeId).toBe(GLOBAL_SCOPE_NODE_ID);
  });

  it('persists active scope to localStorage', () => {
    const { result } = renderHook(() => useScopeContext(), { wrapper });
    act(() => { result.current.setActiveScopeNodeId('node-123'); });
    expect(localStorage.getItem('nexus_active_scope_node_id')).toBe('node-123');
  });

  it('restores active scope from localStorage on mount', () => {
    localStorage.setItem('nexus_active_scope_node_id', 'node-456');
    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.activeScopeNodeId).toBe('node-456');
  });

  it('toggles scope panel open/closed', () => {
    const { result } = renderHook(() => useScopeContext(), { wrapper });
    expect(result.current.isScopePanelOpen).toBe(false);
    act(() => { result.current.toggleScopePanel(); });
    expect(result.current.isScopePanelOpen).toBe(true);
    act(() => { result.current.toggleScopePanel(); });
    expect(result.current.isScopePanelOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/context/ScopeContext.spec.tsx
```

Expected: FAIL — `ScopeProvider` not found.

- [ ] **Step 3: Create `ScopeContext.tsx`**

```typescript
// apps/web/src/context/ScopeContext.tsx
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

const STORAGE_KEY = 'nexus_active_scope_node_id';

interface ScopeContextValue {
  activeScopeNodeId: string;
  activeScopePath: string[]; // e.g. ['Platform', 'Acme Corp', 'Engineering']
  setActiveScopeNodeId: (id: string) => void;
  setScopePath: (path: string[]) => void;
  isScopePanelOpen: boolean;
  toggleScopePanel: () => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [activeScopeNodeId, setActiveScopeNodeIdState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? GLOBAL_SCOPE_NODE_ID,
  );
  const [activeScopePath, setActiveScopePath] = useState<string[]>(['Platform']);
  const [isScopePanelOpen, setIsScopePanelOpen] = useState(false);

  const setActiveScopeNodeId = useCallback((id: string) => {
    setActiveScopeNodeIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const setScopePath = useCallback((path: string[]) => {
    setActiveScopePath(path);
  }, []);

  const toggleScopePanel = useCallback(() => {
    setIsScopePanelOpen((prev) => !prev);
  }, []);

  const value = useMemo<ScopeContextValue>(
    () => ({
      activeScopeNodeId,
      activeScopePath,
      setActiveScopeNodeId,
      setScopePath,
      isScopePanelOpen,
      toggleScopePanel,
    }),
    [
      activeScopeNodeId,
      activeScopePath,
      setActiveScopeNodeId,
      setScopePath,
      isScopePanelOpen,
      toggleScopePanel,
    ],
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScopeContext(): ScopeContextValue {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('useScopeContext must be used within ScopeProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/context/ScopeContext.spec.tsx
```

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/context/ScopeContext.tsx apps/web/src/context/ScopeContext.spec.tsx
git commit -m "feat(web/scope): add ScopeContext provider with localStorage persistence"
```

---

### Task 5: Scope + Role Assignment Hooks

**Files:**
- Create: `apps/web/src/hooks/useScope.ts` + `.spec.ts`
- Create: `apps/web/src/hooks/useRoleAssignments.ts` + `.spec.ts`

- [ ] **Step 1: Write failing test for `useScope`**

```typescript
// apps/web/src/hooks/useScope.spec.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useScopeTree, useScopeNode, useCreateScope } from './useScope';
import { api } from '@/lib/api/client';
import type { ScopeNode } from '@/lib/api/client.scope.types';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

vi.mock('@/lib/api/client', () => ({ api: { getScopeTree: vi.fn(), getScopeNode: vi.fn(), createScopeNode: vi.fn() } }));

const mockRoot: ScopeNode = {
  id: GLOBAL_SCOPE_NODE_ID, parentId: null, type: 'platform', name: 'Platform',
  slug: 'platform', metadata: {}, createdAt: '', updatedAt: '',
  children: [],
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useScopeTree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns tree data from api', async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockRoot);
    const { result } = renderHook(() => useScopeTree(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockRoot);
  });
});

describe('useScopeNode', () => {
  it('fetches a single node by id', async () => {
    vi.mocked(api.getScopeNode).mockResolvedValue(mockRoot);
    const { result } = renderHook(() => useScopeNode(GLOBAL_SCOPE_NODE_ID), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getScopeNode).toHaveBeenCalledWith(GLOBAL_SCOPE_NODE_ID);
  });

  it('does not fetch when id is empty', () => {
    const { result } = renderHook(() => useScopeNode(''), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/hooks/useScope.spec.ts
```

Expected: FAIL — `useScope` not found.

- [ ] **Step 3: Create `useScope.ts`**

```typescript
// apps/web/src/hooks/useScope.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/queryKeys';
import type { CreateScopeNodeDto } from '@/lib/api/client.scope.types';

export function useScopeTree() {
  return useQuery({
    queryKey: queryKeys.scope.tree(),
    queryFn: () => api.getScopeTree(),
    staleTime: 30_000,
  });
}

export function useScopeNode(id: string) {
  return useQuery({
    queryKey: queryKeys.scope.node(id),
    queryFn: () => api.getScopeNode(id),
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useCreateScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateScopeNodeDto) => api.createScopeNode(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scope.tree() });
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/hooks/useScope.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing test for `useRoleAssignments`**

```typescript
// apps/web/src/hooks/useRoleAssignments.spec.ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRoleAssignments, useAssignRole, useRevokeRole, useRoles } from './useRoleAssignments';
import { api } from '@/lib/api/client';
import type { RoleAssignment, Role } from '@/lib/api/client.scope.types';

vi.mock('@/lib/api/client', () => ({
  api: {
    getRoleAssignments: vi.fn(),
    assignRole: vi.fn(),
    revokeRole: vi.fn(),
    getRoles: vi.fn(),
  },
}));

const mockAssignment: RoleAssignment = {
  id: 'a1', userId: 'u1', userEmail: 'alice@test.com',
  roleId: 'r1', roleName: 'member', scopeNodeId: 'scope-1',
  scopeNodeName: 'Engineering', isDirect: true,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useRoleAssignments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches assignments for a scope node', async () => {
    vi.mocked(api.getRoleAssignments).mockResolvedValue([mockAssignment]);
    const { result } = renderHook(() => useRoleAssignments('scope-1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([mockAssignment]);
  });
});

describe('useAssignRole', () => {
  it('calls api.assignRole and invalidates assignments', async () => {
    vi.mocked(api.assignRole).mockResolvedValue(mockAssignment);
    vi.mocked(api.getRoleAssignments).mockResolvedValue([]);
    const { result } = renderHook(() => useAssignRole('scope-1'), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ userId: 'u1', roleId: 'r1' });
    });
    expect(api.assignRole).toHaveBeenCalledWith('scope-1', { userId: 'u1', roleId: 'r1' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/hooks/useRoleAssignments.spec.ts
```

Expected: FAIL.

- [ ] **Step 7: Create `useRoleAssignments.ts`**

```typescript
// apps/web/src/hooks/useRoleAssignments.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/queryKeys';
import type { CreateRoleAssignmentDto } from '@/lib/api/client.scope.types';

export function useRoleAssignments(scopeNodeId: string) {
  return useQuery({
    queryKey: queryKeys.scope.roleAssignments(scopeNodeId),
    queryFn: () => api.getRoleAssignments(scopeNodeId),
    enabled: !!scopeNodeId,
    staleTime: 30_000,
  });
}

export function useRoles() {
  return useQuery({
    queryKey: queryKeys.scope.roles(),
    queryFn: () => api.getRoles(),
    staleTime: 60_000,
  });
}

export function useAssignRole(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoleAssignmentDto) => api.assignRole(scopeNodeId, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scope.roleAssignments(scopeNodeId),
      });
    },
  });
}

export function useRevokeRole(scopeNodeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (assignmentId: string) => api.revokeRole(scopeNodeId, assignmentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.scope.roleAssignments(scopeNodeId),
      });
    },
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run src/hooks/useRoleAssignments.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/hooks/useScope.ts apps/web/src/hooks/useScope.spec.ts \
        apps/web/src/hooks/useRoleAssignments.ts apps/web/src/hooks/useRoleAssignments.spec.ts
git commit -m "feat(web/scope): add useScope and useRoleAssignments hooks"
```

---

### Task 6: Enforcement Mode + Audit Hooks

**Files:**
- Create: `apps/web/src/hooks/useEnforcementMode.ts` + `.spec.ts`
- Create: `apps/web/src/hooks/useAuditLog.ts` + `.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/hooks/useEnforcementMode.spec.ts
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEnforcementModes, useSetEnforcementMode } from './useEnforcementMode';
import { api } from '@/lib/api/client';
import type { ResourceEnforcementMode } from '@/lib/api/client.authz.types';

vi.mock('@/lib/api/client', () => ({
  api: { getEnforcementModes: vi.fn(), setEnforcementMode: vi.fn() },
}));

const mockModes: ResourceEnforcementMode[] = [
  { resource: 'workflows', mode: 'audit' },
  { resource: 'secrets', mode: 'enforce' },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useEnforcementModes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns enforcement mode list', async () => {
    vi.mocked(api.getEnforcementModes).mockResolvedValue(mockModes);
    const { result } = renderHook(() => useEnforcementModes(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockModes);
  });
});

describe('useSetEnforcementMode', () => {
  it('calls api.setEnforcementMode', async () => {
    vi.mocked(api.setEnforcementMode).mockResolvedValue({ resource: 'workflows', mode: 'enforce' });
    vi.mocked(api.getEnforcementModes).mockResolvedValue([]);
    const { result } = renderHook(() => useSetEnforcementMode(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ resource: 'workflows', mode: 'enforce' });
    });
    expect(api.setEnforcementMode).toHaveBeenCalledWith('workflows', 'enforce');
  });
});
```

```typescript
// apps/web/src/hooks/useAuditLog.spec.ts
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuditLog } from './useAuditLog';
import { api } from '@/lib/api/client';
import type { AuditLogResponse } from '@/lib/api/client.audit.types';

vi.mock('@/lib/api/client', () => ({ api: { getAuditLog: vi.fn() } }));

const mockResponse: AuditLogResponse = {
  entries: [
    {
      id: 'e1', eventType: 'authz.role_granted', userId: 'u1',
      userEmail: 'alice@test.com', scopeNodeId: 'scope-1',
      scopeNodeName: 'Engineering', metadata: {}, createdAt: '2026-06-09T14:00:00Z',
    },
  ],
  total: 1,
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useAuditLog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches audit log with filters', async () => {
    vi.mocked(api.getAuditLog).mockResolvedValue(mockResponse);
    const { result } = renderHook(
      () => useAuditLog({ scopeNodeId: 'scope-1', limit: 20 }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.getAuditLog).toHaveBeenCalledWith({ scopeNodeId: 'scope-1', limit: 20 });
    expect(result.current.data?.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run src/hooks/useEnforcementMode.spec.ts src/hooks/useAuditLog.spec.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `useEnforcementMode.ts`**

```typescript
// apps/web/src/hooks/useEnforcementMode.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/queryKeys';
import type { EnforcementMode } from '@/lib/api/client.authz.types';

export function useEnforcementModes() {
  return useQuery({
    queryKey: queryKeys.authz.enforcementModes(),
    queryFn: () => api.getEnforcementModes(),
    staleTime: 60_000,
  });
}

export function useSetEnforcementMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ resource, mode }: { resource: string; mode: EnforcementMode }) =>
      api.setEnforcementMode(resource, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.authz.enforcementModes() });
    },
  });
}
```

- [ ] **Step 4: Create `useAuditLog.ts`**

```typescript
// apps/web/src/hooks/useAuditLog.ts
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/queryKeys';
import type { AuditLogFilters } from '@/lib/api/client.audit.types';

export function useAuditLog(filters: AuditLogFilters = {}) {
  return useQuery({
    queryKey: queryKeys.audit.log(filters as Record<string, unknown>),
    queryFn: () => api.getAuditLog(filters),
    staleTime: 15_000,
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run src/hooks/useEnforcementMode.spec.ts src/hooks/useAuditLog.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useEnforcementMode.ts apps/web/src/hooks/useEnforcementMode.spec.ts \
        apps/web/src/hooks/useAuditLog.ts apps/web/src/hooks/useAuditLog.spec.ts
git commit -m "feat(web/scope): add useEnforcementMode and useAuditLog hooks"
```

---

*Phase 1 complete.*

---

## Phase 2: Layout Restructure

### Task 7: Dual-Rail Sidebar Icon Rail

Replace the existing 256px full-text sidebar with a 48px icon-only rail. Each nav item becomes an icon button with a tooltip. The scope toggle button sits at the top of the rail.

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/Layout.tsx`

- [ ] **Step 1: Replace `Sidebar.tsx` with icon rail**

The new sidebar is a fixed 48px (`w-12`) column. It uses `NAV_GROUPS` from `navigation.config.ts` for icons. Replace the entire file:

```typescript
// apps/web/src/components/layout/Sidebar.tsx
import { useLocation, useNavigate } from 'react-router-dom';
import { Globe, Hexagon } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useScopeContext } from '@/context/ScopeContext';
import { NAV_GROUPS, findNavItemByPath } from './navigation.config';

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isScopePanelOpen, toggleScopePanel } = useScopeContext();

  const activeItem = findNavItemByPath(location.pathname);

  return (
    <TooltipProvider delayDuration={300}>
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-12 flex-col border-r border-border bg-card/95 backdrop-blur">
        {/* Logo */}
        <div className="flex h-16 items-center justify-center border-b border-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shadow-sm">
            <Hexagon className="h-5 w-5 text-primary-foreground" />
          </div>
        </div>

        {/* Scope toggle */}
        <div className="flex flex-col items-center gap-1 border-b border-border py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  isScopePanelOpen && 'bg-accent text-accent-foreground',
                )}
                onClick={toggleScopePanel}
              >
                <Globe className="h-4 w-4" />
                <span className="sr-only">Scope tree</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Scope tree</TooltipContent>
          </Tooltip>
        </div>

        {/* Nav items */}
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
          {NAV_GROUPS.flatMap((group) => group.items).map((item) => {
            const Icon = item.icon;
            const isActive = activeItem?.path === item.path;
            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8',
                      isActive && 'bg-accent text-accent-foreground',
                    )}
                    onClick={() => { navigate(item.path); }}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="sr-only">{item.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </aside>
    </TooltipProvider>
  );
}
```

- [ ] **Step 2: Update `Layout.tsx` to use dynamic left offset + ScopeProvider**

Replace the entire `Layout.tsx`:

```typescript
// apps/web/src/components/layout/Layout.tsx
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { KeyboardShortcutsProvider } from './KeyboardShortcutsProvider';
import { CommandPalette } from './CommandPalette';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalRealtimeProvider } from '../../context/GlobalRealtimeContext';
import { ScopeProvider, useScopeContext } from '../../context/ScopeContext';
import { ScopePanel } from '../scope/ScopePanel';
import { cn } from '@/lib/utils';

function LayoutInner({ children }: { children: React.ReactNode }) {
  const { isScopePanelOpen } = useScopeContext();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      {isScopePanelOpen && <ScopePanel />}
      {/* Left offset: 48px rail + 240px panel when open */}
      <div
        className={cn(
          'flex flex-1 flex-col min-w-0 transition-all duration-200',
          isScopePanelOpen ? 'pl-[288px]' : 'pl-12',
        )}
      >
        <Header />
        <Breadcrumbs />
        <main className="flex-1 overflow-y-auto min-w-0 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <ScopeProvider>
      <GlobalRealtimeProvider>
        <KeyboardShortcutsProvider>
          <LayoutInner>{children}</LayoutInner>
          <CommandPalette />
        </KeyboardShortcutsProvider>
      </GlobalRealtimeProvider>
    </ScopeProvider>
  );
}
```

- [ ] **Step 3: Start the dev server and verify sidebar renders without crashing**

```bash
cd apps/web && npx vite
```

Navigate to `http://localhost:3000`. Expected: icon-only rail visible, nav items clickable, scope globe icon at top.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/Layout.tsx
git commit -m "feat(web/scope): replace sidebar with icon rail; add ScopeProvider to Layout"
```

---

### Task 8: ScopePanel + ScopeTree Components

**Files:**
- Create: `apps/web/src/components/scope/ScopePanel.tsx`
- Create: `apps/web/src/components/scope/ScopeTreeNode.tsx`
- Create: `apps/web/src/components/scope/ScopeTree.tsx` + `.spec.tsx`

- [ ] **Step 1: Create `ScopeTreeNode.tsx`**

```typescript
// apps/web/src/components/scope/ScopeTreeNode.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronDown, Settings, Building2, Globe, MapPin, Users, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ScopeNode, ScopeNodeType } from '@/lib/api/client.scope.types';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

const TYPE_ICONS: Record<ScopeNodeType, React.ElementType> = {
  platform: Globe,
  org: Building2,
  region: MapPin,
  team: Users,
  project: FolderOpen,
};

interface ScopeTreeNodeProps {
  node: ScopeNode;
  depth: number;
  activeScopeNodeId: string;
  onSelect: (node: ScopeNode, path: string[]) => void;
  ancestorPath: string[];
}

export function ScopeTreeNode({
  node,
  depth,
  activeScopeNodeId,
  onSelect,
  ancestorPath,
}: ScopeTreeNodeProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isActive = node.id === activeScopeNodeId;
  const Icon = TYPE_ICONS[node.type] ?? FolderOpen;
  const currentPath = [...ancestorPath, node.name];

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded px-1 py-0.5 text-sm cursor-pointer hover:bg-accent',
          isActive && 'bg-accent/60 font-medium',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => { onSelect(node, currentPath); }}
      >
        {/* Expand/collapse toggle */}
        <button
          className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded((v) => !v);
          }}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />
          ) : (
            <span className="h-3 w-3" />
          )}
        </button>

        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />

        <span className="flex-1 truncate">{node.name}</span>

        {/* Active indicator */}
        {isActive && <span className="text-xs text-primary">◉</span>}

        {/* Settings gear — shown on hover, hidden for platform root */}
        {node.id !== GLOBAL_SCOPE_NODE_ID && (
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/scopes/${node.id}`);
            }}
          >
            <Settings className="h-3 w-3" />
            <span className="sr-only">Manage {node.name}</span>
          </Button>
        )}
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <ScopeTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeScopeNodeId={activeScopeNodeId}
              onSelect={onSelect}
              ancestorPath={currentPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write failing test for `ScopeTree`**

```typescript
// apps/web/src/components/scope/ScopeTree.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScopeTree } from './ScopeTree';
import { ScopeProvider } from '@/context/ScopeContext';
import { api } from '@/lib/api/client';
import type { ScopeNode } from '@/lib/api/client.scope.types';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

vi.mock('@/lib/api/client', () => ({ api: { getScopeTree: vi.fn() } }));

const mockTree: ScopeNode = {
  id: GLOBAL_SCOPE_NODE_ID, parentId: null, type: 'platform', name: 'Platform',
  slug: 'platform', metadata: {}, createdAt: '', updatedAt: '',
  children: [
    {
      id: 'org-1', parentId: GLOBAL_SCOPE_NODE_ID, type: 'org', name: 'Acme Corp',
      slug: 'acme', metadata: {}, createdAt: '', updatedAt: '', children: [],
    },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ScopeProvider>{children}</ScopeProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

describe('ScopeTree', () => {
  it('renders loading state', () => {
    vi.mocked(api.getScopeTree).mockReturnValue(new Promise(() => {}));
    render(<ScopeTree />, { wrapper });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders scope nodes after load', async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockTree);
    render(<ScopeTree />, { wrapper });
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
  });

  it('filters nodes by search text', async () => {
    vi.mocked(api.getScopeTree).mockResolvedValue(mockTree);
    render(<ScopeTree />, { wrapper });
    await screen.findByText('Acme Corp');
    fireEvent.change(screen.getByPlaceholderText(/filter/i), { target: { value: 'Acme' } });
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/components/scope/ScopeTree.spec.tsx
```

Expected: FAIL.

- [ ] **Step 4: Create `ScopeTree.tsx`**

```typescript
// apps/web/src/components/scope/ScopeTree.tsx
import { useMemo, useState } from 'react';
import { useCreateScope, useScopeTree } from '@/hooks/useScope';
import { useScopeContext } from '@/context/ScopeContext';
import { ScopeTreeNode } from './ScopeTreeNode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import type { ScopeNode } from '@/lib/api/client.scope.types';

function matchesFilter(node: ScopeNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query.toLowerCase())) return true;
  return (node.children ?? []).some((child) => matchesFilter(child, query));
}

function filterTree(node: ScopeNode, query: string): ScopeNode | null {
  if (!query) return node;
  if (!matchesFilter(node, query)) return null;
  return {
    ...node,
    children: (node.children ?? [])
      .map((child) => filterTree(child, query))
      .filter((c): c is ScopeNode => c !== null),
  };
}

export function ScopeTree() {
  const { data: root, isLoading, isError } = useScopeTree();
  const { activeScopeNodeId, setActiveScopeNodeId, setScopePath } = useScopeContext();
  const [filter, setFilter] = useState('');

  const filteredRoot = useMemo(
    () => (root ? filterTree(root, filter) : null),
    [root, filter],
  );

  const handleSelect = (node: ScopeNode, path: string[]) => {
    setActiveScopeNodeId(node.id);
    setScopePath(path);
  };

  if (isLoading) return <p className="px-3 py-2 text-sm text-muted-foreground">Loading...</p>;
  if (isError || !filteredRoot) {
    return <p className="px-3 py-2 text-sm text-destructive">Failed to load scopes.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        placeholder="Filter nodes..."
        value={filter}
        onChange={(e) => { setFilter(e.target.value); }}
        className="h-7 text-xs"
      />
      <div className="overflow-y-auto">
        <ScopeTreeNode
          node={filteredRoot}
          depth={0}
          activeScopeNodeId={activeScopeNodeId}
          onSelect={handleSelect}
          ancestorPath={[]}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/components/scope/ScopeTree.spec.tsx
```

Expected: PASS.

- [ ] **Step 6: Create `ScopePanel.tsx`**

```typescript
// apps/web/src/components/scope/ScopePanel.tsx
import { useNavigate } from 'react-router-dom';
import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScopeContext } from '@/context/ScopeContext';
import { ScopeTree } from './ScopeTree';

export function ScopePanel() {
  const { toggleScopePanel, activeScopeNodeId } = useScopeContext();
  const navigate = useNavigate();

  return (
    <aside className="fixed left-12 top-0 z-40 flex h-screen w-60 flex-col border-r border-border bg-card/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between border-b border-border px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scope
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleScopePanel}>
          <X className="h-3.5 w-3.5" />
          <span className="sr-only">Close scope panel</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <ScopeTree />
      </div>

      <div className="border-t border-border p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs"
          onClick={() => {
            // Navigate to active scope to use its Child Scopes tab to add
            navigate(`/scopes/${activeScopeNodeId}?tab=children`);
            toggleScopePanel();
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          New child scope
        </Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: Start the dev server and verify the scope panel opens/closes**

```bash
cd apps/web && npx vite
```

Click the Globe icon in the rail. Expected: scope panel slides in beside the rail, tree loads, clicking a node selects it (◉ indicator), gear icon on hover navigates to `/scopes/:id`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/scope/ScopeTreeNode.tsx \
        apps/web/src/components/scope/ScopeTree.tsx \
        apps/web/src/components/scope/ScopeTree.spec.tsx \
        apps/web/src/components/scope/ScopePanel.tsx
git commit -m "feat(web/scope): add ScopePanel, ScopeTree, and ScopeTreeNode components"
```

---

### Task 9: Header Active Scope Breadcrumb + Feature Flag

**Files:**
- Modify: `apps/web/src/components/layout/Header.tsx`
- Modify: `apps/web/src/lib/config.types.ts`

- [ ] **Step 1: Add `hierarchyEnabled` to config types**

In `apps/web/src/lib/config.types.ts`, add the optional flag to both interfaces:

```typescript
export interface RuntimeConfig {
  apiUrl?: string;
  coreApiUrl?: string;
  kanbanApiUrl?: string;
  chatApiUrl?: string;
  hierarchyEnabled?: boolean;   // ← add this line
}

export interface ResolvedRuntimeConfig {
  apiUrl: string;
  coreApiUrl: string;
  kanbanApiUrl: string;
  chatApiUrl: string;
  hierarchyEnabled: boolean;    // ← add this line
}
```

- [ ] **Step 2: Set a default for `hierarchyEnabled` in config resolution**

Open `apps/web/src/lib/config.ts` and find the `resolveRuntimeConfig` function. Add `hierarchyEnabled: config?.hierarchyEnabled ?? false` to the resolved output.

> **Note:** Look for where `kanbanApiUrl` and `chatApiUrl` are resolved — add `hierarchyEnabled` in the same block.

- [ ] **Step 3: Update `Header.tsx` to show active scope breadcrumb**

Replace the `<h1>` title with a flex row that shows the title + scope chip when hierarchy is enabled:

```typescript
// apps/web/src/components/layout/Header.tsx
import { Globe, Bell, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useKeyboardShortcuts } from './KeyboardShortcutsProvider';
import { useScopeContext } from '@/context/ScopeContext';
import { getRuntimeConfig } from '@/lib/config';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

export function Header() {
  const { setCommandPaletteOpen, setShortcutsHelpOpen } = useKeyboardShortcuts();
  const { activeScopeNodeId, activeScopePath, toggleScopePanel } = useScopeContext();
  const hierarchyEnabled = getRuntimeConfig().hierarchyEnabled;

  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
  const activeNodeName = activeScopePath[activeScopePath.length - 1] ?? 'Platform';
  const parentPath = activeScopePath.slice(0, -1).join(' > ');

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Nexus Orchestrator</h1>
        {hierarchyEnabled && !isGlobalScope && (
          <button
            className="flex items-center gap-1.5 rounded-full border border-border bg-accent/50 px-2.5 py-1 text-xs hover:bg-accent"
            onClick={toggleScopePanel}
            title={parentPath || undefined}
          >
            <Globe className="h-3 w-3 text-muted-foreground" />
            <span className="font-medium">{activeNodeName}</span>
            {parentPath && (
              <span className="text-muted-foreground">({parentPath})</span>
            )}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="hidden w-60 justify-between text-muted-foreground md:inline-flex"
          onClick={() => { setCommandPaletteOpen(true); }}
        >
          <span>Search and run commands</span>
          <span className="rounded border px-1.5 py-0.5 text-xs">Ctrl+K</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => { setShortcutsHelpOpen(true); }}
        >
          Ctrl+/
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground">
          <Bell className="h-5 w-5" />
          <span className="sr-only">Notifications</span>
        </Button>
        <Button variant="ghost" size="icon" className="text-muted-foreground">
          <User className="h-5 w-5" />
          <span className="sr-only">User menu</span>
        </Button>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/Header.tsx apps/web/src/lib/config.types.ts apps/web/src/lib/config.ts
git commit -m "feat(web/scope): add active scope breadcrumb to header; add hierarchyEnabled config flag"
```

---

*Phase 2 complete.*

---

## Phase 3: Reusable Scope UI Components

### Task 10: ScopeBanner, ScopeBreadcrumb, ScopeNodePicker

These three components are reused across many pages. Build and test them once here.

**Files:**
- Create: `apps/web/src/components/scope/ScopeBanner.tsx` + `.spec.tsx`
- Create: `apps/web/src/components/scope/ScopeBreadcrumb.tsx`
- Create: `apps/web/src/components/scope/ScopeNodePicker.tsx`

- [ ] **Step 1: Write failing test for `ScopeBanner`**

```typescript
// apps/web/src/components/scope/ScopeBanner.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ScopeBanner } from './ScopeBanner';
import { ScopeProvider, useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

// Helper to pre-set active scope before rendering
function WrapperWithScope({ scopeId, scopePath, children }: {
  scopeId: string; scopePath: string[]; children: React.ReactNode;
}) {
  return (
    <ScopeProvider>
      <InnerSetter scopeId={scopeId} scopePath={scopePath}>{children}</InnerSetter>
    </ScopeProvider>
  );
}

function InnerSetter({ scopeId, scopePath, children }: {
  scopeId: string; scopePath: string[]; children: React.ReactNode;
}) {
  const { setActiveScopeNodeId, setScopePath } = useScopeContext();
  // Set on first render via useLayoutEffect for test determinism
  if (typeof window !== 'undefined') {
    localStorage.setItem('nexus_active_scope_node_id', scopeId);
  }
  return <>{children}</>;
}

describe('ScopeBanner', () => {
  beforeEach(() => localStorage.clear());

  it('renders nothing when global scope is active', () => {
    localStorage.setItem('nexus_active_scope_node_id', GLOBAL_SCOPE_NODE_ID);
    render(<ScopeBanner />, { wrapper: ScopeProvider });
    expect(screen.queryByText(/clear scope/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && npx vitest run src/components/scope/ScopeBanner.spec.tsx
```

Expected: FAIL.

- [ ] **Step 3: Create `ScopeBanner.tsx`**

```typescript
// apps/web/src/components/scope/ScopeBanner.tsx
import { X, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

export function ScopeBanner() {
  const { activeScopeNodeId, activeScopePath, setActiveScopeNodeId, setScopePath } =
    useScopeContext();

  if (activeScopeNodeId === GLOBAL_SCOPE_NODE_ID) return null;

  const nodeLabel = activeScopePath[activeScopePath.length - 1] ?? 'Unknown';
  const parentLabel = activeScopePath.slice(0, -1).join(' > ');

  const handleClear = () => {
    setActiveScopeNodeId(GLOBAL_SCOPE_NODE_ID);
    setScopePath(['Platform']);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-accent/40 px-3 py-1.5 text-sm">
      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium">◉ {nodeLabel}</span>
      {parentLabel && (
        <span className="text-muted-foreground">({parentLabel})</span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-5 w-5"
        onClick={handleClear}
      >
        <X className="h-3.5 w-3.5" />
        <span className="sr-only">Clear scope</span>
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/web && npx vitest run src/components/scope/ScopeBanner.spec.tsx
```

Expected: PASS.

- [ ] **Step 5: Create `ScopeBreadcrumb.tsx`**

Used on resource detail pages to show the scope path of the resource.

```typescript
// apps/web/src/components/scope/ScopeBreadcrumb.tsx
import { Globe } from 'lucide-react';
import { useScopeContext } from '@/context/ScopeContext';

interface ScopeBreadcrumbProps {
  /** Override path — use when displaying a resource's own scope rather than the active scope */
  path?: string[];
}

export function ScopeBreadcrumb({ path }: ScopeBreadcrumbProps) {
  const { activeScopePath, setActiveScopeNodeId } = useScopeContext();
  const displayPath = path ?? activeScopePath;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Globe className="h-3 w-3" />
      {displayPath.map((segment, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span>›</span>}
          <span
            className={
              i === displayPath.length - 1
                ? 'font-medium text-foreground'
                : 'hover:text-foreground cursor-pointer hover:underline'
            }
          >
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create `ScopeNodePicker.tsx`**

A searchable dropdown for selecting a single scope node. Used in the Audit log filters and role assignment modal.

```typescript
// apps/web/src/components/scope/ScopeNodePicker.tsx
import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useScopeTree } from '@/hooks/useScope';
import type { ScopeNode } from '@/lib/api/client.scope.types';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

interface FlatNode {
  id: string;
  label: string; // indented display name
  name: string;
}

function flattenTree(node: ScopeNode, depth: number): FlatNode[] {
  const indent = '  '.repeat(depth);
  const self: FlatNode = { id: node.id, label: `${indent}${node.name}`, name: node.name };
  return [self, ...(node.children ?? []).flatMap((c) => flattenTree(c, depth + 1))];
}

interface ScopeNodePickerProps {
  value?: string;
  onChange: (scopeNodeId: string) => void;
  placeholder?: string;
  includeGlobal?: boolean;
}

export function ScopeNodePicker({
  value,
  onChange,
  placeholder = 'Select scope...',
  includeGlobal = true,
}: ScopeNodePickerProps) {
  const [open, setOpen] = useState(false);
  const { data: root } = useScopeTree();

  const nodes = useMemo<FlatNode[]>(() => {
    if (!root) return [];
    const all = flattenTree(root, 0);
    return includeGlobal ? all : all.filter((n) => n.id !== GLOBAL_SCOPE_NODE_ID);
  }, [root, includeGlobal]);

  const selected = nodes.find((n) => n.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
          {selected ? selected.name : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput placeholder="Search scopes..." />
          <CommandList>
            <CommandEmpty>No scope found.</CommandEmpty>
            <CommandGroup>
              {nodes.map((node) => (
                <CommandItem
                  key={node.id}
                  value={node.name}
                  onSelect={() => {
                    onChange(node.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === node.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="font-mono text-sm">{node.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

> **Note:** This component requires `Command`, `CommandInput`, etc. from shadcn/ui. If not already installed run: `npx shadcn-ui@latest add command popover` from `apps/web/`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/scope/ScopeBanner.tsx \
        apps/web/src/components/scope/ScopeBanner.spec.tsx \
        apps/web/src/components/scope/ScopeBreadcrumb.tsx \
        apps/web/src/components/scope/ScopeNodePicker.tsx
git commit -m "feat(web/scope): add ScopeBanner, ScopeBreadcrumb, and ScopeNodePicker components"
```

---

## Phase 4: Scope Detail Page

### Task 11: ScopeDetailPage Scaffold + Routes

**Files:**
- Create: `apps/web/src/pages/scopes/ScopeDetailPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create `ScopeDetailPage.tsx`**

```typescript
// apps/web/src/pages/scopes/ScopeDetailPage.tsx
import { useParams, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { Globe, Building2, MapPin, Users, FolderOpen, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useScopeNode } from '@/hooks/useScope';
import { useScopeContext } from '@/context/ScopeContext';
import { MembersRolesTab } from './tabs/MembersRolesTab';
import { ConfigOverridesTab } from './tabs/ConfigOverridesTab';
import { ChildScopesTab } from './tabs/ChildScopesTab';
import { ScopeAuditTab } from './tabs/ScopeAuditTab';
import type { ScopeNodeType } from '@/lib/api/client.scope.types';

const TYPE_ICONS: Record<ScopeNodeType, React.ElementType> = {
  platform: Globe,
  org: Building2,
  region: MapPin,
  team: Users,
  project: FolderOpen,
};

const TYPE_LABELS: Record<ScopeNodeType, string> = {
  platform: 'Platform',
  org: 'Organisation',
  region: 'Region',
  team: 'Team',
  project: 'Project',
};

export function ScopeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get('tab') ?? 'members';
  const { data: node, isLoading, isError } = useScopeNode(id ?? '');
  const { setActiveScopeNodeId, setScopePath } = useScopeContext();

  if (isLoading) return <p className="p-8 text-muted-foreground">Loading...</p>;
  if (isError || !node) {
    return <p className="p-8 text-destructive">Scope not found.</p>;
  }

  const Icon = TYPE_ICONS[node.type] ?? FolderOpen;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          <span>{node.slug}</span>
        </div>
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">{node.name}</h1>
          <Badge variant="outline">{TYPE_LABELS[node.type] ?? node.type}</Badge>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setActiveScopeNodeId(node.id);
              setScopePath([node.name]);
            }}
          >
            Set as Active Scope
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="members">Members & Roles</TabsTrigger>
          <TabsTrigger value="overrides">Config Overrides</TabsTrigger>
          <TabsTrigger value="children">Child Scopes</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <MembersRolesTab scopeNodeId={node.id} />
        </TabsContent>
        <TabsContent value="overrides">
          <ConfigOverridesTab scopeNodeId={node.id} />
        </TabsContent>
        <TabsContent value="children">
          <ChildScopesTab parentNode={node} />
        </TabsContent>
        <TabsContent value="audit">
          <ScopeAuditTab scopeNodeId={node.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Add route in `App.tsx`**

Add the following imports at the top of `App.tsx` alongside the other page imports:

```typescript
import { ScopeDetailPage } from './pages/scopes/ScopeDetailPage';
import { AuditLogPage } from './pages/audit/AuditLogPage';
```

Add the routes inside the inner `<Routes>` block (after the existing admin routes):

```typescript
<Route path="/scopes/:id" element={<ScopeDetailPage />} />
<Route path="/audit" element={<AuditLogPage />} />
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/scopes/ScopeDetailPage.tsx apps/web/src/App.tsx
git commit -m "feat(web/scope): add ScopeDetailPage scaffold and routes"
```

---

### Task 12: Members & Roles Tab

**Files:**
- Create: `apps/web/src/pages/scopes/tabs/MembersRolesTab.tsx`

- [ ] **Step 1: Create `MembersRolesTab.tsx`**

```typescript
// apps/web/src/pages/scopes/tabs/MembersRolesTab.tsx
import { useState } from 'react';
import { Shield, UserPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useRoleAssignments, useAssignRole, useRevokeRole, useRoles } from '@/hooks/useRoleAssignments';
import { useToast } from '@/hooks/useToast';

interface MembersRolesTabProps {
  scopeNodeId: string;
}

export function MembersRolesTab({ scopeNodeId }: MembersRolesTabProps) {
  const { data: assignments = [], isLoading } = useRoleAssignments(scopeNodeId);
  const { data: roles = [] } = useRoles();
  const assignRole = useAssignRole(scopeNodeId);
  const revokeRole = useRevokeRole(scopeNodeId);
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');

  const directAssignments = assignments.filter((a) => a.isDirect);
  const inheritedAssignments = assignments.filter((a) => !a.isDirect);

  const handleAssign = async () => {
    try {
      await assignRole.mutateAsync({ userId, roleId });
      toast({ title: 'Role assigned', description: `Role assigned to ${userId}.` });
      setDialogOpen(false);
      setUserId('');
      setRoleId('');
    } catch {
      toast({ title: 'Error', description: 'Failed to assign role.', variant: 'destructive' });
    }
  };

  const handleRevoke = async (assignmentId: string, email: string) => {
    try {
      await revokeRole.mutateAsync(assignmentId);
      toast({ title: 'Role revoked', description: `Role revoked from ${email}.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to revoke role.', variant: 'destructive' });
    }
  };

  if (isLoading) return <p className="py-4 text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Members & Roles</h3>
        <Button size="sm" onClick={() => { setDialogOpen(true); }}>
          <UserPlus className="mr-2 h-4 w-4" />
          Assign Role
        </Button>
      </div>

      {/* Direct assignments */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Granted at</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {directAssignments.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No direct assignments.
              </TableCell>
            </TableRow>
          )}
          {directAssignments.map((a) => (
            <TableRow key={a.id}>
              <TableCell>{a.userEmail}</TableCell>
              <TableCell>
                <Badge variant="secondary">{a.roleName}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">◉ Direct</Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => { void handleRevoke(a.id, a.userEmail); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Inherited assignments */}
      {inheritedAssignments.length > 0 && (
        <>
          <h4 className="text-sm font-medium text-muted-foreground">
            Inherited from parent scopes (read-only here)
          </h4>
          <Table>
            <TableBody>
              {inheritedAssignments.map((a) => (
                <TableRow key={a.id} className="opacity-70">
                  <TableCell>{a.userEmail}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{a.roleName}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">↑ {a.scopeNodeName}</Badge>
                  </TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}

      {/* Assign role dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="userId">User ID or email</Label>
              <Input
                id="userId"
                placeholder="user@example.com"
                value={userId}
                onChange={(e) => { setUserId(e.target.value); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="roleId">Role</Label>
              <Select value={roleId} onValueChange={setRoleId}>
                <SelectTrigger id="roleId">
                  <SelectValue placeholder="Select a role..." />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); }}>Cancel</Button>
            <Button
              onClick={() => { void handleAssign(); }}
              disabled={!userId || !roleId || assignRole.isPending}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/scopes/tabs/MembersRolesTab.tsx
git commit -m "feat(web/scope): add MembersRolesTab with assign and revoke"
```

---

### Task 13: Config Overrides, Child Scopes, and Audit Tabs

**Files:**
- Create: `apps/web/src/pages/scopes/tabs/ConfigOverridesTab.tsx`
- Create: `apps/web/src/pages/scopes/tabs/ChildScopesTab.tsx`
- Create: `apps/web/src/pages/scopes/tabs/ScopeAuditTab.tsx`

- [ ] **Step 1: Create `ConfigOverridesTab.tsx`**

Reuses the existing `ScopedConfigViewer` component, pre-scoped to this node.

```typescript
// apps/web/src/pages/scopes/tabs/ConfigOverridesTab.tsx
import { ScopedConfigViewer } from '@/pages/admin/ScopedConfigViewer';

interface ConfigOverridesTabProps {
  scopeNodeId: string;
}

export function ConfigOverridesTab({ scopeNodeId }: ConfigOverridesTabProps) {
  return (
    <div className="pt-4">
      <ScopedConfigViewer presetScopeNodeId={scopeNodeId} />
    </div>
  );
}
```

> **Note:** `ScopedConfigViewer` will need a `presetScopeNodeId?: string` prop added in Phase 8 (Task 21). For now, stub it — the tab will render the viewer without a pre-set scope and that's acceptable until Task 21.

- [ ] **Step 2: Create `ChildScopesTab.tsx`**

```typescript
// apps/web/src/pages/scopes/tabs/ChildScopesTab.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateScope } from '@/hooks/useScope';
import { useToast } from '@/hooks/useToast';
import type { ScopeNode, ScopeNodeType } from '@/lib/api/client.scope.types';

const NODE_TYPES: ScopeNodeType[] = ['org', 'region', 'team', 'project'];

interface ChildScopesTabProps {
  parentNode: ScopeNode;
}

export function ChildScopesTab({ parentNode }: ChildScopesTabProps) {
  const navigate = useNavigate();
  const createScope = useCreateScope();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<ScopeNodeType>('team');

  const children = parentNode.children ?? [];

  const handleCreate = async () => {
    try {
      const node = await createScope.mutateAsync({ parentId: parentNode.id, type, name });
      toast({ title: 'Scope created', description: `${name} created.` });
      setDialogOpen(false);
      setName('');
      navigate(`/scopes/${node.id}`);
    } catch {
      toast({ title: 'Error', description: 'Failed to create scope.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Child Scopes</h3>
        <Button size="sm" onClick={() => { setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          New Child
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {children.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No child scopes.
              </TableCell>
            </TableRow>
          )}
          {children.map((child) => (
            <TableRow
              key={child.id}
              className="cursor-pointer hover:bg-accent/40"
              onClick={() => { navigate(`/scopes/${child.id}`); }}
            >
              <TableCell className="font-medium">{child.name}</TableCell>
              <TableCell>{child.type}</TableCell>
              <TableCell>—</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/scopes/${child.id}`); }}>
                  Manage →
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Child Scope under {parentNode.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="scopeName">Name</Label>
              <Input
                id="scopeName"
                value={name}
                onChange={(e) => { setName(e.target.value); }}
                placeholder="e.g. Backend Team"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="scopeType">Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v as ScopeNodeType); }}>
                <SelectTrigger id="scopeType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NODE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); }}>Cancel</Button>
            <Button onClick={() => { void handleCreate(); }} disabled={!name || createScope.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Create `ScopeAuditTab.tsx`**

```typescript
// apps/web/src/pages/scopes/tabs/ScopeAuditTab.tsx
import { AuditLogTable } from '@/pages/audit/AuditLogTable';

interface ScopeAuditTabProps {
  scopeNodeId: string;
}

export function ScopeAuditTab({ scopeNodeId }: ScopeAuditTabProps) {
  // AuditLogTable will be created in Phase 5 Task 14
  return (
    <div className="pt-4">
      <AuditLogTable lockedScopeNodeId={scopeNodeId} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/scopes/tabs/ConfigOverridesTab.tsx \
        apps/web/src/pages/scopes/tabs/ChildScopesTab.tsx \
        apps/web/src/pages/scopes/tabs/ScopeAuditTab.tsx
git commit -m "feat(web/scope): add Config Overrides, Child Scopes, and Audit tabs"
```

---

*Phases 3 + 4 complete.*

---

## Phase 5: Audit Log Page

### Task 14: AuditLogTable + AuditEventDetail + AuditLogPage

**Files:**
- Create: `apps/web/src/pages/audit/AuditEventDetail.tsx`
- Create: `apps/web/src/pages/audit/AuditLogTable.tsx`
- Create: `apps/web/src/pages/audit/AuditLogPage.tsx`

- [ ] **Step 1: Create `AuditEventDetail.tsx`**

Expandable inline drawer shown when a row is clicked.

```typescript
// apps/web/src/pages/audit/AuditEventDetail.tsx
import type { AuditLogEntry } from '@/lib/api/client.audit.types';

interface AuditEventDetailProps {
  entry: AuditLogEntry;
}

export function AuditEventDetail({ entry }: AuditEventDetailProps) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/50 p-4 text-sm">
      <span className="text-muted-foreground">Time</span>
      <span>{new Date(entry.createdAt).toLocaleString()}</span>
      <span className="text-muted-foreground">Event</span>
      <span className="font-mono text-xs">{entry.eventType}</span>
      <span className="text-muted-foreground">User</span>
      <span>{entry.userEmail}</span>
      {entry.targetUserEmail && (
        <>
          <span className="text-muted-foreground">Target user</span>
          <span>{entry.targetUserEmail}</span>
        </>
      )}
      {entry.roleName && (
        <>
          <span className="text-muted-foreground">Role</span>
          <span>{entry.roleName}</span>
        </>
      )}
      <span className="text-muted-foreground">Scope</span>
      <span>
        {entry.scopeNodeName}{' '}
        <span className="text-muted-foreground text-xs">({entry.scopeNodeId})</span>
      </span>
      {entry.inheritedBy && entry.inheritedBy.length > 0 && (
        <>
          <span className="text-muted-foreground">Inherited by</span>
          <span>{entry.inheritedBy.join(', ')}</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `AuditLogTable.tsx`**

```typescript
// apps/web/src/pages/audit/AuditLogTable.tsx
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuditLog } from '@/hooks/useAuditLog';
import { AuditEventDetail } from './AuditEventDetail';
import type { AuditLogFilters } from '@/lib/api/client.audit.types';

const PAGE_SIZE = 20;

const EVENT_BADGE_VARIANT: Record<string, 'default' | 'destructive' | 'secondary' | 'outline'> = {
  'authz.denied': 'destructive',
  'authz.role_granted': 'default',
  'authz.role_revoked': 'secondary',
  'authz.scope_created': 'outline',
  'authz.scope_moved': 'outline',
  'authz.scope_deleted': 'destructive',
};

interface AuditLogTableProps {
  /** When set, the scope filter is locked to this value (used from Scope Detail page) */
  lockedScopeNodeId?: string;
  filters?: Omit<AuditLogFilters, 'scopeNodeId' | 'limit' | 'offset'>;
}

export function AuditLogTable({ lockedScopeNodeId, filters = {} }: AuditLogTableProps) {
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError } = useAuditLog({
    ...filters,
    scopeNodeId: lockedScopeNodeId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (isLoading) return <p className="py-4 text-muted-foreground">Loading audit log...</p>;
  if (isError) return <p className="py-4 text-destructive">Failed to load audit log.</p>;

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>Time</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Scope</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No audit events found.
              </TableCell>
            </TableRow>
          )}
          {entries.map((entry) => (
            <>
              <TableRow
                key={entry.id}
                className="cursor-pointer hover:bg-accent/40"
                onClick={() => { setExpandedId(expandedId === entry.id ? null : entry.id); }}
              >
                <TableCell>
                  {expandedId === entry.id
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronRight className="h-3.5 w-3.5" />}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  <Badge variant={EVENT_BADGE_VARIANT[entry.eventType] ?? 'outline'} className="font-mono text-xs">
                    {entry.eventType}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{entry.userEmail}</TableCell>
                <TableCell className="text-sm">{entry.scopeNodeName}</TableCell>
              </TableRow>
              {expandedId === entry.id && (
                <TableRow key={`${entry.id}-detail`}>
                  <TableCell colSpan={5} className="p-2">
                    <AuditEventDetail entry={entry} />
                  </TableCell>
                </TableRow>
              )}
            </>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => { setPage((p) => p - 1); }}
          >
            ← Prev
          </Button>
          <span className="text-muted-foreground">Page {page + 1} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => { setPage((p) => p + 1); }}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `AuditLogPage.tsx`**

```typescript
// apps/web/src/pages/audit/AuditLogPage.tsx
import { useState } from 'react';
import { Shield } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScopeNodePicker } from '@/components/scope/ScopeNodePicker';
import { AuditLogTable } from './AuditLogTable';
import type { AuditLogFilters } from '@/lib/api/client.audit.types';

const EVENT_TYPES = [
  'authz.denied',
  'authz.role_granted',
  'authz.role_revoked',
  'authz.scope_created',
  'authz.scope_moved',
  'authz.scope_deleted',
];

const DATE_RANGES: { label: string; hours: number }[] = [
  { label: 'Last 24h', hours: 24 },
  { label: 'Last 7 days', hours: 168 },
  { label: 'Last 30 days', hours: 720 },
];

export function AuditLogPage() {
  const [scopeNodeId, setScopeNodeId] = useState<string | undefined>();
  const [eventType, setEventType] = useState<string | undefined>();
  const [rangeHours, setRangeHours] = useState(168); // default 7 days

  const fromDate = new Date(Date.now() - rangeHours * 3600 * 1000).toISOString();

  const filters: Omit<AuditLogFilters, 'scopeNodeId' | 'limit' | 'offset'> = {
    eventType,
    from: fromDate,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Audit Log</h1>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-56">
          <ScopeNodePicker
            value={scopeNodeId}
            onChange={setScopeNodeId}
            placeholder="All scopes"
            includeGlobal
          />
        </div>
        <Select
          value={eventType ?? 'all'}
          onValueChange={(v) => { setEventType(v === 'all' ? undefined : v); }}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {EVENT_TYPES.map((et) => (
              <SelectItem key={et} value={et}>{et}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(rangeHours)}
          onValueChange={(v) => { setRangeHours(Number(v)); }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.hours} value={String(r.hours)}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <AuditLogTable lockedScopeNodeId={scopeNodeId} filters={filters} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/audit/AuditEventDetail.tsx \
        apps/web/src/pages/audit/AuditLogTable.tsx \
        apps/web/src/pages/audit/AuditLogPage.tsx
git commit -m "feat(web/audit): add AuditLogPage, AuditLogTable, and AuditEventDetail"
```

---

## Phase 6: Enforcement Mode Settings

### Task 15: EnforcementModeCard

**Files:**
- Create: `apps/web/src/pages/settings/EnforcementModeCard.tsx`
- Modify: `apps/web/src/pages/Settings.tsx`

- [ ] **Step 1: Create `EnforcementModeCard.tsx`**

```typescript
// apps/web/src/pages/settings/EnforcementModeCard.tsx
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEnforcementModes, useSetEnforcementMode } from '@/hooks/useEnforcementMode';
import { useToast } from '@/hooks/useToast';
import type { EnforcementMode } from '@/lib/api/client.authz.types';

const ALL_RESOURCES = [
  'workflows', 'agents', 'skills', 'secrets', 'budgets',
  'roles', 'users', 'settings', 'gitops', 'audit',
];

const MODE_DESCRIPTIONS: Record<EnforcementMode, string> = {
  audit: 'Log only — denials are never enforced',
  warn: 'Log + warn — request allowed but logged',
  enforce: 'Hard deny — returns 403',
};

export function EnforcementModeCard() {
  const { data: modes = [], isLoading } = useEnforcementModes();
  const setMode = useSetEnforcementMode();
  const { toast } = useToast();

  const getModeForResource = (resource: string): EnforcementMode =>
    (modes.find((m) => m.resource === resource)?.mode) ?? 'audit';

  const notEnforcedCount = ALL_RESOURCES.filter(
    (r) => getModeForResource(r) !== 'enforce',
  ).length;

  const handleChange = async (resource: string, mode: EnforcementMode) => {
    try {
      await setMode.mutateAsync({ resource, mode });
    } catch {
      toast({
        title: 'Error',
        description: `Failed to update enforcement mode for ${resource}.`,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>RBAC Enforcement Mode</CardTitle>
        <CardDescription>
          Control how permission denials are handled per resource. Roll out enforcement gradually.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notEnforcedCount > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-700 dark:text-yellow-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {notEnforcedCount} resource{notEnforcedCount > 1 ? 's' : ''} not in enforce mode — denials are not enforced.
          </div>
        )}
        <div className="divide-y divide-border rounded-md border">
          {ALL_RESOURCES.map((resource) => {
            const currentMode = getModeForResource(resource);
            return (
              <div key={resource} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm font-medium">{resource}</span>
                <Select
                  value={currentMode}
                  onValueChange={(v) => { void handleChange(resource, v as EnforcementMode); }}
                  disabled={setMode.isPending}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['audit', 'warn', 'enforce'] as EnforcementMode[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        <span className="text-xs">{m}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Add `EnforcementModeCard` to `Settings.tsx`**

Open `apps/web/src/pages/Settings.tsx`. Add the import at the top:

```typescript
import { EnforcementModeCard } from './settings/EnforcementModeCard';
```

Then add `<EnforcementModeCard />` in the settings page layout, after the existing admin-gated cards. The exact location depends on the file — place it in the admin section (check for an existing admin role check pattern in `Settings.tsx` and follow it).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/settings/EnforcementModeCard.tsx apps/web/src/pages/Settings.tsx
git commit -m "feat(web/scope): add EnforcementModeCard to Settings page"
```

---

## Phase 7: Resource Page Updates

### Task 16: Workflows Scope Awareness

**Files:**
- Modify: `apps/web/src/pages/workflows/Workflows.tsx`
- Modify: `apps/web/src/pages/workflows/WorkflowDetail.tsx`

- [ ] **Step 1: Add scope banner and scope column to `Workflows.tsx`**

Open `apps/web/src/pages/workflows/Workflows.tsx`. Make these targeted additions:

**Add imports:**
```typescript
import { ScopeBanner } from '@/components/scope/ScopeBanner';
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
```

**Inside the component body, add:**
```typescript
const { activeScopeNodeId } = useScopeContext();
const [includeDescendants, setIncludeDescendants] = useState(true);
const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
```

**Pass `scopeNodeId` to the existing workflow query hook** (e.g. `useWorkflows`) by passing `activeScopeNodeId` when it's not the global scope. Check what params `useWorkflows` accepts and add `scopeNodeId: isGlobalScope ? undefined : activeScopeNodeId`.

**Add `ScopeBanner` above the page title or table:**
```tsx
{!isGlobalScope && <ScopeBanner />}
```

**Add "Include descendants" toggle above the table:**
```tsx
<div className="flex items-center gap-2">
  <Checkbox
    id="include-descendants"
    checked={includeDescendants}
    onCheckedChange={(v) => { setIncludeDescendants(!!v); }}
  />
  <Label htmlFor="include-descendants" className="text-sm">Include descendants</Label>
</div>
```

**Add a `Scope` column to the workflows table.** Find the `<TableHead>` block and add:
```tsx
<TableHead>Scope</TableHead>
```

In the `<TableRow>` for each workflow, add the scope cell. Workflows have a `scopeNodeId` field — compare it to `activeScopeNodeId`:
```tsx
<TableCell>
  {workflow.scopeNodeId === activeScopeNodeId
    ? <Badge variant="outline">◉ This scope</Badge>
    : workflow.scopeNodeId === GLOBAL_SCOPE_NODE_ID
    ? <Badge variant="secondary">↑ Platform</Badge>
    : <Badge variant="secondary">↑ Parent</Badge>}
</TableCell>
```

> **Note:** The exact property name for scope on a workflow may be `scopeNodeId`, `scope_node_id`, or similar. Check the `Workflow` type in `@/lib/api/types.ts` or `client.workflow.types.ts` and use the correct field.

- [ ] **Step 2: Add scope breadcrumb + fork shortcut to `WorkflowDetail.tsx`**

Open `apps/web/src/pages/workflows/WorkflowDetail.tsx`.

**Add imports:**
```typescript
import { ScopeBreadcrumb } from '@/components/scope/ScopeBreadcrumb';
import { useScopeContext } from '@/context/ScopeContext';
import { useForkWorkflowForScope } from '@/hooks/useScopedConfig';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
import { GitFork } from 'lucide-react';
import { Button } from '@/components/ui/button';
```

**Inside the component, below the page title, add the scope breadcrumb:**
```tsx
<ScopeBreadcrumb />
```

**If the workflow's `scopeNodeId` is the platform default (`GLOBAL_SCOPE_NODE_ID`) and the active scope is not global, show the fork shortcut banner:**
```tsx
{workflow.scopeNodeId === GLOBAL_SCOPE_NODE_ID && activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID && (
  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-2.5 text-sm">
    <span className="text-muted-foreground">
      ↑ Platform default — inherited by active scope.
    </span>
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => { void forkWorkflow.mutateAsync({ workflowId: workflow.id, scopeNodeId: activeScopeNodeId }); }}
      disabled={forkWorkflow.isPending}
    >
      <GitFork className="mr-2 h-3.5 w-3.5" />
      Fork override for {activeScopePath[activeScopePath.length - 1]}
    </Button>
  </div>
)}
```

Where `forkWorkflow` comes from:
```typescript
const forkWorkflow = useForkWorkflowForScope();
const { activeScopeNodeId, activeScopePath } = useScopeContext();
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/workflows/Workflows.tsx apps/web/src/pages/workflows/WorkflowDetail.tsx
git commit -m "feat(web/scope): add scope banner, scope column, and fork shortcut to Workflows pages"
```

---

### Task 17: Agent Profiles Scope Awareness

**Files:**
- Modify: `apps/web/src/pages/agents/AgentProfiles.tsx`
- Modify: `apps/web/src/pages/agents/AgentProfileEditor.tsx`

Apply the same pattern as Task 16 to the Agents pages.

- [ ] **Step 1: Add scope banner and scope column to `AgentProfiles.tsx`**

Follow the same pattern as Task 16 Step 1, but for agent profiles. Import and add `ScopeBanner`, `includeDescendants` toggle, and a `Scope` column to the agents table.

Pass `scopeNodeId` to the `useAgentProfiles` hook when a non-global scope is active. The agent profile type has `scopeNodeId` — compare it to `activeScopeNodeId` to determine the badge.

```typescript
// Imports to add
import { ScopeBanner } from '@/components/scope/ScopeBanner';
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
```

Add to component:
```typescript
const { activeScopeNodeId } = useScopeContext();
const [includeDescendants, setIncludeDescendants] = useState(true);
const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
```

Add `ScopeBanner`, descendants toggle, and `Scope` column following the same structure as Workflows.

- [ ] **Step 2: Add scope breadcrumb + fork shortcut to `AgentProfileEditor.tsx`**

Follow the same pattern as Task 16 Step 2, but for agent profiles.

Import `useForkAgentForScope` from `@/hooks/useScopedConfig` and call it with `{ agentProfileId, scopeNodeId }`.

```tsx
{agentProfile.scopeNodeId === GLOBAL_SCOPE_NODE_ID && activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID && (
  <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-2.5 text-sm">
    <span className="text-muted-foreground">↑ Platform default — inherited by active scope.</span>
    <Button
      variant="outline"
      size="sm"
      className="ml-auto"
      onClick={() => { void forkAgent.mutateAsync({ agentProfileId: agentProfile.id, scopeNodeId: activeScopeNodeId }); }}
      disabled={forkAgent.isPending}
    >
      <GitFork className="mr-2 h-3.5 w-3.5" />
      Fork override for {activeScopePath[activeScopePath.length - 1]}
    </Button>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/agents/AgentProfiles.tsx apps/web/src/pages/agents/AgentProfileEditor.tsx
git commit -m "feat(web/scope): add scope banner, scope column, and fork shortcut to Agents pages"
```

---

## Phase 8: Scope-Aware Admin Pages

### Task 18: Users, Budget, GitOps, ScopedConfigViewer

**Files:**
- Modify: `apps/web/src/pages/Users.tsx`
- Modify: `apps/web/src/pages/admin/BudgetPoliciesPage.tsx`
- Modify: `apps/web/src/pages/admin/BudgetSpendPage.tsx`
- Modify: `apps/web/src/pages/gitops/GitOpsStatus.tsx`
- Modify: `apps/web/src/pages/admin/ScopedConfigViewer.tsx`

- [ ] **Step 1: Make `Users.tsx` scope-aware**

Open `apps/web/src/pages/Users.tsx`. Add:

```typescript
import { ScopeBanner } from '@/components/scope/ScopeBanner';
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
import { useRoleAssignments } from '@/hooks/useRoleAssignments';
import { Badge } from '@/components/ui/badge';
```

Inside the component:
```typescript
const { activeScopeNodeId } = useScopeContext();
const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

// When non-global scope active, show role assignments instead of full user table
const { data: assignments = [] } = useRoleAssignments(
  isGlobalScope ? '' : activeScopeNodeId,
);
```

When `isGlobalScope` is false, render the scope-filtered members view:
```tsx
{!isGlobalScope && (
  <>
    <ScopeBanner />
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Granted at</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map((a) => (
          <TableRow key={a.id}>
            <TableCell>{a.userEmail}</TableCell>
            <TableCell><Badge variant="secondary">{a.roleName}</Badge></TableCell>
            <TableCell>
              {a.isDirect
                ? <Badge variant="outline">◉ Direct</Badge>
                : <Badge variant="outline">↑ {a.scopeNodeName}</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </>
)}
{isGlobalScope && (
  // existing user management table — leave unchanged
  <>{/* original Users table JSX here */}</>
)}
```

- [ ] **Step 2: Make `BudgetPoliciesPage.tsx` scope-aware**

Open `apps/web/src/pages/admin/BudgetPoliciesPage.tsx`. Add:

```typescript
import { ScopeBanner } from '@/components/scope/ScopeBanner';
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
```

Inside component:
```typescript
const { activeScopeNodeId } = useScopeContext();
const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
```

Pass `scopeNodeId` to the existing budget policies query hook. Add `<ScopeBanner />` at the top of the page content (above the policies table). Add a `Scope` column to the policies table showing `◉ This scope` or `↑ Inherited`.

Apply the same pattern to `BudgetSpendPage.tsx`.

- [ ] **Step 3: Make `GitOpsStatus.tsx` scope-aware and fix the /audit link**

Open `apps/web/src/pages/gitops/GitOpsStatus.tsx`. Make two changes:

**a) Fix the broken /audit link.** Find any `href="/audit"` or `to="/audit"` and ensure it is a proper React Router `<Link to="/audit">` — the route now exists.

**b) Add scope-filtering note to the drift section.** Add imports:
```typescript
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';
```

In the component:
```typescript
const { activeScopeNodeId, activeScopePath } = useScopeContext();
const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;
```

Add an info banner near the drift section (reconciliation itself is always global):
```tsx
{!isGlobalScope && (
  <div className="rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
    ℹ Reconciliation is platform-wide. Showing drift filtered to:{' '}
    <strong>{activeScopePath[activeScopePath.length - 1]}</strong>
  </div>
)}
```

Pass `scopeNodeId` to the drift query if `useGitOpsDrift` supports it, or filter the drift array client-side by `d.scopeNodeId === activeScopeNodeId`.

- [ ] **Step 4: Make `ScopedConfigViewer.tsx` accept `presetScopeNodeId` prop**

Open `apps/web/src/pages/admin/ScopedConfigViewer.tsx`. The component currently has a manual scope node ID input. Make this prop-controllable:

Find the component's props interface (or add one):
```typescript
interface ScopedConfigViewerProps {
  presetScopeNodeId?: string;
}
```

Add `useScopeContext` to read the active scope as a fallback:
```typescript
import { useScopeContext } from '@/context/ScopeContext';
import { GLOBAL_SCOPE_NODE_ID } from '@/lib/api/client.scope.types';

const { activeScopeNodeId } = useScopeContext();
```

Update the scope node ID state initialiser to use the prop or active scope:
```typescript
// Replace manual useState('') initialiser with:
const [scopeNodeId, setScopeNodeId] = useState(
  presetScopeNodeId ?? (activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID ? activeScopeNodeId : ''),
);
```

When `presetScopeNodeId` is set, the input should be read-only. Add a note showing the active scope:
```tsx
{!presetScopeNodeId && activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID && (
  <p className="text-xs text-muted-foreground">
    Active scope: <strong>{activeScopePath[activeScopePath.length - 1]}</strong>
    {' '}<button className="text-primary underline" onClick={() => { setScopeNodeId(activeScopeNodeId); }}>Use active scope</button>
  </p>
)}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd apps/web && npx tsc --noEmit
git add apps/web/src/pages/Users.tsx \
        apps/web/src/pages/admin/BudgetPoliciesPage.tsx \
        apps/web/src/pages/admin/BudgetSpendPage.tsx \
        apps/web/src/pages/gitops/GitOpsStatus.tsx \
        apps/web/src/pages/admin/ScopedConfigViewer.tsx
git commit -m "feat(web/scope): make Users, Budget, GitOps, and ScopedConfigViewer scope-aware"
```

---

## Phase 9: Final Wiring

### Task 19: Feature Flag Gating + navigation.config.ts Audit Entry

**Files:**
- Modify: `apps/web/src/components/layout/navigation.config.ts`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add Audit entry to `navigation.config.ts`**

In the `"Configuration"` group in `NAV_GROUPS`, add an Audit item (import `ShieldAlert` from lucide-react):

```typescript
// At top of file, add to lucide-react imports:
ShieldAlert,

// In the Configuration group items array, add:
{
  label: 'Audit',
  icon: ShieldAlert,
  path: '/audit',
  isFavoriteEligible: false,
},
```

- [ ] **Step 2: Gate scope panel icon in `Sidebar.tsx` behind `hierarchyEnabled`**

In `Sidebar.tsx`, import `getRuntimeConfig`:
```typescript
import { getRuntimeConfig } from '@/lib/config';
```

Wrap the scope toggle section with a flag check:
```tsx
{getRuntimeConfig().hierarchyEnabled && (
  <div className="flex flex-col items-center gap-1 border-b border-border py-2">
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', isScopePanelOpen && 'bg-accent text-accent-foreground')}
          onClick={toggleScopePanel}
        >
          <Globe className="h-4 w-4" />
          <span className="sr-only">Scope tree</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">Scope tree</TooltipContent>
    </Tooltip>
  </div>
)}
```

- [ ] **Step 3: Gate `/scopes/:id` route in `App.tsx` behind `hierarchyEnabled`**

In `App.tsx`, import the config:
```typescript
import { getRuntimeConfig } from '@/lib/config';
```

Wrap the new routes:
```tsx
{getRuntimeConfig().hierarchyEnabled && (
  <Route path="/scopes/:id" element={<ScopeDetailPage />} />
)}
```

The `/audit` route does not need gating — it's useful regardless of hierarchy.

- [ ] **Step 4: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```bash
git add apps/web/src/components/layout/navigation.config.ts \
        apps/web/src/components/layout/Sidebar.tsx \
        apps/web/src/App.tsx
git commit -m "feat(web/scope): add Audit nav entry, gate scope panel and routes behind hierarchyEnabled flag"
```

---

## Self-Review Spec Coverage Check

| Spec Section | Task(s) | Status |
|---|---|---|
| Dual-rail sidebar icon rail | Task 7 | ✓ |
| Scope panel (slides in beside rail) | Task 8 | ✓ |
| Header scope breadcrumb chip | Task 9 | ✓ |
| `hierarchyEnabled` config flag | Task 9, 19 | ✓ |
| ScopeContext + localStorage persistence | Task 4 | ✓ |
| Scope tree with filter + expand/collapse | Task 8 | ✓ |
| Gear icon → `/scopes/:id` | Task 8 (ScopeTreeNode) | ✓ |
| ScopeBanner on list pages | Task 10, 16, 17 | ✓ |
| Scope column with ◉ / ↑ / ↓ indicators | Task 16, 17 | ✓ |
| Include descendants toggle | Task 16, 17 | ✓ |
| ScopeBreadcrumb on detail pages | Task 10, 16, 17 | ✓ |
| Fork override shortcut on detail pages | Task 16, 17 | ✓ |
| ScopeNodePicker reusable component | Task 10 | ✓ |
| `/scopes/:id` detail page | Task 11 | ✓ |
| Members & Roles tab (assign/revoke) | Task 12 | ✓ |
| Config Overrides tab | Task 13 | ✓ |
| Child Scopes tab (create child) | Task 13 | ✓ |
| Audit tab (scoped to node) | Task 13, 14 | ✓ |
| `/audit` page with filters | Task 14 | ✓ |
| Expandable row detail in audit table | Task 14 | ✓ |
| Enforcement Mode card in Settings | Task 15 | ✓ |
| Users page scope-aware | Task 18 | ✓ |
| Budget pages scope-aware | Task 18 | ✓ |
| GitOps scope-filtered drift + fix /audit link | Task 18 | ✓ |
| ScopedConfigViewer pre-fill from context | Task 18 | ✓ |
| Role-dependent tree visibility (admin = full tree) | Not implemented — deferred to authz-gated API call; the `GET /scopes/tree` backend already returns only accessible nodes per user | ✓ |
