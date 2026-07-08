# EPIC-103: Heavy Runner Local Browser Runtime Execution

Status: Proposed
Priority: P1
Depends On: EPIC-014, EPIC-085, EPIC-099, EPIC-100
Related:

1. docs/architecture/pi-agent-integration.md
2. docs/architecture/workflow-engine.md
3. apps/api/src/tool/capability-manifest.runtime.browser.entries.ts
4. apps/api/src/tool/tool-mounting.service.ts
5. packages/pi-runner/src/session-factory.ts
6. docker/Dockerfile.heavy
7. apps/api/src/workflow/web-automation/
   Last Updated: 2026-04-15

---

## 1. Epic Summary

Move browser runtime execution from API-owned Playwright callbacks to heavy-tier runner-local execution.

Target outcomes:

1. Browser tools execute inside heavy agent containers.
2. API no longer needs Playwright runtime ownership for normal browser actions.
3. Heavy image becomes the single execution owner for browser runtime dependencies.
4. Tool usage telemetry remains visible in existing run/event streams.

---

## 2. Problem Statement

Browser runtime capabilities are currently defined as api_callback transport and runtimeOwner api. The runner only proxies browser requests to API endpoints, and API launches Playwright.

This causes platform issues:

1. Runtime ownership mismatch: browser actions are conceptually agent-execution concerns but run in control-plane API containers.
2. Packaging pressure on API image: API must include browser binaries and OS dependencies.
3. Operational fragility: Playwright runtime failures in API block browser tools even when heavy runner exists.
4. Scalability constraints: browser execution load competes with control-plane API responsibilities.

---

## 3. Goals

1. Make heavy runner the primary execution owner of browser runtime tools.
2. Keep tool names and user-facing contracts stable where possible.
3. Preserve least-privilege policy controls and tier restrictions.
4. Preserve observability and deterministic failure diagnostics.
5. Support phased rollout with low-risk rollback.

---

## 4. Non-Goals

1. Replacing workflow web_automation job type in this epic.
2. Broad redesign of all runtime tool transports.
3. Introducing multi-browser provider abstraction beyond current Playwright Chromium.
4. Removing API artifact endpoints before replacement parity is achieved.

---

## 5. Architecture Direction

### 5.1 Ownership Shift

1. Browser action execution moves to runner runtime for heavy tier containers.
2. API keeps orchestration, authorization, and optional artifact persistence services.
3. Light tier continues without browser runtime execution capability.

### 5.2 Capability Contract Evolution

1. Browser capability entries migrate from api_callback semantics to runner-local mounted execution semantics.
2. runtimeOwner for browser entries changes from api to runner.
3. tierRestriction remains heavy.

### 5.3 Execution Model

1. Runner loads mounted tool metadata.
2. Browser tool calls are dispatched to local Playwright action handlers.
3. Runner returns tool result payloads directly to session runtime.
4. API callback remains available for non-browser tools.

---

## 6. Scope

### In Scope

1. Browser capability transport/ownership migration to runner-local execution.
2. Runner browser action executor and session lifecycle management.
3. Heavy image Playwright dependency ownership.
4. API manifest and mounting metadata updates required for runner-local browser execution.
5. Rollout controls, testing, and documentation updates.

### Out of Scope

1. Full crawler/distributed browser architecture.
2. Browser runtime support for light tier.
3. Complete removal of API web-automation support in the first rollout wave.

---

## 7. Proposed Phased Implementation

### 7.1 Phase 1: Contracts and Metadata

1. Update browser capability entries to runner ownership and non-api transport.
2. Extend mounted tool metadata to express local execution dispatch intent.
3. Keep capability validation strict for transport-callback consistency.

### 7.2 Phase 2: Runner Local Browser Executor

1. Implement runner-local browser runtime service in pi-runner.
2. Add handlers for open_page, navigate, click, type, wait_for, read_page, screenshot.
3. Add runner-local browser session store and cleanup hooks.

### 7.3 Phase 3: Image Ownership and Packaging

1. Install Playwright Chromium in docker/Dockerfile.heavy.
2. Ensure heavy image includes required system dependencies.
3. Remove API image Playwright runtime dependency for browser actions.

### 7.4 Phase 4: Artifact and Diagnostics Parity

1. Preserve deterministic failure diagnostics behavior.
2. Choose rollout strategy:
   1. initial local-only diagnostics in runner results, or
   2. push failure artifacts to API persistence endpoints.
3. Complete parity path before deprecating API browser runtime internals.

### 7.5 Phase 5: Cutover and Cleanup

1. Enable runner-local browser execution by default for heavy tier.
2. Retire API browser action execution path once parity and stability are confirmed.
3. Keep explicit rollback switch for one release cycle.

---

## 8. Actionable Tasks

- [ ] E103-001 Update browser capability manifest entries to runtimeOwner runner.
- [ ] E103-002 Update browser capability transport away from api_callback semantics.
- [ ] E103-003 Extend mounted tool metadata schema for runner-local dispatch.
- [ ] E103-004 Update API tool mounting service to emit new browser metadata.
- [ ] E103-005 Add runner browser runtime manager for Playwright lifecycle.
- [ ] E103-006 Add runner-local browser session store and deterministic cleanup.
- [ ] E103-007 Implement runner handlers for browser_open_page and browser_navigate.
- [ ] E103-008 Implement runner handlers for browser_click and browser_type.
- [ ] E103-009 Implement runner handlers for browser_wait_for and browser_read_page.
- [ ] E103-010 Implement runner handler for browser_screenshot.
- [ ] E103-011 Wire mounted tool execution path to local browser handlers in session factory.
- [ ] E103-012 Add feature flag for runner-local browser execution cutover.
- [ ] E103-013 Add heavy image Playwright install/dependency provisioning.
- [ ] E103-014 Remove API runtime dependence on Playwright for browser actions.
- [ ] E103-015 Add contract validation tests for migrated browser capability entries.
- [ ] E103-016 Add runner unit tests for browser handler success/failure paths.
- [ ] E103-017 Add integration tests for heavy-tier browser execution and tool telemetry.
- [ ] E103-018 Add rollback and operational runbook updates.

---

## 9. Acceptance Criteria

1. Browser tools execute successfully in heavy runner containers without API browser callbacks.
2. API can run without Playwright browser runtime for normal browser action execution.
3. Tool usage events remain visible and correlated in existing workflow telemetry.
4. Browser session lifecycle is isolated per run context and cleaned up reliably.
5. Failure diagnostics remain actionable and deterministic.
6. Light-tier runs do not expose heavy browser runtime behavior.
7. Feature flag allows rollback to previous browser execution path during rollout window.

---

## 10. Test and Quality Gates

Recommended verification commands from repository root:

1. npm run lint
2. npm run build:api
3. npm run test --workspace=apps/api -- src/tool/capability-contract-validator.service.spec.ts
4. npm run test --workspace=apps/api -- src/workflow/workflow-runtime-browser-actions.service.spec.ts
5. npm run test --workspace=apps/api -- src/workflow/step-agent-container-support.service.spec.ts
6. npm run test --workspace=packages/pi-runner
7. docker build -f docker/Dockerfile.heavy -t nexus-heavy:latest .

---

## 11. Risks and Mitigations

1. Risk: Behavior drift from API web-automation implementation.
   Mitigation: contract fixtures and cross-path parity tests for action inputs/outputs.
2. Risk: Runner browser session leaks under retries/timeouts.
   Mitigation: centralized runner session manager with teardown on terminal states.
3. Risk: Telemetry blind spots after transport migration.
   Mitigation: preserve tool execution event schema and add cutover dashboards.
4. Risk: Image size and startup time increases in heavy tier.
   Mitigation: keep browser dependencies heavy-only and monitor build/runtime metrics.
5. Risk: Incomplete artifact parity during migration.
   Mitigation: staged rollout with explicit parity checklist before API path retirement.

---

## 12. Exit Criteria

1. Heavy runner is the default execution owner for browser runtime tools.
2. API browser runtime execution path is retired or explicitly deprecated behind a rollback switch.
3. Documentation and runbooks reflect heavy-tier browser ownership and troubleshooting flow.
4. Quality gates pass for API and pi-runner paths touched by this migration.
