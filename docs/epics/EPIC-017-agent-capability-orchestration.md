# EPIC-017: Agent Capability Orchestration

> **Status:** In Progress  
> **Priority:** Critical  
> **Estimate:** 3-5 weeks  
> **Created:** 2026-03-25  
> **Owner:** TBD

---

## 1. Epic Summary

Deliver the original orchestration goals end-to-end:

1. Policy-configurable high-capability code execution for agents.
2. Reusable tool creation and lifecycle management across workflows.
3. Workflow composition (a workflow step can invoke another workflow and consume its result).
4. Hierarchical permission controls at agent, workflow, and step levels.

The implementation uses policy-constrained execution (configurable allowlists) rather than unrestricted host execution.

### Success Criteria

- [ ] `invoke_workflow` step type is supported and production-ready (success/failure/timeout paths).
- [ ] Effective permission resolution exists across agent/workflow/step scopes.
- [ ] Tool lifecycle supports create/update/reuse with runtime-safe validation.
- [ ] Web UI exposes Tools and Permission configuration surfaces.
- [ ] Audit/telemetry captures permission decisions and workflow composition lineage.
- [ ] Existing workflows remain backward compatible.

---

## 2. Scope

### In Scope

- Workflow engine + consumer changes for workflow-to-workflow orchestration.
- Permission model and runtime enforcement in API execution paths.
- Tool registry and mount resolution improvements for reusable tools.
- Web UI for tools and permission configuration.
- Unit/integration/e2e tests and documentation updates.

### Out of Scope

- External IAM federation (OIDC/SCIM) in this epic.
- Multi-tenant policy partitioning beyond current project boundaries.

---

## 3. Incremental Delivery Plan

### Slice A (starting now): Workflow Composition Foundation

- Add `invoke_workflow` step contract fields.
- Add workflow validation for invocation semantics.
- Add step-consumer execution path for child workflow invocation with completion polling.
- Add targeted unit tests.

### Slice B: Permission Hierarchy Foundation

- Add persistence and resolution for agent/workflow/step policies.
- Enforce permission checks before tool mounting and step execution.

### Slice C: Tool Lifecycle Completion

- Complete API and runtime behavior for reusable tools.
- Add effective-tool resolution and observability.

### Slice D: Web Management Surfaces

- Add Tools pages and workflow permission UI.
- Add effective permission preview per step.

---

## 4. Risks and Mitigations

- **Recursive invocation loops**  
  Mitigate with static validation and runtime depth/timeout guards.

- **Deadlocks/resource starvation**  
  Mitigate with bounded polling timeout and explicit failure propagation.

- **Permission drift between UI and runtime behavior**  
  Mitigate with a single backend effective-policy evaluator and contract tests.

---

## 5. Technical Touchpoints

- `apps/api/src/workflow/step-execution.consumer.ts`
- `apps/api/src/workflow/workflow-validation.service.ts`
- `packages/core/src/interfaces/index.ts`
- `apps/api/src/tool/tool-registry.service.ts`
- `apps/api/src/tool/tool-mounting.service.ts`
- `apps/api/src/security/iam-policy.service.ts`
- `apps/web/src/pages/workflows/WorkflowEditor.tsx`
- `apps/web/src/hooks/useTools.ts`
