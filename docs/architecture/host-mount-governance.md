# Host-Mount Governance Architecture

This document defines the governance model for EPIC-100 governed host mounts.

## Scope

Governed host mounts allow workflows and subagents to access approved host paths through alias-based contracts only.

Required properties:

1. Alias-only mount requests (`host_mounts[].alias`)
2. Relative subpath constraints (`host_mounts[].subpath`)
3. Policy intersection across global, project, workflow, profile, and job layers
4. Read-write approval gates
5. Event-ledger audit records for request, approval, denial, attach, and remove lifecycle events

## Trust Boundaries

1. Docker host: source of truth for bind source paths
2. API container: policy decision point and mount path resolver
3. Runner container: constrained consumer under `/workspace/host-shares/*`
4. Workflow author: can request aliases but cannot bypass policy layers
5. Agent profile owner: can narrow mount access, never expand beyond catalog and project policy

## Threat Model Matrix

| Threat | Attack Path | Primary Controls | Detection |
| --- | --- | --- | --- |
| Arbitrary host path access | Raw path injection in workflow/job payloads | Alias-only contract + catalog lookup | `workflow.host_mount.denied` events |
| Traversal out of alias root | `../` or absolute subpath input | Safe relative subpath validation + containment checks | Validation errors + denied events |
| Symlink escape | Alias subpath symlink resolves outside root | `realpath` containment enforcement | Denied events with reason |
| Write-surface escalation | Request `rw` without explicit allow | RW allow-list intersection + catalog writable guard | Denied/approval-required events |
| Silent privileged writes | RW alias used without explicit approval | Approval-required preflight outcome | `workflow.host_mount.approval_required` |
| Drift between mounted and approved scopes | Container has stale/mismatched mounts | Scope manifest and runtime diagnostics | Run diagnostics + runtime artifact inspector |

## Governance Matrix

| Layer | Allow Keys | Deny Keys | RW Allow Keys | Expansion Allowed |
| --- | --- | --- | --- | --- |
| Global catalog | alias existence | n/a | `writable_allowed` | No |
| Project policy | `allow_host_mounts` | `deny_host_mounts` | `allow_host_mount_rw` | No |
| Workflow policy | `allow_host_mounts` | `deny_host_mounts` | `allow_host_mount_rw` | No |
| Agent profile | `allowed_mount_aliases` | `denied_mount_aliases` | `allow_rw_mount_aliases` | No |
| Job request | `host_mounts` request set | n/a | mode request | No |

Effective access is computed by intersection across all allow lists with deny-overrides.

## Approval Model

Read-write requests require all of the following:

1. Catalog entry is writable (`writable_allowed=true`)
2. Alias is in all effective RW allow lists
3. Approval gate is not required

Approval gate triggers when either condition is true:

1. Global setting `workflow_host_mount_rw_approval_required=true`
2. Catalog entry sets `approval_required_on_rw=true`

Preflight behavior:

1. `resolved`: return concrete bindings
2. `approval_required`: return required approvals without provisioning

## Runtime and Audit Surfaces

Audit events emitted via Event Ledger:

1. `workflow.host_mount.requested`
2. `workflow.host_mount.approved`
3. `workflow.host_mount.denied`
4. `workflow.host_mount.approval_required`
5. `workflow.host_mount.attached`
6. `workflow.host_mount.removed`

Diagnostics APIs:

1. `GET /api/workflows/runs/:runId/host-mounts/diagnostics`
2. `GET /api/operations/doctor` (includes stale host-share mount diagnostics)

Example catalog entries:

1. Standard host-share alias:
	`{"project_docs":{"api_root":"/data/nexus-host-shares/project-docs","default_mode":"ro","writable_allowed":true}}`
2. Persistent skills-library alias:
	`{"skills_library":{"api_root":"/data/nexus-skills","default_mode":"ro","writable_allowed":true,"approval_required_on_rw":true}}`

The `skills_library` alias is intentionally rooted outside `NEXUS_API_HOST_SHARE_BASE_PATH`; nested Docker remap for this alias relies on the pair `NEXUS_SKILLS_LIBRARY_PATH` and `NEXUS_HOST_SKILLS_PATH` instead of `NEXUS_HOST_SHARE_MOUNT_PATH`.

## Hardening Defaults

1. Host mount catalog required for all alias resolution
2. No implicit subagent host-mount inheritance
3. No RW bypass toggle
4. Runner scope manifest enforced for file operations under host-share paths

## Implementation References

1. `apps/api/src/workflow/host-mount-resolution.service.ts`
2. `apps/api/src/workflow/host-mount-preflight-resolution.helpers.ts`
3. `apps/api/src/workflow/step-agent-container-support.service.ts`
4. `apps/api/src/workflow/workflow-host-mount-runtime-diagnostics.service.ts`
5. `apps/api/src/operations/runtime-artifacts-inspector.service.ts`
6. `packages/pi-runner/src/session-factory.host-mount-scope.ts`
