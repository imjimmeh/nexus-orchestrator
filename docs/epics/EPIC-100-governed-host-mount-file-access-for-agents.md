# EPIC-100: Governed Host-Mount File Access for Agents

Status: Completed
Priority: P0
Depends On: EPIC-017, EPIC-057, EPIC-090
Related:

1. docs/architecture/container-orchestration.md
2. docs/architecture/agent-capability-orchestration.md
3. docs/architecture/workflow-engine.md
4. docs/architecture/rest-api.md
5. docker-compose.yaml
6. apps/api/src/docker/container-orchestrator.service.ts
7. apps/api/src/workflow/step-agent-container-support.service.ts
8. apps/api/src/workflow/subagent-orchestrator.spawn.operations.ts
9. packages/pi-runner/src/session-factory.ts
   Last Updated: 2026-04-15

---

## 1. Epic Summary

Enable agents to create and edit files on the host machine through governed mounts that are:

1. explicit,
2. policy-controlled,
3. auditable,
4. safe by default.

The core design is a hybrid model:

1. pre-mounted host share roots into the API service,
2. controlled API-to-runner bind forwarding for approved subpaths,
3. layered policy resolution (global, project, workflow, agent),
4. optional approval gates for risky writes,
5. optional API-mediated file mutation path for high-sensitivity targets.

---

## 2. Problem Statement

Today, runner containers primarily receive:

1. workspace mounts,
2. tool mounts,
3. skill mounts.

This is sufficient for repo-local orchestration, but insufficient for controlled host-machine automation scenarios such as:

1. authoring files in external documentation trees,
2. updating shared operational artifacts outside the worktree,
3. reading and writing approved integration folders on the host.

Naively adding arbitrary bind mounts introduces significant risk:

1. host path traversal and symlink escapes,
2. over-broad write surfaces,
3. policy drift across workflow and profile layers,
4. poor auditability and operations visibility.

---

## 3. Goals

1. Allow controlled host file read and write access for approved agents and workflows.
2. Support per-agent, per-workflow, and per-project mount policy composition.
3. Keep policy enforcement deterministic and deny by default.
4. Prevent traversal, symlink escape, and arbitrary destination mounting.
5. Preserve existing container orchestration semantics and compatibility.
6. Provide strong runtime diagnostics, audit events, and operational controls.
7. Support phased rollout with read-only first, then write.

---

## 4. Non-Goals

1. Unconstrained arbitrary host path mounting by agents.
2. Runtime mutation of Docker Compose mounts without service restart.
3. A full host privilege escalation feature set.
4. Replacing existing workspace-based execution paths.
5. Broad internet or system administration autonomy beyond approved policies.

---

## 5. Key Constraints and Design Principles

1. API container cannot safely discover and mount arbitrary host paths unless those paths are already available through a known host-to-API mount root.
2. All mount requests must reference catalog aliases, not raw host paths.
3. Effective permissions are resolved by intersection, not additive override.
4. Read-write mounts are privileged and require stricter governance than read-only mounts.
5. Subagents do not inherit host mounts by default.
6. Runner file access must still be constrained by a mount scope manifest.
7. All decisions must emit audit-friendly structured events.

---

## 6. Proposed Architecture

### 6.1 Host Share Catalog (Global)

Introduce a global catalog of approved mount aliases backed by API-visible roots.

Example concept:

1. alias: project_docs
2. api_root: /data/nexus-host-shares/project-docs
3. default_mode: ro
4. writable_allowed: false
5. approval_required_on_rw: true

Catalog storage options:

1. Initial implementation in system settings under a dedicated key.
2. Optional future migration to first-class DB entity for richer governance and querying.

### 6.2 Layered Policy Model

Resolve effective mount policy using all layers:

1. Global catalog hard bounds.
2. Project-level policy.
3. Workflow-level policy.
4. Agent profile policy.
5. Job-level request.

Policy rule:

1. Effective access is intersection of all allow constraints.
2. Any deny in any layer blocks the mount.
3. Workflow and job layers can narrow, never expand beyond project and profile hard bounds.

### 6.3 Standardized Runner Mount Destinations

All host-share mounts land under a fixed directory tree inside runner containers.

Recommended root:

1. /workspace/host-shares/<alias>/<requested-subpath>

Disallow arbitrary destination container paths.

### 6.4 API-to-Runner Bind Translation

Generalize existing host remap logic in ContainerOrchestratorService:

1. current workspace and tool remap stays intact,
2. add host-share remap using configured API base root and host base root,
3. map API-internal mount path to host bind source before Docker create.

### 6.5 Path Safety Enforcement

Add dedicated mount path resolver service:

1. normalize input,
2. resolve realpath where possible,
3. ensure requested path remains within alias root,
4. reject traversal and symlink escapes,
5. reject unknown alias or unapproved mode.

### 6.6 Runner Scope Manifest

Generate and mount a host-share scope manifest alongside tool allowlists.

Purpose:

1. constrain runner file operations to approved mount roots,
2. support future explicit read-only and read-write path-level checks.

### 6.7 Governance and Approval

For supervised mode and privileged operations:

1. read-write mount requests trigger approval-required preflight outcomes,
2. only approved operations proceed to container provisioning,
3. denials are explicit and auditable.

---

## 7. Contract Proposals

### 7.1 Core Interface Extensions

Add host-mount contract types in packages/core interfaces.

Candidate structures:

1. IHostMountRequest
2. IHostMountBinding
3. IHostMountPermissionPolicy
4. HostMountMode (ro, rw)

### 7.2 Workflow YAML Extension

Add explicit host mount request support under job definition.

Candidate shape:

1. jobs[].host_mounts[].alias
2. jobs[].host_mounts[].subpath
3. jobs[].host_mounts[].mode

Validation requirements:

1. alias required and must be non-empty.
2. mode must be ro or rw.
3. subpath must be relative and traversal-safe.

### 7.3 Agent Profile Extension

Extend agent profile seed schema and entity for mount permissions.

Candidate fields:

1. allowed_mount_aliases
2. denied_mount_aliases
3. allow_rw_mount_aliases

### 7.4 Project-Level Policy Surface

Add project-level mount policy contract via Kanban domain API.

Candidate approach:

1. store in project metadata initially,
2. expose typed DTOs via project endpoints,
3. consume via core client before run planning and queueing.

### 7.5 Launch Preset Trigger Data Compatibility

Allow launch presets to include host mount requests inside trigger_data while preserving explicit validation and eligibility checks.

---

## 8. Scope Breakdown

### 8.1 Phase 0: Security Model and Governance Baseline

1. Document threat model and trust boundaries.
2. Define mount privilege matrix by role, profile, and mode.
3. Define approval policy trigger conditions.

### 8.2 Phase 1: Infrastructure Foundation

1. Add Compose and env conventions for host share roots.
2. Add host share remap support in container orchestrator.
3. Add startup diagnostics for mapping validity.

### 8.3 Phase 2: Policy Data and Contract Layer

1. Add core types and parser support.
2. Add workflow schema and validation rules.
3. Add agent profile schema and seed support.
4. Add project-level policy contract and persistence path.

### 8.4 Phase 3: Runtime Enforcement

1. Implement mount resolution and safety checks.
2. Integrate effective policy resolution in run/job prep.
3. Inject resolved bindings into container config assembly.
4. Ensure subagent mount behavior is explicit and safe.

### 8.5 Phase 4: Runner Guardrails

1. Add host-share scope manifest generation.
2. Add runner loading and enforcement hooks.
3. Verify tool behavior respects scope and mode.

### 8.6 Phase 5: Approval and Audit

1. Add preflight outcomes for denied and approval-required mount requests.
2. Add event ledger records for requested, approved, denied, attached, removed.
3. Add diagnostics endpoint for effective mount visibility per run.

### 8.7 Phase 6: Rollout and Hardening

1. Read-only canary rollout.
2. Read-write rollout for selected aliases.
3. Remove legacy temporary switches and finalize docs.

---

## 9. Actionable Tasks

- [x] E100-001 Define host mount threat model and governance matrix.
- [x] E100-002 Add system setting schema for host mount catalog aliases.
- [x] E100-003 Add startup validation for mount catalog and root mapping.
- [x] E100-004 Add compose/env conventions for API host-share base mount.
- [x] E100-005 Generalize container host-path remap logic for host-share roots.
- [x] E100-006 Add core interfaces for host mount request and binding contracts.
- [x] E100-007 Extend workflow job schema with host_mounts contract.
- [x] E100-008 Add workflow validation rules for host_mount alias, mode, and subpath safety.
- [x] E100-009 Extend workflow parser normalization for host_mounts.
- [x] E100-010 Extend agent profile entity for mount policy fields.
- [x] E100-011 Extend agent profile DTOs and admin APIs for mount policy fields.
- [x] E100-012 Extend seed/agents agent.json schema to include mount policy fields.
- [x] E100-013 Add seed parsing and validation for mount policy fields.
- [x] E100-014 Implement project-level mount policy contract in Kanban service.
- [x] E100-015 Add core-to-kanban client integration for project mount policy retrieval.
- [x] E100-016 Add MountPolicyResolutionService with deterministic precedence and hard-bound intersection.
- [x] E100-017 Add path normalization and realpath containment checks for alias subpaths.
- [x] E100-018 Add explicit read-only versus read-write mode enforcement.
- [x] E100-019 Add approval-required outcome for privileged read-write mount requests.
- [x] E100-020 Integrate resolved mounts into StepAgentContainerSupportService provisioning path.
- [x] E100-021 Integrate resolved mounts into subagent spawn provisioning path with no default inheritance.
- [x] E100-022 Add explicit inheritance contract for subagents where approved.
- [x] E100-023 Add runner host-share scope manifest generation.
- [x] E100-024 Add runner config loading for host-share scope manifest.
- [x] E100-025 Enforce runner file operations within approved host-share scopes.
- [x] E100-026 Add event ledger emissions for mount lifecycle events.
- [x] E100-027 Add workflow run diagnostics endpoint for effective mount resolution and container bindings.
- [x] E100-028 Extend runtime artifacts inspector to include host-share stale mount diagnostics.
- [x] E100-029 Add unit tests for policy resolution precedence and deny semantics.
- [x] E100-030 Add unit tests for path traversal and symlink-escape rejection.
- [x] E100-031 Add unit tests for container remap logic with host-share roots.
- [x] E100-032 Add integration tests for workflow host_mounts parsing and validation.
- [x] E100-033 Add integration tests for container provisioning with approved and denied mounts.
- [x] E100-034 Add integration tests for subagent mount inheritance controls.
- [x] E100-035 Add documentation updates for architecture, operations, and workflow authoring.
- [x] E100-036 Execute read-only canary rollout and collect operational telemetry.
- [x] E100-037 Execute limited read-write rollout with approval gates enabled.
- [x] E100-038 Complete production hardening and remove temporary feature flags.

---

## 10. Acceptance Criteria

1. Workflows can request approved host mounts by alias and relative subpath.
2. Effective mount permissions are resolved with deterministic precedence and deny semantics.
3. Unauthorized or unsafe mount requests are denied before container provisioning.
4. Traversal and symlink escape attempts are rejected by path safety enforcement.
5. Runner containers only receive mounts under standardized destination roots.
6. Read-write mounts are blocked or require approval according to governance policy.
7. Subagents do not inherit host mounts unless explicitly allowed.
8. Audit events capture mount decision and lifecycle details.
9. Operators can inspect effective mount diagnostics per run.
10. Existing workspace, tool, and skill mount flows remain backward compatible.

---

## 11. Test and Quality Gates

Recommended verification commands from repository root:

1. npm run lint:api
2. npm run build:api
3. npm run test --workspace=apps/api -- src/docker/container-orchestrator.service.spec.ts
4. npm run test --workspace=apps/api -- src/workflow/workflow-validation.service.spec.ts
5. npm run test --workspace=apps/api -- src/workflow/step-agent-container-support.service.spec.ts
6. npm run test --workspace=apps/api -- src/workflow/subagent-orchestrator.service.spec.ts
7. npm run test --workspace=apps/api -- src/security/iam-policy.service.spec.ts
8. npm run test --workspace=apps/kanban -- src/project/project.service.spec.ts

Deterministic regression checks after orchestration-path changes:

1. npm run test:e2e:kanban:deterministic

---

## 12. Risks and Mitigations

1. Risk: Excessive host write privileges.
   Mitigation: default read-only, approval-gated read-write, profile and project hard bounds.
2. Risk: Path traversal or symlink escape.
   Mitigation: normalize plus realpath containment checks and reject-on-ambiguity behavior.
3. Risk: Policy mismatch across profile, workflow, and project layers.
   Mitigation: centralized resolution service with explicit deny reasons and tests.
4. Risk: Hidden runtime failures from late mount denial.
   Mitigation: preflight capability and mount resolution before queue execution.
5. Risk: Operational complexity during rollout.
   Mitigation: phased read-only rollout, diagnostics, canary windows, and rollback toggles.

---

## 13. Rollout Plan

### Stage 1: Read-Only Beta

1. Enable host mount aliases for selected non-sensitive roots.
2. Restrict to read-only mounts.
3. Monitor diagnostics, event ledger outcomes, and error rates.

### Stage 2: Controlled Read-Write

1. Enable read-write on selected aliases behind approvals.
2. Restrict to trusted profiles and projects.
3. Validate rollback and denial paths under load.

### Stage 3: General Availability

1. Finalize policy defaults and remove temporary toggles.
2. Publish final docs and runbooks.
3. Add ongoing compliance checks in operations doctor workflows.

---

## 14. Open Decisions

1. Should project-level mount policy live in project metadata first, or in a dedicated project mount policy table from day one?
2. Should write access require approval in all modes, or only supervised mode?
3. Should runner-side host-share scope enforcement be hard-blocking in v1, or soft-observe first with enforcement in v2?
4. Which initial alias set is acceptable for Stage 1 read-only beta?

---

## 15. Exit Criteria

1. Agents can create and edit host files only within approved alias scopes.
2. Governance, audit, and diagnostics are production-ready.
3. Read-only and read-write rollout stages have completed with acceptable SLO impact.
4. Documentation and operational runbooks are complete for ongoing maintenance.

---

## 16. Completion Evidence

1. Architecture governance and threat model: `docs/architecture/host-mount-governance.md`
2. Workflow authoring contract and examples: `docs/guides/workflow-host-mount-authoring.md`
3. Rollout execution and telemetry evidence: `docs/operations/host-mount-rollout-execution.md`
4. Runtime diagnostics endpoint: `GET /api/workflows/runs/:runId/host-mounts/diagnostics`
5. Startup validation and audit services: `HostMountStartupValidationService`, `HostMountAuditService`
