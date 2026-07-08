# EPIC-085: Web Automation Actions, Selectors, and Reliability

Status: Implemented
Priority: P1
Depends On: EPIC-068, EPIC-080
Last Updated: 2026-04-12

---

## 1. Summary

Introduce first-class browser automation and page-interaction reliability in the current app by adding:

1. reusable action primitives,
2. selector strategy abstraction,
3. robust wait/retry/pacing policies,
4. deterministic artifact capture.

This closes the practical gap versus OpenClaw's action/selector resilience without requiring external channel gateways.

---

## 2. Problem

Current workflow/tooling does not provide a unified high-reliability browser automation layer. Missing elements:

1. consistent click/type/navigate primitives with shared policy,
2. fallback selector strategies for dynamic pages,
3. wait/retry handling with explicit failure semantics,
4. deterministic run artifacts for debugging flaky behavior.

---

## 3. Goals

1. Provide standardized browser actions callable from workflow steps.
2. Add selector resolution with ranked fallback strategies.
3. Enforce deterministic retry, timeout, and pacing policies.
4. Capture reproducible artifacts for every failed automation step.

## 4. Non-Goals

1. Building cross-channel messaging integrations.
2. Replacing existing web E2E framework.

---

## 5. Architecture

### 5.1 Action Runtime

Core actions:

1. open_page,
2. navigate,
3. click,
4. type,
5. wait_for,
6. read_page,
7. screenshot.

### 5.2 Selector Strategy Layer

Selector sources:

1. explicit selector from workflow input,
2. semantic alias map,
3. heuristic fallback chain.

### 5.3 Reliability Policy

Policy controls:

1. action timeout,
2. retry budget,
3. exponential backoff,
4. anti-flake pacing window.

### 5.4 Failure Artifacts

On failure, persist:

1. action payload,
2. resolved selector trace,
3. DOM snapshot hash/reference,
4. screenshot,
5. timing and retry attempts.

---

## 6. Workstreams

1. Browser action abstraction layer.
2. Selector resolution engine and alias catalog.
3. Reliability policy and retry executor.
4. Artifact pipeline and failure triage UI.
5. Deterministic integration tests.

---

## 7. Backlog

- [x] E085-001 Add browser action contract types in core package.
- [x] E085-002 Implement action executor with per-action policy envelopes.
- [x] E085-003 Add selector strategy resolver with fallback chain.
- [x] E085-004 Add retry/backoff/pacing policy module.
- [x] E085-005 Add structured failure artifact persistence.
- [x] E085-006 Add API endpoints for artifact retrieval.
- [x] E085-007 Add workflow step authoring docs and examples.
- [x] E085-008 Add integration tests covering dynamic DOM and flaky timing.

---

## 8. Acceptance Criteria

1. Workflows can run standardized browser actions with policy controls.
2. Selector fallback improves success rate on dynamic UI targets.
3. Failed actions include complete reproducible artifact bundles.
4. Deterministic tests validate retry and timeout behavior.

---

## 9. Risks and Mitigation

1. Flakiness due to dynamic web pages.
   - Mitigate with robust waits, retries, and selector fallback hierarchy.
2. Artifact storage growth.
   - Mitigate with retention policy and compression.
