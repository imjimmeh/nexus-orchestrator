# EPIC-051: Runtime Agent Factory for CEO Orchestration

> Status: Proposed
> Priority: High
> Estimate: 4-7 weeks
> Created: 2026-04-05
> Owner: TBD

---

## 1. Epic Summary

Add a first-class Agent Factory capability so the CEO agent can create specialized AgentProfile records at runtime, including system prompt and allowed tool set, with governance controls equivalent to other mutating orchestration actions.

This closes the current gap where agent profiles can be created manually by admins but cannot be safely authored by orchestration flows.

---

## 2. Codebase Review Findings

### 2.1 What already exists

1. Agent profiles are persisted in `agent_profiles` and support `system_prompt`, `tier_preference`, `allowed_tools`, model/provider mapping, and active flag.
2. Startup seeding is static and idempotent via `apps/api/src/database/seeds/agent-profiles/agent-profile-seed.service.ts` and profile definitions in `apps/api/src/database/seeds/agent-profiles/profiles/*`.
3. Admin CRUD already exists via:
   - API controller: `apps/api/src/ai-config/controllers/agent-profiles.controller.ts`
   - Admin service: `apps/api/src/ai-config/ai-config-admin.service.ts`
   - Web UI: `apps/web/src/pages/agents/AgentProfiles.tsx` and `apps/web/src/pages/agents/AgentProfileForm.tsx`
4. Runtime tool execution already supports orchestration actions through capability manifests and workflow runtime endpoints.

### 2.2 Why this does not satisfy the idea yet

1. CEO toolset does not include a profile creation capability.
2. Orchestration mutating action governance currently covers only:
   - `kanban.dispatch_selected_work_items`
   - `invoke_agent_workflow`
   - `update_project_strategy`
   - `complete_orchestration`
3. Capability manifests and runner bridge schemas do not include an Agent Factory action.
4. Profile provenance is not captured (no explicit source/creator metadata).

### 2.3 Key technical constraint discovered

If a profile has no `allowed_tools`, runtime falls back to static IAM profile mapping (`apps/api/src/security/iam-policy.service.ts`). Unknown dynamic profile names are denied. Agent Factory must always persist an explicit allowed tool list (or an approved wildcard policy) to avoid unusable profiles.

---

## 3. Problem Statement

The platform currently assumes seeded or manually-administered agent profiles. That blocks autonomous orchestration patterns where CEO identifies a narrow, temporary specialization and creates an appropriate profile in the same orchestration loop.

Without runtime profile creation:

1. CEO cannot encode emergent specialist roles as executable profiles.
2. Prompt/tool-profile drift is handled manually.
3. Supervised mode cannot approve or reject profile-creation intent as a governed mutation.

---

## 4. Goals

1. Enable CEO to create runtime agent profiles with:
   - name
   - system prompt
   - tier preference
   - allowed tools
   - optional model/provider override
2. Treat profile creation as a governed mutating orchestration action.
3. Prevent privilege escalation through strict capability/tool validation.
4. Persist provenance for audit and operational review.
5. Make new profiles immediately discoverable by runtime execution and admin UI.

---

## 5. Non-Goals

1. Replacing seeded profile model.
2. Allowing arbitrary code/tool registration via profile creation.
3. Building a full profile lifecycle automation engine (versioning, expiry, archival policies) in this epic.
4. Reworking all existing CEO workflows at once.

---

## 6. Proposed Architecture

### 6.1 Introduce Agent Factory as runtime capability

Add a new capability `create_agent_profile` as an API-callback runtime tool (same pattern as other orchestration runtime tools), rather than websocket-only custom handling.

Rationale:

1. Reuses existing workflow runtime controller + auth model (`Agent` role allowed).
2. Keeps contract in capability manifest and preflight checks.
3. Reduces bridge/gateway drift risk.

### 6.2 Add governed mutating action

Extend orchestration mutating action domain to include `create_agent_profile` so supervised mode can queue approval and notifications-only mode can deny, consistent with existing policy semantics.

### 6.3 Add Agent Factory service and validation layer

Create dedicated service (suggested: `AgentFactoryService`) to validate and persist runtime-created profiles.

Validation rules:

1. Enforce non-empty and normalized name.
2. Reserve seeded profile names and protected prefixes.
3. Enforce explicit `allowed_tools` list (no implicit/null tool policy).
4. Validate each tool against capability catalog/tool registry.
5. Restrict wildcard `*` based on policy (default deny for factory-generated profiles).
6. Apply prompt length and basic sanitization constraints.
7. Validate provider/model existence when provided.

### 6.4 Add profile provenance metadata

Add provenance fields to `agent_profiles` so operators can distinguish seeded/admin/factory profiles.

Suggested columns:

1. `source` (`seeded`, `admin`, `agent_factory`)
2. `created_by_profile` (nullable)
3. `created_by_workflow_run_id` (nullable)
4. `factory_context` (jsonb nullable, optional)

### 6.5 Update CEO profile and prompts

Update `ceo-agent` profile seed and prompt guidance to include controlled usage of `create_agent_profile`, including when to prefer existing profiles and when to create a specialist.

### 6.6 UI and observability

1. Surface provenance in Agents page.
2. Emit event ledger/audit events for creation attempts and outcomes.
3. Add diagnostics payloads for denied creation requests.

---

## 7. Workstreams

### Workstream A: Types, policy, and contracts

1. Extend mutating action unions/types:
   - `apps/api/src/project/project-orchestration.service.types.ts`
   - `apps/api/src/project/project-orchestration-mode-policy.service.ts`
   - `apps/api/src/tool/capability-manifest.types.ts`
   - `apps/api/src/tool/capability-preflight.service.ts`
2. Add `create_agent_profile` capability entry:
   - `apps/api/src/tool/capability-manifest.runtime.entries.ts`
   - `apps/api/src/tool/capability-catalog.ts`

### Workstream B: Runtime orchestration endpoint

1. Add runtime endpoint for Agent Factory action:
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
2. Add orchestration action service method:
   - `apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts`
3. Integrate with `processMutatingAction` execution path.

### Workstream C: Agent Factory persistence and validation

1. Implement `AgentFactoryService` (new file under `apps/api/src/ai-config/services/` or `apps/api/src/project/`).
2. Add repository support helpers if needed:
   - `apps/api/src/database/repositories/agent-profile.repository.ts`
3. Add migration for provenance columns in `agent_profiles`.

### Workstream D: CEO enablement

1. Update CEO seeded profile tool list:
   - `apps/api/src/database/seeds/agent-profiles/profiles/ceo.profile.ts`
2. Update workflow prompts where CEO is expected to create specialist agents (selectively, not globally).

### Workstream E: Web and API typing

1. Add provenance fields in web API types:
   - `apps/web/src/lib/api/types.ts`
2. Add provenance column/badges in:
   - `apps/web/src/pages/agents/AgentProfiles.tsx`
   - `apps/web/src/pages/agents/AgentProfileForm.tsx` (read-only display for provenance on edit)

### Workstream F: Runner bridge parity (if keeping nexus_orchestrator action path)

If product decides to expose Agent Factory through `nexus_orchestrator` action instead of standalone capability, also update:

1. `packages/pi-runner/src/nexus-bridge-tools.ts`
2. `packages/pi-runner/src/nexus-bridge-tools.spec.ts`
3. `apps/api/src/tool/capability-manifest.execution.entries.ts`
4. `apps/api/src/telemetry/telemetry.gateway.ts`

Preferred default for this epic: standalone `create_agent_profile` API-callback capability to avoid this workstream unless explicitly required.

---

## 8. Delivery Phases

### Phase 1 (Week 1-2): Contract and governance foundation

1. Extend mutating action policy/types to include `create_agent_profile`.
2. Add capability manifest entry and preflight compatibility updates.
3. Add failing tests for unsupported/denied creation scenarios.

### Phase 2 (Week 2-4): Runtime create flow

1. Implement Agent Factory service and orchestration action execution path.
2. Add endpoint and payload contract.
3. Add migration for provenance metadata.
4. Add event/audit emission.

### Phase 3 (Week 4-5): CEO + UX integration

1. Enable CEO profile capability and prompt guidance.
2. Add web provenance visibility.
3. Add deterministic integration coverage (CEO creates profile then runtime resolves and uses it).

### Phase 4 (Week 5-7): Hardening

1. Add limiters (name/prompt length, profile count per project/day).
2. Add reserved-name conflict handling and better remediation messages.
3. Add rollout flag and operational runbook.

---

## 9. Testing Strategy

### 9.1 Unit tests

1. `AgentFactoryService` validation matrix:
   - valid creation
   - duplicate name
   - reserved name
   - invalid tool names
   - wildcard policy violation
   - missing allowed_tools
2. Orchestration mode behavior for `create_agent_profile`:
   - autonomous executes
   - supervised queues approval
   - notifications_only denies

### 9.2 Integration tests (API)

1. Runtime endpoint executes and persists profile with provenance.
2. Supervised mode queues action request and executes on approval.
3. Profile appears in agent profile list endpoint.

### 9.3 Runner/flow tests

1. CEO workflow can call `create_agent_profile` successfully.
2. Newly created profile is selectable by subsequent runtime execution path.
3. Denial path emits actionable structured response.

### 9.4 Regression coverage

1. Existing seeded profile behavior unchanged.
2. Existing admin profile CRUD behavior unchanged.
3. Capability preflight output remains deterministic.

---

## 10. Acceptance Criteria

1. CEO can create a new profile at runtime using a supported capability.
2. Created profile contains explicit allowed tools and is immediately usable in runtime resolution.
3. Supervised mode requires approval before profile creation execution.
4. Notifications-only mode denies profile creation with recommendation payload.
5. Provenance fields are persisted and visible in API/web list output.
6. Security checks prevent unauthorized tool escalation and reserved profile overrides.
7. E2E path proves creation plus downstream use in a single orchestrated scenario.

---

## 11. Risks and Mitigations

1. Risk: Privilege escalation via broad tool assignment.
   - Mitigation: allowlist validation against capability catalog, wildcard restrictions, policy gate.
2. Risk: Seed profile collision and startup overwrite.
   - Mitigation: reserved-name policy and source metadata.
3. Risk: Contract drift across capability manifest, runtime endpoint, and prompts.
   - Mitigation: contract parity tests and CI checks.
4. Risk: Unbounded profile growth.
   - Mitigation: rate limits, per-project caps, optional TTL/archive follow-up epic.

---

## 12. Open Decisions

1. Should runtime-created profiles be global or logically project-scoped with ownership metadata?
2. Should wildcard `*` ever be permitted for factory-created profiles in production?
3. Should this ship only as API-callback capability, or also as `nexus_orchestrator` bridge action for prompt simplicity?
4. Should profile updates/deactivation be included now (`update_agent_profile`, `deactivate_agent_profile`) or follow in a separate epic?

---

## 13. Definition of Done

1. All tests for this epic pass in API and runner packages.
2. Deterministic integration flow demonstrates end-to-end Agent Factory behavior.
3. Documentation updated (README + architecture notes + API contracts).
4. Feature flag/rollout notes documented for operations.
