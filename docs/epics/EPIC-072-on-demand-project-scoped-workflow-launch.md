# EPIC-072: On-Demand, Project-Scoped Workflow Launch

Status: Proposed
Priority: P1
Created: 2026-04-11
Last Updated: 2026-04-11
Owner: TBD
Theme: Reusable workflow execution, project targeting, and operator UX

---

## 1. Executive Summary

The platform already supports workflow execution and trigger payloads at the API layer, but operators cannot reliably launch reusable workflows with structured inputs against a selected project from the web workflow surfaces.

This epic delivers a first-class launch experience for manual workflows:

1. Launch any eligible workflow on demand.
2. Pass structured inputs at run time.
3. Target a specific project explicitly.
4. Reuse launch presets for recurring tasks (for example: generate a new skill, update `AGENTS.md`).
5. Preserve deterministic orchestration guardrails for workflows that require work-item context.

---

## 2. Context and Current-State Analysis

### 2.1 Existing capabilities we can leverage

1. `POST /workflows/:id/execute` already accepts execution payload data (`trigger_data`) and can start manual workflows.
2. Run state already persists trigger context and supports project filtering through `trigger.projectId`.
3. Heavy execution jobs already support project repository mounting when `trigger.projectId` is provided (project `basePath` fallback path).
4. Runtime orchestration invocation already supports `project_id` and custom `trigger_data`.

### 2.2 Product gaps to close

1. Web workflow launch actions do not expose input entry or project selection for normal execution flow.
2. There is no standard launch contract that distinguishes project-scoped workflows from work-item-scoped workflows.
3. Rerun behavior is mostly replay-based and does not provide a clear editable launch path.
4. There are no reusable launch presets/templates for common project maintenance workflows.

### 2.3 Design constraints to preserve

1. Preserve existing AI config precedence and orchestration mode behavior.
2. Preserve run traceability and event integrity.
3. Preserve strict capability/permission boundaries.
4. Avoid implicit context injection that could start workflows against the wrong repository.
5. Keep workflow contracts explicit and testable.

---

## 3. Problem Statement

Operators need reusable workflows that can be run on demand for any project with explicit inputs. Today, execution primitives exist, but launch UX and contract clarity are insufficient. This creates friction for repeatable tasks such as skill generation and `AGENTS.md` updates, and increases risk of incorrect context at invocation time.

---

## 4. Goals

1. Provide a first-class workflow launch flow with project picker and structured inputs.
2. Standardize manual workflow launch contracts for runtime validation and UI form generation.
3. Add a clear project-scoped invocation path for reusable workflows.
4. Support rerun-with-edits and saved launch presets.
5. Ensure workflows that require work-item context are safely gated and clearly communicated.
6. Add focused tests and telemetry for launch correctness and adoption.

---

## 5. Non-Goals

1. Replacing the workflow engine runtime model.
2. Reworking unrelated orchestration lifecycle policy logic.
3. Building a generic no-code workflow designer in this epic.
4. Expanding to cross-project bulk execution in v1.
5. Changing model/provider resolution precedence.

---

## 6. Scope Overview

This epic is delivered in six workstreams:

1. **WS1: Manual Launch Contract and Validation**
2. **WS2: Project-Scoped Invocation API Surface**
3. **WS3: Workflow Launch UX (Global and Project Surfaces)**
4. **WS4: Reusable Presets and Seeded Workflow Examples**
5. **WS5: Guardrails, Eligibility, and Error Semantics**
6. **WS6: Observability, Tests, and Rollout**

---

## 7. Desired End-State Behavior

1. A user can open a workflow launch dialog, select a project, fill required inputs, and run.
2. Eligible workflows declare launch schema and project requirements, and the backend validates invocation payloads.
3. Project workspace provides quick-launch for project-relevant workflows.
4. Rerun supports editing launch inputs before execution.
5. Operators can save/reuse launch presets for recurring tasks.
6. Workflows requiring `workItemId` are blocked from project-only launch with clear messaging.
7. Every run records deterministic launch context for auditing and filtering.

---

## 8. Workstreams and Detailed Tasks

### WS1: Manual Launch Contract and Validation

#### Task E072-001: Define launch metadata contract for manual workflows

Description:
Define and document launch metadata for manual workflows, including input schema, required fields, defaults, and context requirements (`project`, `work_item`, or `none`).

Acceptance Criteria:

1. Contract supports typed input fields and required markers.
2. Contract expresses context requirement explicitly.
3. Contract is documented and validated in bootstrap/seed paths.

#### Task E072-002: Add execution payload validation for manual launch

Description:
Validate incoming launch payloads against workflow launch contract before run start.

Acceptance Criteria:

1. Invalid payloads are rejected with structured validation errors.
2. Missing required context (`projectId`, `workItemId`) fails fast with actionable messages.
3. Valid payloads preserve current execution behavior.

#### Task E072-003: Normalize trigger context for downstream step handlers

Description:
Ensure launch context is normalized once and available consistently to workflow runtime and step handlers.

Acceptance Criteria:

1. `trigger.projectId` and optional `trigger.workItemId` are consistently shaped.
2. Existing consumers continue to function without contract drift.
3. Regression tests cover normalization behavior.

---

### WS2: Project-Scoped Invocation API Surface

#### Task E072-004: Add project-scoped workflow execute endpoint

Description:
Add an API path that binds execution to a selected project and injects/validates project context.

Acceptance Criteria:

1. New endpoint executes workflow with explicit project scope.
2. Endpoint enforces context compatibility with workflow contract.
3. Response shape aligns with existing workflow execute responses.

#### Task E072-005: Align project-scoped run queries and run metadata

Description:
Guarantee project-scoped launches are queryable and visible in existing run/event APIs.

Acceptance Criteria:

1. Project-filtered run queries include launches from new API path.
2. Run metadata includes project context consistently.
3. No regressions for existing run/event list consumers.

---

### WS3: Workflow Launch UX (Global and Project Surfaces)

#### Task E072-006: Build workflow launch modal with project and input form

Description:
Introduce a launch modal in workflow list/detail screens with project selector and schema-driven input form, with raw JSON fallback for advanced use.

Acceptance Criteria:

1. Users can select project and submit structured inputs.
2. Required fields and validation errors are rendered clearly.
3. Existing execute buttons route through the new launch flow for manual workflows.

#### Task E072-007: Add project workspace quick-launch surface

Description:
Provide a project-first launch entrypoint that preselects the project and lists relevant workflows.

Acceptance Criteria:

1. Project workspace users can launch eligible workflows in-context.
2. Project preselection is immutable or explicit in this flow.
3. UX clearly differentiates eligible/ineligible workflows.

#### Task E072-008: Add rerun-with-edit capability

Description:
Allow users to rerun a workflow using previous payload as a draft that can be edited before submission.

Acceptance Criteria:

1. Rerun opens launch form with previous values prefilled.
2. Users can edit and resubmit payload.
3. Audit trail distinguishes replay from edited rerun.

---

### WS4: Reusable Presets and Seeded Workflow Examples

#### Task E072-009: Add saved launch presets for recurring project tasks

Description:
Enable users to save named launch presets per workflow/project combination.

Acceptance Criteria:

1. Users can create, select, and manage presets.
2. Presets store input payload and target project reference.
3. Preset usage is tracked in run metadata/events.

#### Task E072-010: Seed reusable examples for project maintenance workflows

Description:
Provide reusable workflow examples for common operational tasks, such as skill generation and `AGENTS.md` maintenance.

Acceptance Criteria:

1. Seeded examples include clear launch schema and context requirements.
2. Examples execute with project-scoped launch flow.
3. Seed contract validation covers new examples.

---

### WS5: Guardrails, Eligibility, and Error Semantics

#### Task E072-011: Add workflow launch eligibility model

Description:
Introduce eligibility signals so UI/API can hide or block workflows that cannot run with the current context.

Acceptance Criteria:

1. Eligibility is derivable from workflow contract.
2. Ineligible workflows provide explicit reason codes.
3. UI surfaces reason without ambiguous failures.

#### Task E072-012: Harden permission checks for launch and preset operations

Description:
Enforce role and project access controls for launch, rerun, and preset usage.

Acceptance Criteria:

1. Unauthorized launch attempts are rejected consistently.
2. Preset operations follow same project permission model.
3. Security tests cover positive and negative cases.

---

### WS6: Observability, Tests, and Rollout

#### Task E072-013: Add launch telemetry and diagnostics

Description:
Emit explicit events for launch requested/validated/rejected/executed to improve supportability and product analytics.

Acceptance Criteria:

1. Launch lifecycle events are emitted with workflow and project context.
2. Error telemetry includes machine-readable validation reason.
3. Existing telemetry streams remain backward compatible.

#### Task E072-014: Add backend and frontend regression coverage

Description:
Add tests for contract validation, project-scoped execution, launch form UX, rerun edits, and eligibility handling.

Acceptance Criteria:

1. API tests cover success and failure paths.
2. Web tests cover launch flows and validation rendering.
3. Existing workflow execution behavior remains stable.

---

## 9. Acceptance Criteria (Epic-Level)

1. Operators can launch manual workflows with explicit project and inputs from the UI.
2. Backend validates launch payloads against workflow contract and returns structured errors.
3. Project-only and work-item-required workflows are correctly gated.
4. Rerun-with-edit and saved presets work for eligible workflows.
5. Seeded project-maintenance workflows run successfully with the new launch path.
6. Project-scoped run/event visibility remains correct.

---

## 10. Risks and Mitigations

1. Risk: Workflow contract drift between backend and web form generation.
   - Mitigation: Shared typed schema and contract tests.
2. Risk: Incorrect project targeting in high-volume operations.
   - Mitigation: Explicit project binding in API and immutable project context in project-scoped entrypoints.
3. Risk: Confusing failures for ineligible workflows.
   - Mitigation: Eligibility reason codes and user-facing explanatory messages.
4. Risk: Scope creep into full workflow design tooling.
   - Mitigation: Keep epic focused on launch, validation, and reusable invocation.

---

## 11. References

1. `apps/api/src/workflow/workflow.controller.ts`
2. `apps/api/src/workflow/workflow.controller.dto.ts`
3. `apps/api/src/workflow/workflow-engine.service.ts`
4. `apps/api/src/workflow/step-support.service.ts`
5. `apps/web/src/lib/api/client.ts`
6. `apps/web/src/lib/api/types.ts`
7. `apps/web/src/pages/workflows/Workflows.tsx`
8. `apps/web/src/pages/workflows/WorkflowDetail.tsx`
9. `apps/web/src/pages/workflows/workflow-run-detail.mutations.ts`
10. `seed/workflows/*.workflow.yaml`
