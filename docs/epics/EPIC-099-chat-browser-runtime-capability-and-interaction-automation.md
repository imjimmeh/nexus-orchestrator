# EPIC-099: Chat Browser Runtime Capability and Interaction Automation (V3)

Status: Planned
Priority: P2
Depends On: EPIC-085, EPIC-098
Related:

1. docs/guides/workflow-web-automation-step-authoring.md
2. docs/architecture/workflow-engine.md
3. docs/architecture/chat-sessions.md
4. apps/api/src/workflow/web-automation/
   Last Updated: 2026-04-14

---

## 1. Epic Summary

Deliver V3 as a separate milestone: first-class browser interaction capability for chat agents, built on top of existing web automation infrastructure.

This epic introduces governed runtime browser actions so ad-hoc chat agents can:

1. open and navigate pages,
2. click/type/wait/read,
3. capture screenshots,
4. extract page content reliably,
5. surface deterministic failure artifacts for debugging.

---

## 2. Problem Statement

The platform already supports web_automation as workflow job type, but chat agents currently lack an equivalent general-purpose runtime tool contract for direct browser-driven tasks.

Without this capability, chat assistants cannot reliably perform common user requests such as:

1. navigate to a site and summarize content,
2. complete deterministic form interactions,
3. capture visual evidence,
4. diagnose interaction failures with reproducible artifacts.

---

## 3. Goals

1. Expose browser actions as governed runtime capabilities callable by chat agents.
2. Reuse existing action runner, selector strategy, and reliability policy implementation where possible.
3. Ensure strict isolation and lifecycle management for browser sessions per workflow run context.
4. Preserve deterministic failure artifact capture and retrieval.
5. Keep action contracts explicit, testable, and policy-aware.

---

## 4. Non-Goals

1. Building a fully unconstrained internet browsing sandbox in v3.
2. Replacing current web_automation workflow job type.
3. Implementing cross-channel UX for all adapters in this epic.
4. Broad autonomous web scraping policy beyond explicit governance controls.

---

## 5. Scope

### In Scope

1. Runtime browser action capability contract design.
2. Runtime API endpoints and service wiring for browser actions.
3. Session creation/reuse/closure model for browser contexts.
4. Selector strategy and reliability controls parity with existing web_automation policies.
5. Artifact capture and retrieval integration for failures.
6. Capability preflight and policy controls for browser actions.
7. Targeted docs and tests for runtime browser usage.

### Out of Scope

1. New browser engine provider support beyond current Playwright-based backend.
2. Full visual test framework abstraction.
3. Large-scale crawler/distributed browser orchestration.

---

## 6. Proposed Runtime Contract (Initial)

Core actions (parity target with web_automation):

1. open_page
2. navigate
3. click
4. type
5. wait_for
6. read_page
7. screenshot
8. close_page (optional but recommended for explicit cleanup)

Core request fields:

1. session_id
2. action
3. selector strategy fields (selector, alias, target_text, role/name, etc.)
4. reliability policy fields (timeout_ms, retry_budget, backoff, pacing)
5. action-specific payloads (url, text, wait state, screenshot options)

Core response fields:

1. ok
2. action
3. session_id
4. current_url
5. selected selector metadata (when applicable)
6. extracted/read payload (when applicable)
7. screenshot metadata (when applicable)
8. failure_artifact_id and diagnostics (on failure)

---

## 7. Architecture and Component Changes

### 7.1 Capability Layer

1. Add browser runtime entries to capability manifest with clear schemas.
2. Integrate with capability preflight and policy tags.
3. Ensure profile/workflow/job policy layering remains enforced.

### 7.2 Runtime API Surface

1. Add workflow-runtime controller routes for browser actions.
2. Add dedicated runtime service to orchestrate request parsing, policy, execution, and response mapping.
3. Reuse existing web automation services for action execution and failure artifact recording.

### 7.3 Session Management

1. Define browser session lifecycle for chat runtime contexts.
2. Enforce run-scoped session isolation.
3. Add cleanup hooks for terminal run states and timeout/error scenarios.

### 7.4 Reliability and Selector Strategy

1. Reuse selector resolution and fallback chain.
2. Reuse retry/backoff/pacing policy.
3. Keep deterministic behavior across repeated runs.

### 7.5 Artifact and Observability

1. Reuse existing failure artifact entity/service where possible.
2. Add runtime event logs for browser action attempts and outcomes.
3. Add diagnostics retrieval path alignment for operator troubleshooting.

---

## 8. Governance and Safety

1. Browser capabilities must remain explicit opt-in via profile allowed_tools.
2. Workflow-level policy can further narrow allowed browser actions.
3. Add optional domain allowlist/denylist controls for production hardening.
4. Enforce payload validation and action-specific required fields.
5. Ensure no sensitive token leakage in error payloads or artifacts.

---

## 9. Actionable Tasks

- [ ] E099-001 Define browser runtime capability schemas and naming conventions.
- [ ] E099-002 Add capability manifest entries and preflight integration.
- [ ] E099-003 Add workflow-runtime controller routes for browser actions.
- [ ] E099-004 Implement runtime browser actions service with validation and policy checks.
- [ ] E099-005 Integrate web automation session store for run-scoped session lifecycle.
- [ ] E099-006 Wire action runner for open_page/navigate/click/type/wait_for/read_page/screenshot.
- [ ] E099-007 Add explicit close_page or equivalent cleanup operation.
- [ ] E099-008 Integrate deterministic failure artifact capture and retrieval.
- [ ] E099-009 Add telemetry/audit events for browser runtime actions.
- [ ] E099-010 Add policy hardening hooks (domain allowlist/denylist where approved).
- [ ] E099-011 Update invoke-agent workflow/profile permissions to include approved browser runtime capabilities.
- [ ] E099-012 Add targeted unit/integration tests for runtime browser paths.
- [ ] E099-013 Update docs for runtime browser usage, limits, and troubleshooting.

---

## 10. Acceptance Criteria

1. Chat agents with approved permissions can execute browser runtime actions in ad-hoc chat runs.
2. Action behavior is deterministic and honors timeout/retry/backoff policy fields.
3. Selector fallback strategy works for dynamic DOM targets.
4. Browser sessions are isolated by runtime context and cleaned up reliably.
5. Failed actions produce reproducible artifacts and diagnostics.
6. Capability preflight and policy checks correctly deny unauthorized browser actions.
7. Logging and audit traces are sufficient for operations troubleshooting.
8. Existing web_automation workflow job behavior remains backward compatible.

---

## 11. Test and Quality Gates

Recommended verification commands from repository root:

1. npm run lint:api
2. npm run build:api
3. npm run test --workspace=apps/api -- src/workflow/step-web-automation-special-step.handler.spec.ts
4. npm run test --workspace=apps/api -- src/workflow/step-special-step-executor.service.spec.ts
5. npm run test --workspace=apps/api -- src/workflow/workflow-validation.service.spec.ts
6. npm run test --workspace=apps/api -- src/workflow/workflow-runs.controller.spec.ts
7. npm run test --workspace=apps/api -- src/tool/capability-preflight.service.spec.ts

---

## 12. Risks and Mitigations

1. Risk: Browser session leakage or orphaned resources.
   Mitigation: enforce run-scoped session ownership and terminal cleanup sweeps.
2. Risk: Flaky interactions on dynamic sites.
   Mitigation: selector fallback + reliability policy + artifact-first debugging.
3. Risk: Overly broad browsing permissions.
   Mitigation: least-privilege profile policies and optional domain-level governance.
4. Risk: Increased runtime cost for heavy browser interactions.
   Mitigation: tier-aware controls, policy defaults, and bounded retries/timeouts.

---

## 13. Exit Criteria

1. Browser runtime capability is available and governed for approved chat agent profiles.
2. Reliability, observability, and artifact behavior meet production support needs.
3. Documentation and tests are complete enough for controlled rollout.
