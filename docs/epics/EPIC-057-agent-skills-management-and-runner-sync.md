# EPIC-057: Agent Skills Management, Assignment, and Runner Sync

> Status: Implemented (v1 shipped)  
> Priority: High  
> Estimate: 4-6 weeks  
> Created: 2026-04-06  
> Last Updated: 2026-04-06  
> Owner: TBD

---

## 1. Epic Summary

Implement first-class Agent Skills support so the platform can:

1. Create, edit, and persist skills in the application.
2. Assign one or more skills to agent profiles.
3. Materialize assigned skills into runner containers when an agent job starts.

This epic introduces a complete skill lifecycle across Web UI, API, database, workflow runtime, and container provisioning.

### 1.1 Implementation Snapshot (2026-04-06)

Implemented in current codebase:

1. Skill persistence model with entities/repositories/migration for skills and profile assignments.
2. Admin/API surfaces for skill CRUD and profile-skill assignment replacement.
3. Web management UI for skill authoring (`/agent-skills`) and profile assignment controls.
4. Runtime skill mounting (`SkillMountingService`) with per-execution materialization to `/opt/pi-runner/skills`.
5. Parent and subagent execution parity for skill mounts in container provisioning paths.
6. Prompt augmentation so agents can discover assigned skills and load `SKILL.md` on demand.
7. Test coverage across API services/controllers, mounting behavior, and Web client/hooks/components.

---

## 2. Request Coverage Mapping

The implementation plan explicitly covers the requested outcomes:

1. Edit and store skills in the app:
   - New skill CRUD APIs and DB entities.
   - New Web UI skill authoring/editor workflow.
2. Assign skills to agents:
   - New profile-to-skill assignment relation and management UX.
   - Runtime retrieval by assigned profile.
3. Copy skills to runner container on startup:
   - New skill mount preparation service.
   - Step and subagent container provisioning updates to mount assigned skills into container filesystem before execution.

---

## 3. External Research Summary (Agent Skills Standard)

Research source:

- https://agentskills.io/home
- https://agentskills.io/what-are-skills
- https://agentskills.io/specification
- https://agentskills.io/client-implementation/adding-skills-support
- https://github.com/agentskills/agentskills

Key findings relevant to this codebase:

1. Progressive disclosure is core:
   - Catalog at startup (name + description).
   - Full `SKILL.md` loaded only when relevant.
   - Resources loaded on demand.
2. Skill directory contract:
   - Required: `SKILL.md`.
   - Optional: `scripts/`, `references/`, `assets/`.
3. `SKILL.md` frontmatter minimum:
   - Required: `name`, `description`.
   - Optional: `license`, `compatibility`, `metadata`, `allowed-tools`.
4. Compatibility guidance for hosted/sandboxed agents:
   - Project skills can travel with repo.
   - User/org skills must be provisioned from API, registry, or uploaded assets.
5. Deterministic collision precedence is recommended:
   - Project-level overrides user-level.
6. Trust and safety are explicit concerns:
   - Untrusted project skills should be gated by trust checks.

Implication for Nexus:

- We should implement skills in a way that supports progressive disclosure and portability while preserving existing governance controls (RBAC, policy checks, runtime bounds).

---

## 4. Current-State Codebase Analysis

### 4.1 Existing foundation we can reuse

1. Agent profile persistence and CRUD already exist:
   - `apps/api/src/database/entities/agent-profile.entity.ts`
   - `apps/api/src/database/repositories/agent-profile.repository.ts`
   - `apps/api/src/ai-config/controllers/agent-profiles.controller.ts`
   - `apps/api/src/ai-config/ai-config-admin.service.ts`
   - `apps/web/src/pages/agents/AgentProfiles.tsx`
   - `apps/web/src/pages/agents/AgentProfileForm.tsx`
2. Runtime profile resolution and step config precedence are already implemented:
   - `apps/api/src/ai-config/ai-configuration.service.ts`
   - `apps/api/src/workflow/step-support.service.ts`
   - `apps/api/src/workflow/step-agent-step-executor.helpers.ts`
3. Runtime mount pipeline exists for tools:
   - `apps/api/src/tool/tool-mounting.service.ts`
   - `apps/api/src/workflow/step-agent-step-executor.service.ts`
   - `apps/api/src/docker/container-orchestrator.service.ts`
   - Runner reads mounted tool extensions at `/opt/pi-runner/extensions`:
     - `packages/pi-runner/src/session-factory.ts`
     - `packages/pi-runner/src/config.ts`
4. Runtime orchestration tooling already supports profile discovery and profile creation:
   - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
   - `apps/api/src/workflow/workflow-runtime-orchestration-actions.service.ts`
   - `apps/api/src/ai-config/services/agent-factory.service.ts`

### 4.2 Gaps blocking Agent Skills

1. No skill domain model (entity/repository/migration) exists.
2. No skill CRUD or assignment API exists.
3. No skill UI exists for authoring or assignment.
4. No runtime step/subagent path resolves assigned skills.
5. No runner/container mount target for skills exists.
6. No standard skill activation guidance is appended to runtime prompts.

### 4.3 Relevant constraints and pitfalls discovered

1. IAM + profile permission behavior:
   - Tool mounting enforces `IAMPolicyService` in addition to DB `allowed_tools`.
   - Unknown profile names are denied by IAM map fallback.
2. Nested Docker host path remapping currently includes dedicated logic for tool mounts only:
   - `resolveDockerToolMountHostPath` in `apps/api/src/docker/container-orchestrator.service.ts`.
3. Subagent path separately provisions containers and runner config:
   - `apps/api/src/workflow/subagent-orchestrator.service.ts`.
   - Must be included in runtime sync plan or subagents will miss assigned skills.
4. Existing API model precedence must be preserved:
   - step override -> profile -> DB defaults -> env fallback.

---

## 5. Product Scope and Non-Goals

### 5.1 Scope (v1)

1. Skill authoring and storage in app.
2. Agent-profile assignment of skills.
3. Skill bundle materialization into runner container at job/subagent start.
4. Skill catalog visibility to agent runtime through prompt augmentation.
5. Governance and validation for safe skill ingestion.

### 5.2 Non-goals (v1)

1. Full external skill marketplace.
2. Remote skill package registries.
3. Cross-project org/global scopes with tenant RBAC partitioning.
4. Automatic skill execution sandbox for arbitrary scripts (scripts are packaged resources, not auto-executed).

---

## 6. Proposed Target Architecture

### 6.1 Data model

Use a reusable skill catalog plus assignment relation.

1. `agent_skills`
   - Identity, metadata, `SKILL.md` content, active flag, versioning fields.
2. `agent_profile_skills`
   - Many-to-many assignment table from profile to skill.
3. Optional revision table (recommended in this epic)
   - `agent_skill_revisions` for immutable edit history and rollback.

Reasoning:

1. Skills should be reusable across multiple profiles.
2. Assignment changes should not duplicate content rows.
3. Versioning should be auditable and reversible.

### 6.2 Runtime skill packaging model

At container startup:

1. Resolve assigned active skills by agent profile.
2. Build mounted skill directory per execution mount key.
3. Materialize each assigned skill as:
   - `<mount-root>/<skill-name>/SKILL.md`
   - Optional bundled files (scripts/references/assets) when present.
4. Generate catalog file:
   - `<mount-root>/skill-catalog.json` with `name`, `description`, and absolute location.

Recommended container path:

- `/opt/pi-runner/skills`

### 6.3 Agent runtime behavior

To make skills usable (not only copied):

1. Add concise skill catalog section into resolved system prompt at run start.
2. Include behavior instruction:
   - When task matches a skill, read corresponding `SKILL.md` from mounted path before execution.
3. Keep full skill content out of initial prompt by default (progressive disclosure).

Optional enhancement:

- Add dedicated runtime tool `activate_skill` that returns wrapped skill body and resource list for deterministic activation.

### 6.4 Subagent parity

Subagents must receive the same assignment-derived skill mounts as parent execution jobs.

If omitted, behavior diverges between main execution and delegated work.

---

## 7. Detailed Implementation Plan

### Phase 1: Schema and Persistence

1. Add new entities:
   - `apps/api/src/database/entities/agent-skill.entity.ts`
   - `apps/api/src/database/entities/agent-profile-skill.entity.ts`
   - Optional: `apps/api/src/database/entities/agent-skill-revision.entity.ts`
2. Register entities in:
   - `apps/api/src/database/database.module.ts`
   - `apps/api/src/database/entities/index.ts`
3. Add repositories:
   - `apps/api/src/database/repositories/agent-skill.repository.ts`
   - `apps/api/src/database/repositories/agent-profile-skill.repository.ts`
4. Export repositories in:
   - `apps/api/src/database/repositories/index.ts`
5. Add migration:
   - `apps/api/src/database/migrations/<timestamp>-create-agent-skills-and-assignments.ts`

Suggested columns (v1):

1. `agent_skills`
   - `id` uuid PK
   - `name` varchar(64) unique and normalized
   - `description` varchar(1024)
   - `skill_markdown` text (full `SKILL.md` payload)
   - `compatibility` varchar(500) nullable
   - `metadata` jsonb nullable
   - `source` varchar(32) (`admin` | `agent_factory` | `imported`)
   - `created_by_profile` varchar(128) nullable
   - `created_by_workflow_run_id` varchar nullable
   - `version` int default 1
   - `is_active` boolean default true
   - timestamps
2. `agent_profile_skills`
   - `id` uuid PK
   - `agent_profile_id` uuid FK -> `agent_profiles(id)` cascade delete
   - `skill_id` uuid FK -> `agent_skills(id)` restrict/cascade by policy
   - `assignment_order` int default 0
   - timestamps
   - unique `(agent_profile_id, skill_id)`

### Phase 2: API and Validation

1. Add DTOs:
   - `apps/api/src/ai-config/dto/skills/create-skill.dto.ts`
   - `apps/api/src/ai-config/dto/skills/update-skill.dto.ts`
   - `apps/api/src/ai-config/dto/skills/assign-profile-skills.dto.ts`
2. Add service layer:
   - `apps/api/src/ai-config/services/agent-skills.service.ts`
3. Add controller:
   - Option A: extend `apps/api/src/ai-config/controllers/agent-profiles.controller.ts`
   - Option B: add `apps/api/src/ai-config/controllers/agent-skills.controller.ts`
4. Register service/controller in:
   - `apps/api/src/ai-config/ai-config.module.ts`

Recommended endpoints:

1. `GET /api/ai-config/skills`
2. `GET /api/ai-config/skills/:id`
3. `POST /api/ai-config/skills`
4. `PATCH /api/ai-config/skills/:id`
5. `DELETE /api/ai-config/skills/:id`
6. `GET /api/ai-config/agent-profiles/:id/skills`
7. `PUT /api/ai-config/agent-profiles/:id/skills` (replace assignment set)

Validation rules:

1. `name` constraints aligned with Agent Skills spec (1-64, lowercase + hyphen pattern).
2. `description` non-empty and max 1024.
3. `skill_markdown` must include YAML frontmatter with required fields (`name`, `description`).
4. Frontmatter `name` must match entity `name` and parent logical skill path.
5. Size limits:
   - `skill_markdown` <= configured max (for example 20KB initial).
6. Reject path traversal in any referenced resource paths.

### Phase 3: Web App UX

1. Add new API types in:
   - `apps/web/src/lib/api/types.ts`
2. Add client methods in:
   - `apps/web/src/lib/api/client.ts`
3. Add hooks:
   - `apps/web/src/hooks/useAgentSkills.ts`
4. Add UI components/pages:
   - `apps/web/src/pages/agents/AgentSkills.tsx` (new)
   - `apps/web/src/pages/agents/SkillEditor.tsx` (new)
   - Extend profile UI:
     - `apps/web/src/pages/agents/AgentProfiles.tsx`
     - `apps/web/src/pages/agents/AgentProfileForm.tsx`

UX requirements:

1. Skill list with status/version/source.
2. Skill editor with markdown body and frontmatter helper.
3. Assignment multiselect in profile form (ordered list optional).
4. Inline validation error display for malformed frontmatter.
5. Safe delete flow with assignment impact warning.

### Phase 4: Runtime Mount and Sync

1. Add skill mounting service:
   - `apps/api/src/tool/skill-mounting.service.ts`
2. Register provider in:
   - `apps/api/src/tool/tool.module.ts`
3. Update step execution container path:
   - `apps/api/src/workflow/step-agent-step-executor.service.ts`
   - Resolve assigned skills before container provision.
   - Add skills volume mount.
4. Update subagent path:
   - `apps/api/src/workflow/subagent-orchestrator.service.ts`
5. Add assignment resolution helper:
   - `apps/api/src/workflow/step-support.service.ts`

Host path remapping considerations:

1. If skill mount base differs from tool base, extend remapping in:
   - `apps/api/src/docker/container-orchestrator.service.ts`
2. Add env options as needed:
   - `NEXUS_SKILL_MOUNT_BASE_PATH`
   - `NEXUS_HOST_SKILL_MOUNT_PATH`

Cleanup requirements:

1. Skill mounts must be cleaned after job completion.
2. Cleanup must occur on both success and error paths.

### Phase 5: Prompt and Activation Integration

1. Build skill catalog text for runtime prompt in:
   - `apps/api/src/workflow/step-agent-step-executor.helpers.ts`
2. Ensure precedence remains unchanged for model/provider/system prompt chain.
3. Append catalog instructions only when assigned skills exist.

Recommended prompt augmentation shape:

1. `available_skills` block with:
   - skill name
   - description
   - mounted location
2. concise behavior instructions for activation and relative path resolution.

### Phase 6: Runtime Discovery Tooling (Optional but recommended)

1. Add runtime capability `get_agent_skills` (read-only catalog retrieval):
   - `apps/api/src/tool/capability-manifest.runtime.entries.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
2. Optional `activate_skill` tool returning structured wrapped content.

This improves deterministic activation and observability compared to free-form file reads.

---

## 8. Security, Trust, and Governance

### 8.1 Input validation and abuse prevention

1. Strict markdown/frontmatter parsing with schema validation.
2. Size caps per skill and per profile assignment count.
3. Path traversal prevention in resource references and file materialization.
4. Rate limits on skill mutation endpoints.

### 8.2 Trust model

1. Admin/developer-only mutation by default.
2. Agent-driven skill creation (future or optional) must be approval-gated similarly to `create_agent_profile` mutating actions.
3. Imported/project-level skills from untrusted repositories should be disabled by default until trust is explicit.

### 8.3 Authorization

1. Reuse existing JWT + RolesGuard policy.
2. Suggested role matrix:
   - Admin: full CRUD + assignment.
   - Developer: read + update assignment (configurable).
   - Agent: read-only runtime discovery endpoints only.

### 8.4 Auditability

Emit ledger events for:

1. skill create/update/delete
2. assignment updates
3. runtime skill mount success/failure

---

## 9. Testing Strategy

### 9.1 API Unit and Service tests

Add tests for:

1. `AgentSkillsService` validation and CRUD behavior.
2. assignment replace semantics and uniqueness rules.
3. frontmatter parse/validation edge cases.

Target files (new/extended):

1. `apps/api/src/ai-config/ai-config-admin.service.spec.ts` (extend if wiring through admin service)
2. `apps/api/src/ai-config/services/agent-skills.service.spec.ts` (new)
3. repository specs for new skill repositories (new)

### 9.2 Runtime and container tests

1. Extend `apps/api/src/workflow/step-agent-step-executor.service.spec.ts`:
   - verifies skills are resolved and mounted.
2. Extend `apps/api/src/workflow/subagent-orchestrator.service.spec.ts`:
   - verifies subagents also receive skills mount.
3. Add/extend orchestrator volume remap tests in:
   - `apps/api/src/docker/container-orchestrator.service.spec.ts`

### 9.3 Web tests

1. Extend `apps/web/src/pages/agents/AgentProfileForm.spec.tsx` for assignment UX.
2. Add `SkillEditor` tests (new).

### 9.4 E2E tests

Add to `packages/e2e-tests`:

1. Skill CRUD flow via API.
2. Profile assignment flow.
3. Workflow run with assigned skills verifies skill mount availability and catalog injection behavior.
4. Subagent run path with assigned skills.

Suggested new test files:

1. `packages/e2e-tests/src/workflow-execution/agent-skills-crud.test.ts`
2. `packages/e2e-tests/src/workflow-execution/agent-skills-runtime-mount.test.ts`

---

## 10. Rollout Plan

### 10.1 Feature flagging

Introduce:

1. `AGENT_SKILLS_ENABLED` (API + UI)
2. `AGENT_SKILLS_PROMPT_CATALOG_ENABLED` (runtime prompt augmentation)

### 10.2 Safe migration path

1. Deploy schema first.
2. Deploy read-safe API/UI next.
3. Enable runtime mount path behind flag.
4. Enable prompt catalog once mount path is stable.

### 10.3 Observability and SLOs

Track:

1. skill CRUD failure rates
2. assignment update failures
3. skill mount prep time and failure rate
4. per-run mounted skill count
5. runner startup regressions after skill sync

---

## 11. Detailed File-Level Change Map

### API/DB (new)

1. `apps/api/src/database/entities/agent-skill.entity.ts`
2. `apps/api/src/database/entities/agent-profile-skill.entity.ts`
3. `apps/api/src/database/repositories/agent-skill.repository.ts`
4. `apps/api/src/database/repositories/agent-profile-skill.repository.ts`
5. `apps/api/src/database/migrations/<timestamp>-create-agent-skills-and-assignments.ts`
6. `apps/api/src/ai-config/dto/skills/create-skill.dto.ts`
7. `apps/api/src/ai-config/dto/skills/update-skill.dto.ts`
8. `apps/api/src/ai-config/dto/skills/assign-profile-skills.dto.ts`
9. `apps/api/src/ai-config/services/agent-skills.service.ts`
10. `apps/api/src/tool/skill-mounting.service.ts`

### API/DB (modify)

1. `apps/api/src/database/database.module.ts`
2. `apps/api/src/database/entities/index.ts`
3. `apps/api/src/database/repositories/index.ts`
4. `apps/api/src/ai-config/ai-config.module.ts`
5. `apps/api/src/ai-config/controllers/agent-profiles.controller.ts` (or add new controller)
6. `apps/api/src/ai-config/ai-config-admin.service.ts`
7. `apps/api/src/workflow/step-support.service.ts`
8. `apps/api/src/workflow/step-agent-step-executor.service.ts`
9. `apps/api/src/workflow/step-agent-step-executor.helpers.ts`
10. `apps/api/src/workflow/subagent-orchestrator.service.ts`
11. `apps/api/src/docker/container-orchestrator.service.ts`
12. Optional runtime tooling:

- `apps/api/src/workflow/workflow-runtime-tools.service.ts`
- `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
- `apps/api/src/tool/capability-manifest.runtime.entries.ts`

### Web (new)

1. `apps/web/src/hooks/useAgentSkills.ts`
2. `apps/web/src/pages/agents/AgentSkills.tsx`
3. `apps/web/src/pages/agents/SkillEditor.tsx`

### Web (modify)

1. `apps/web/src/lib/api/types.ts`
2. `apps/web/src/lib/api/client.ts`
3. `apps/web/src/pages/agents/AgentProfiles.tsx`
4. `apps/web/src/pages/agents/AgentProfileForm.tsx`

### Tests (new/modify)

1. `apps/api/src/workflow/step-agent-step-executor.service.spec.ts`
2. `apps/api/src/workflow/subagent-orchestrator.service.spec.ts`
3. `apps/api/src/docker/container-orchestrator.service.spec.ts`
4. `apps/api/src/ai-config/ai-config-admin.service.spec.ts`
5. `apps/web/src/pages/agents/AgentProfileForm.spec.tsx`
6. `packages/e2e-tests/src/workflow-execution/agent-skills-crud.test.ts`
7. `packages/e2e-tests/src/workflow-execution/agent-skills-runtime-mount.test.ts`

---

## 12. Acceptance Criteria

1. Skills can be created, edited, listed, and deleted from the app UI and API.
2. Skills can be assigned to agent profiles and persisted.
3. On execution start, assigned skills are materialized and mounted in runner container.
4. Subagent execution path receives equivalent skill sync.
5. Agent receives skill catalog guidance in runtime prompt when skills are assigned.
6. End-to-end tests confirm skill CRUD + assignment + runtime mount behavior.
7. Existing workflow execution and tool-mount behavior remain backward compatible.

---

## 13. Open Questions to Resolve Before Build

1. Should v1 support only `SKILL.md`, or include bundled resources in the first release?
2. Should skill activation be file-read driven only, or require a dedicated `activate_skill` runtime tool in v1?
3. Should `create_agent_profile` runtime action support inline skill assignment immediately?
4. Should default seeded profiles ship with predefined skills, or start empty for controlled rollout?
5. Should profile-level ordering of assigned skills influence activation priority hints?

---

## 14. Risks and Mitigations

1. Runner startup regression from additional mount preparation:
   - Mitigation: lazy mount only when assigned skills exist; add timing metrics.
2. Nested Docker path remapping issues for new mount roots:
   - Mitigation: either reuse existing tool mount base or extend remapping with tests.
3. Prompt bloat from large skill catalogs:
   - Mitigation: catalog-only startup disclosure with body loaded on demand.
4. Security drift from untrusted skill content:
   - Mitigation: strict RBAC and frontmatter validation; trusted-source policy for imports.

---

## 15. Success Metrics

1. 100% pass for new skill CRUD and runtime mount test suites.
2. No increase in workflow run failure rate after feature flag enablement.
3. Measurable reduction in repeated prompt boilerplate by teams using assigned skills.
4. Stable runner startup latency within defined SLO after mount integration.

---

## 16. Reference Context

Architecture and behavior references used for this epic:

1. `docs/architecture/workflow-engine.md`
2. `docs/architecture/container-orchestration.md`
3. `docs/architecture/agent-capability-orchestration.md`
4. `docs/architecture/rest-api.md`
5. `apps/api/README.md`
6. `README.md`

External references:

1. https://agentskills.io/specification
2. https://agentskills.io/client-implementation/adding-skills-support
3. https://agentskills.io/what-are-skills
4. https://github.com/agentskills/agentskills
