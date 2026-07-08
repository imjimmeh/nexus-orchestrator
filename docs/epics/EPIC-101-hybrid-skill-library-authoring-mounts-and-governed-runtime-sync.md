# EPIC-101: Hybrid Skill Library Authoring Mounts and Governed Runtime Sync

Status: Planned
Priority: P0
Depends On: EPIC-057, EPIC-098, EPIC-100
Related: docs/architecture/container-orchestration.md, docs/architecture/agent-capability-orchestration.md, docs/architecture/workflow-engine.md, docs/architecture/tool-registry.md, docker-compose.yaml
Last Updated: 2026-04-15

---

## 1. Epic Summary

Add a hybrid skill-management model that keeps the current assigned-skill runtime sync, while enabling optional direct skill file CRUD via governed host mounts.

The target model has two surfaces:

1. Runtime skill surface (existing): assigned-skill snapshot mounted read-only into runner containers.
2. Authoring skill surface (new): persistent skills library root mounted as read-only or read-write per policy.

This addresses the primary requirement:

1. Agents that are allowed to author skills can CRUD skill files directly on the source library.
2. Agents that are not allowed to author skills get read-only or no authoring mount.
3. Skill creation works by mounting the library root, not only pre-existing per-skill folders.

---

## 2. Context and Problem Statement

Current implementation already provides:

1. Filesystem-backed skill library under API control.
2. Stage/profile-based assigned-skill resolution.
3. Per-run skill materialization into temporary mount directories.
4. Read-only skill mount into runner containers.
5. Runtime lifecycle APIs for skill CRUD and profile assignment.

This is robust for governed API-mediated mutations, but not optimized for direct in-container authoring workflows.

Requested direction:

1. Allow direct CRUD against mounted skill directories.
2. Use mount mode to control permissions (RW for allowed agents, RO for others).
3. Solve the bootstrap problem for skill creation, where mounting only existing skill folders cannot create new top-level skill directories.

Primary challenge:

1. Existing runtime skill mount is a temporary, assigned-only snapshot, not the persistent library root.
2. Existing runner host-mount guards enforce write controls under host-share scope and require explicit bindings.
3. API-callback spawn tool schemas currently do not expose host_mounts and inherit_host_mounts even though runtime subagent services support them.

---

## 3. Current-State Analysis

### 3.1 Skill Source of Truth and Runtime Mounting

1. Persistent skills library resolves from NEXUS_SKILLS_LIBRARY_PATH (compose default /data/nexus-skills).
2. SkillMountingService copies assigned skill directories into /tmp/nexus-tools/skills/<mountKey>.
3. Step and subagent provisioning mount that directory to /root/.pi/agent/skills as read-only.
4. Temporary skill mount paths are cleaned up during execution cleanup paths.

### 3.2 Governance and Runtime Capability Controls

1. Runtime skill lifecycle actions are exposed through workflow-runtime capability APIs.
2. Capability executor enforces callable, denied, and approval_required tool states.
3. Skill service layer applies name/frontmatter/path constraints that direct filesystem writes do not automatically enforce.

### 3.3 Host-Mount Security and Runner Guardrails

1. Host mount policy supports layered allow/deny/rw permissions with approval gate support.
2. Runner host-mount guards enforce write restrictions only for paths under /workspace/host-shares and based on scope manifest readOnly flags.
3. Nested Docker host-path remapping exists for tool mounts and host-share mounts, but no dedicated skills-library remap path yet.

### 3.4 Subagent Contract Gap

1. Runtime subagent services support host_mounts and inherit_host_mounts.
2. API callback capability manifest for spawn_subagent and spawn_subagent_async omits those fields from body mapping and schema.

---

## 4. Goals

1. Enable direct skill file CRUD through mounted persistent library root for explicitly authorized agents.
2. Preserve existing assigned-skill runtime mount behavior for execution stability and backwards compatibility.
3. Support new skill creation by mounting the skill library root as an authoring surface.
4. Keep policy-driven RO versus RW controls and optional approval gates.
5. Preserve governance and auditability for profile assignment and privileged operations.
6. Close subagent host-mount contract parity gaps so authoring context can be delegated safely.

---

## 5. Non-Goals

1. Remove all existing workflow-runtime skill lifecycle APIs in v1.
2. Permit arbitrary host path mounting outside catalog aliases.
3. Auto-assign newly created skills to profiles without explicit assignment actions.
4. Replace stage/profile-based assigned-skill selection logic.
5. Introduce marketplace/registry federation for skills in this epic.

---

## 6. Proposed Architecture

### 6.1 Dual-Surface Skill Model

Maintain two distinct mount surfaces:

1. Execution surface (existing):
   - Assigned skill snapshot only.
   - Mounted at /root/.pi/agent/skills.
   - Always read-only.
2. Authoring surface (new):
   - Persistent skill library root.
   - Mounted through host-mount alias (recommended alias: skills_library).
   - Mounted at /workspace/host-shares/skills-library or alias-resolved container path.
   - Mode resolved by policy (RO or RW).

### 6.2 Policy and Approval Model

Use existing host-mount policy stack:

1. Catalog alias entry defines base root and writable capability.
2. Profile/project/workflow/job policies intersect allow and RW permissions.
3. RW may return approval_required based on global or alias settings.

### 6.3 Skill Creation Model

Creation is supported by mounting the library root, not per-skill folders:

1. Agent creates /workspace/host-shares/skills-library/<skill-name>/SKILL.md.
2. Optional additional files are created under that directory.
3. Skill appears in library resolution after filesystem write if frontmatter is valid.

### 6.4 Assignment and Activation Model

Keep assignment explicit and governed:

1. Continue using add/replace/remove profile skill APIs for assigned_skills state.
2. Runtime assigned-skill mount continues to derive from stage/profile assignment policy.
3. Optional post-write validation workflow can call existing skill-validation APIs or tools.

### 6.5 Nested Docker Remap for Skill Library

Add dedicated remap path support for persistent skill library roots:

1. Resolve API-visible skill root (NEXUS_SKILLS_LIBRARY_PATH).
2. Resolve host-visible skill root (NEXUS_HOST_SKILLS_PATH or explicit host-skill-root env).
3. Translate bind source for child containers similarly to existing tool and host-share remap logic.

### 6.6 Subagent Authoring Parity

Expose host_mounts and inherit_host_mounts in API callback capability schemas/body mappings for:

1. spawn_subagent
2. spawn_subagent_async

This allows delegation patterns where parent grants explicit authoring mounts to subagents.

---

## 7. Scope

### In Scope

1. Add governed skills-library host-mount alias and policy conventions.
2. Add runtime support for RO/RW authoring mounts in step and subagent paths.
3. Add remap support for skills-library bind paths in nested Docker setups.
4. Add capability contract updates for subagent host-mount fields.
5. Preserve existing assigned-skill runtime mount and lifecycle capability APIs.
6. Add diagnostics/audit updates for authoring mount visibility.
7. Document authoring workflow and operational policy guidance.

### Out of Scope

1. Full replacement of profile assignment APIs with file-only workflows.
2. Auto-healing malformed skills generated by direct writes.
3. Org-level multi-tenant skill namespace model changes.

---

## 8. Implementation Plan

### 8.1 Phase 0: Design and Policy Baseline

1. Define catalog alias and default mode for skills_library.
2. Define approved profiles and projects for RW authoring.
3. Decide approval gate behavior for RW in supervised and autonomous modes.

### 8.2 Phase 1: Contract and Configuration Wiring

1. Add documented host-mount catalog examples for skills_library.
2. Add env/config conventions for API-root and host-root skill paths.
3. Update docs for workflow host_mount usage patterns for skill authoring.

### 8.3 Phase 2: Container Orchestrator Remap Extension

1. Add resolveDockerSkillsLibraryHostPath behavior.
2. Integrate skills-library remap into resolveDockerVolumeHostPath chain.
3. Add unit tests for remap combinations and no-op fallbacks.

### 8.4 Phase 3: Runtime Authoring Mount Enablement

1. Allow workflow jobs to request skills_library mount through existing host_mounts contract.
2. Verify StepAgentContainerSupportService and subagent spawn paths attach resolved bindings correctly.
3. Ensure runner host-mount scope manifest includes skills_library bindings.

### 8.5 Phase 4: Subagent Capability Contract Parity

1. Extend capability-manifest.execution.entries.ts mappings for spawn_subagent and spawn_subagent_async.
2. Add host_mounts and inherit_host_mounts fields to schema and bodyMapping.
3. Extend nexus_orchestrator execution entry schema for discoverability consistency.

### 8.6 Phase 5: Governance and Validation Hardening

1. Keep profile assignment capabilities governed via runtime capability executor.
2. Optionally gate legacy create_skill and update_skill tool exposure when filesystem authoring mode is enabled.
3. Add validation helper path (non-mutating) for authoring flows to confirm frontmatter and directory conventions.

### 8.7 Phase 6: Diagnostics, Docs, and Rollout

1. Extend skill runtime diagnostics endpoint to report authoring mounts and effective mode.
2. Emit host-mount lifecycle events for skills_library alias usage.
3. Update docs/epics, architecture, and operations runbooks.
4. Roll out in RO-first, RW-limited phases.

---

## 9. Deliverables

1. Governed skills-library authoring mount path (RO/RW).
2. Nested Docker remap support for persistent skills-library binds.
3. Subagent capability contract support for host_mounts forwarding.
4. Updated diagnostics and event/audit coverage for authoring mounts.
5. Updated architecture/operations docs and rollout guidance.

---

## 10. Acceptance Criteria

1. Authorized workflows can mount skills_library root as RO or RW based on effective policy.
2. Unauthorized or unsafe mount requests are denied pre-provisioning with explicit reasons.
3. RW authoring can create new skill directories and SKILL.md files at the source library root.
4. Existing assigned-skill execution mount behavior remains unchanged and backward compatible.
5. Profile assignment changes remain explicit and governed via runtime capability policies.
6. spawn_subagent and spawn_subagent_async can propagate host_mounts through API callback manifests.
7. Diagnostics endpoint shows runtime and authoring skill mount context for each run container.

---

## 11. Actionable Tasks

- [ ] E101-001 Define skills_library host-mount alias contract and default policy profile.
- [ ] E101-002 Add system-setting examples and docs for skills_library catalog entry.
- [ ] E101-003 Add compose/env conventions for API and host skill root remap values.
- [ ] E101-004 Implement container-orchestrator skills-library host-path remap helper.
- [ ] E101-005 Integrate skills-library remap into resolveDockerVolumeHostPath flow.
- [ ] E101-006 Add container-orchestrator remap unit tests for skills-library path scenarios.
- [ ] E101-007 Add workflow authoring examples using host_mounts alias=skills_library mode=ro.
- [ ] E101-008 Add workflow authoring examples using host_mounts alias=skills_library mode=rw with approvals.
- [ ] E101-009 Verify step execution path accepts skills_library bindings without regression.
- [ ] E101-010 Verify subagent spawn path accepts skills_library bindings without regression.
- [ ] E101-011 Extend capability manifest mapping for spawn_subagent host_mounts and inherit_host_mounts.
- [ ] E101-012 Extend capability manifest mapping for spawn_subagent_async host_mounts and inherit_host_mounts.
- [ ] E101-013 Extend spawn_subagent schema with host_mounts and inherit_host_mounts fields.
- [ ] E101-014 Extend spawn_subagent_async schema with host_mounts and inherit_host_mounts fields.
- [ ] E101-015 Extend nexus_orchestrator execution schema to document host_mounts payload for spawn actions.
- [ ] E101-016 Add/extend runtime subagent tool controller tests for host_mount forwarding payloads.
- [ ] E101-017 Ensure runner host-mount scope guard behavior is validated for skills_library RO paths.
- [ ] E101-018 Ensure runner host-mount scope guard behavior is validated for skills_library RW paths.
- [ ] E101-019 Add policy tests for allow/deny/rw intersection semantics on skills_library alias.
- [ ] E101-020 Add approval-required tests for skills_library RW when policy requires approval.
- [ ] E101-021 Add diagnostics endpoint coverage for authoring mount visibility.
- [ ] E101-022 Add event ledger coverage for skills_library requested, approved, denied, attached, removed events.
- [ ] E101-023 Decide and document whether create_skill/update_skill runtime tools remain enabled, reduced, or deprecated in filesystem-authoring mode.
- [ ] E101-024 Add operator guide for direct filesystem authoring plus profile assignment workflow.
- [ ] E101-025 Add rollback playbook for disabling RW authoring while preserving RO execution sync.

---

## 12. Test and Quality Gates

1. npm run lint:api
2. npm run build:api
3. npm run test --workspace=apps/api -- src/docker/container-orchestrator.service.spec.ts
4. npm run test --workspace=apps/api -- src/workflow/host-mount-resolution.service.spec.ts
5. npm run test --workspace=apps/api -- src/workflow/step-agent-container-support.service.spec.ts
6. npm run test --workspace=apps/api -- src/workflow/subagent-orchestrator.service.spec.ts
7. npm run test --workspace=apps/api -- src/workflow/workflow-runtime-subagent-tools.service.spec.ts
8. npm run test --workspace=apps/api -- src/tool/capability-contract-validator.service.spec.ts

Deterministic orchestration regression should be run at rollout milestones:

1. npm run test:e2e:kanban:deterministic

---

## 13. Risks and Mitigations

1. Risk: Direct filesystem writes create malformed skills that do not load.
   Mitigation: add optional validation workflow/tooling and operator guidance on frontmatter requirements.
2. Risk: Over-broad RW authoring permissions.
   Mitigation: default RO, layered rw allow lists, approval_required for RW, strict audit events.
3. Risk: Nested Docker bind failures for /data/nexus-skills.
   Mitigation: explicit remap support and startup diagnostics for host-root alignment.
4. Risk: Subagent contract mismatch between runtime services and capability manifests.
   Mitigation: schema/bodyMapping parity tests and contract validation checks.
5. Risk: Confusion between runtime assigned-skill view and authoring library view.
   Mitigation: dual-surface documentation and diagnostics exposing both mount surfaces.

---

## 14. Rollout Plan

### Stage 1: Read-Only Authoring Visibility

1. Enable skills_library alias with mode ro for pilot profiles.
2. Validate diagnostics and no-regression execution behavior.
3. Confirm operators can inspect full skill library in-run without mutation risk.

### Stage 2: Controlled Read-Write Authoring

1. Enable RW only for selected profiles/projects with approval gates.
2. Validate create/update/delete file workflows and profile assignment flow.
3. Monitor denied/approval/success event ratios and rollback readiness.

### Stage 3: Production Hardening

1. Finalize policy defaults and docs.
2. Decide long-term role of legacy create_skill/update_skill APIs in authoring-enabled environments.
3. Publish final operational guidance and troubleshooting matrix.

---

## 15. Open Decisions

1. Should RW skills_library always require approval, or only in supervised mode?
2. Should direct filesystem skill creation automatically trigger a validation callback, or remain opt-in?
3. Should create_skill and update_skill capability tools be deprecated, retained, or policy-hidden when filesystem authoring is enabled?
4. Should authoring mount path be standardized as /workspace/host-shares/skills-library or remain alias-derived only?

---

## 16. References

1. docs/epics/EPIC-057-agent-skills-management-and-runner-sync.md
2. docs/epics/EPIC-098-non-kanban-chat-agent-seeding-and-runtime-capability-enablement.md
3. docs/epics/EPIC-100-governed-host-mount-file-access-for-agents.md
4. docs/architecture/container-orchestration.md
5. docs/architecture/agent-capability-orchestration.md
6. docs/architecture/workflow-engine.md
7. docs/architecture/tool-registry.md
8. docker-compose.yaml
9. apps/api/src/ai-config/services/agent-skill-library.service.ts
10. apps/api/src/ai-config/services/agent-skills.service.ts
11. apps/api/src/tool/skill-mounting.service.ts
12. apps/api/src/tool/capability-manifest.execution.skill-lifecycle.entries.ts
13. apps/api/src/tool/capability-manifest.execution.entries.ts
14. apps/api/src/workflow/step-agent-container-support.service.ts
15. apps/api/src/workflow/subagent-orchestrator.spawn.operations.ts
16. apps/api/src/workflow/subagent-orchestrator.container-config.operations.ts
17. apps/api/src/workflow/workflow-runtime-subagent-tools.service.ts
18. apps/api/src/workflow/workflow-runtime-capability-executor.service.ts
19. apps/api/src/workflow/host-mount-resolution.service.ts
20. apps/api/src/workflow/host-mount-resolution.service.types.ts
21. apps/api/src/docker/container-orchestrator.service.ts
22. packages/pi-runner/src/session-factory.ts
23. packages/pi-runner/src/session-factory.host-mount-scope.ts
