# EPIC-107: Frontend Memory Visibility and Exploration

Status: Proposed
Priority: P1
Depends On: EPIC-061, EPIC-084, EPIC-025
Last Updated: 2026-04-16

---

## 1. Summary

Expose durable memory segments in the web UI so operators can inspect what the system has learned across project, user, and system/shared scopes, search and filter memory content, and trace promoted lessons from learning runs.

This epic adds read-first memory visibility to the Project Workspace and to broader frontend memory explorer surfaces, aligned with the existing memory backend abstraction (postgres, honcho, dual).

---

## 2. Problem

Memory exists in backend services and runtime tools, but there is no dedicated frontend surface for browsing memory segments.

Current gaps:

1. no user-facing endpoint for memory segment exploration,
2. no project-scoped memory view in the Project Workspace,
3. no dedicated user memory or system/shared memory frontend surface,
4. limited observability from promoted learning candidates to stored memory artifacts.

---

## 3. Goals

1. Add web-facing APIs to list and search memory segments for project, user, and system/shared contexts.
2. Add a new Memory tab in Project Workspace for project-scoped memory.
3. Add frontend page(s) for user memory and system/shared memory exploration.
4. Make memory type, version, scope, and timestamps visible for operational review.
5. Preserve compatibility with memory backend mode switching.
6. Add test coverage for API contracts, hooks, and UI states.

## 4. Non-Goals

1. Autonomous or unrestricted editing/deletion of memories in v1.
2. Replacing the Learning tab candidate/proposal governance flow.
3. Introducing new memory storage backends.
4. Building fine-grained per-user self-service privacy controls in this first pass.

---

## 5. Architecture

### 5.1 API Surface (Read-Only v1)

Add read-only memory endpoints for the supported frontend scopes:

1. GET /projects/:projectId/memory/segments
   - Query: `memory_type?`, `query?`, `limit?`, `offset?`
   - Response: paginated list of memory segments with metadata.
2. GET /users/:userId/memory/segments
   - Query: `memory_type?`, `query?`, `limit?`, `offset?`
   - Response: paginated list of user memory segments with metadata.
3. GET /memory/system/segments
   - Query: `memory_type?`, `query?`, `entity_id?`, `limit?`, `offset?`
   - Response: paginated list of system/shared memory segments with metadata.

### 5.2 Service Boundary

Controllers delegate to scope-specific frontend-facing services, which delegate to `MemoryManagerService`.

Constraints:

1. no direct repository coupling in controller,
2. backend mode behavior remains controlled by `MemoryManagerService` and backend factory,
3. result shape remains consistent with current runtime memory semantics,
4. scope mapping remains explicit (`Project`, `User`, `System`) rather than inferred implicitly in the UI.

### 5.3 Frontend Integration

1. Extend API client methods for project memory retrieval.
2. Extend API client methods for user and system/shared memory retrieval.
3. Add `useProjectMemorySegments`, `useUserMemorySegments`, and `useSystemMemorySegments` hooks with filter-aware query keys.
4. Add `MemoryTab` under Project Workspace tabs.
5. Add global/frontend page(s) for user memory and system/shared memory exploration.
6. Render list/table with:
   - search input,
   - scope indicator where relevant,
   - memory type filter,
   - pagination controls,
   - segment details (content preview, version, created/updated timestamps).

### 5.4 Security and Access

1. Gate endpoints with existing auth and role guards.
2. Restrict to Admin and Developer roles initially.
3. Reuse existing audit/event practices for sensitive read paths where applicable.
4. Treat user-memory access as privileged operational access, not public profile data.

---

## 6. Workstreams

1. API contracts and DTOs for project, user, and system/shared memory listing/search.
2. Scope-specific controller/service implementation over `MemoryManagerService`.
3. Frontend API methods, hooks, and query invalidation strategy.
4. Project Workspace Memory tab for project scope.
5. User memory and system/shared memory frontend explorer pages.
6. Unit and integration tests for API and web layers.
7. Documentation updates and rollout notes.

---

## 7. Backlog

- [ ] E107-001 Define memory segments API contract and response type in shared web/api typings.
- [ ] E107-002 Implement `GET /projects/:projectId/memory/segments` controller endpoint with validated query DTO.
- [ ] E107-003 Implement `GET /users/:userId/memory/segments` controller endpoint with validated query DTO.
- [ ] E107-004 Implement `GET /memory/system/segments` controller endpoint with validated query DTO.
- [ ] E107-005 Implement scope-specific memory service adapters over `MemoryManagerService` with pagination.
- [ ] E107-006 Add API client methods and request/response types in web client.
- [ ] E107-007 Implement `useProjectMemorySegments`, `useUserMemorySegments`, and `useSystemMemorySegments` hooks with filter/pagination query keys.
- [ ] E107-008 Add Project Workspace `Memory` tab and list/search/filter UI components for project scope.
- [ ] E107-009 Add user memory frontend page/panel for privileged operators.
- [ ] E107-010 Add system/shared memory frontend page/panel for privileged operators.
- [ ] E107-011 Add API unit/controller tests for auth, validation, and filtering behavior across all scopes.
- [ ] E107-012 Add frontend unit tests for loading, empty, error, filtering, and pagination interactions across all memory views.
- [ ] E107-013 Add docs update for memory visibility, scope boundaries, and operator usage.

---

## 8. Acceptance Criteria

1. Users with authorized roles can view project memory segments in the Project Workspace UI.
2. Users with authorized roles can view user memory segments in a dedicated frontend memory page/panel.
3. Users with authorized roles can view system/shared memory segments in a dedicated frontend memory page/panel.
4. UI supports search by query text and filtering by memory type across all supported scopes.
5. Results are paginated and include `id`, `content`, `memory_type`, `version`, `created_at`, and `updated_at`.
6. API/controller and web tests for touched behavior pass.
7. Existing learning-memory flows remain unchanged and functional.

---

## 9. Risks and Mitigation

1. Sensitive content exposure in memory text.
   - Mitigate with strict role gating and no broader role rollout in v1.
2. Large memory sets causing slow page loads.
   - Mitigate with server pagination and sensible default limits.
3. Backend inconsistency across memory modes.
   - Mitigate by routing reads through `MemoryManagerService` abstraction only.
4. Confusion between user, project, and system/shared scopes in frontend UX.
   - Mitigate with explicit scope labeling and separate entry points for project vs global memory exploration.

---

## 10. Delivery Plan

1. Milestone A: Project, user, and system/shared backend endpoints and tests.
2. Milestone B: Project Workspace Memory tab and project-scope UI tests.
3. Milestone C: User memory and system/shared memory frontend pages plus tests.
4. Milestone D: Documentation and polish.
5. Milestone E: Validation (lint + targeted unit tests).
