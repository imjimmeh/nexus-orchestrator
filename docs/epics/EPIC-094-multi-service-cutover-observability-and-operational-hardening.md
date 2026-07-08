# EPIC-094: Multi-Service Cutover, Observability, and Operational Hardening

Status: In Progress
Priority: P1
Depends On: EPIC-090, EPIC-091, EPIC-092, EPIC-093
Related: PLAN-REFACTOR Phases 5 and 6
Last Updated: 2026-04-13

---

## 1. Epic Summary

Complete the migration to service-separated topology and decommission legacy monolith pathways with operational confidence.

---

## 2. Context

After extraction waves, the platform will temporarily run compatibility proxies and mixed ownership paths. This final epic hardens operations and removes technical debt:

1. Service-to-service trust and authorization must be standardized.
2. Event contracts and replay behavior must be production-safe.
3. Legacy routes and modules need controlled shutdown.

---

## 3. References

1. ../../PLAN-REFACTOR.md
2. ../../docker-compose.yaml
3. ../../docs/operations/README.md
4. ../../docs/architecture/telemetry-gateway.md
5. ../../docs/epics/EPIC-082-doctor-diagnostics-and-auto-repair.md
6. ../../apps/api/src/operations
7. ../../apps/api/src/telemetry

---

## 4. Scope

### In Scope

1. Introduce production-ready split-service deployment profile.
2. Implement service identity, authz, and correlation propagation for all cross-service traffic.
3. Add contract rollout checks and replay-safe event handling.
4. Remove deprecated in-monolith domain modules and compatibility shims after stabilization.
5. Finalize runbooks, rollback strategy, and canary monitoring.

### Out of Scope

1. New major product features unrelated to the split.
2. Broker/platform replacement beyond migration needs.

---

## 5. Implementation Plan

### 5.1 Deployment and Networking

1. Expand compose and environment conventions for api, kanban, and chat services.
2. Add service-specific readiness/liveness probes and startup ordering.
3. Support independent scaling profiles for core worker pools vs domain APIs.

### 5.2 Trust and Security

1. Add service-to-service JWT or mTLS identities.
2. Enforce route-level service scopes for internal APIs.
3. Ensure correlation and causation IDs are required across boundaries.

### 5.3 Observability and Diagnostics

1. Expand distributed tracing across cross-service workflow paths.
2. Add queue lag, run latency, failure, and retry dashboards by service.
3. Integrate doctor diagnostics with split-service health checks.

### 5.4 Controlled Decommissioning

1. Disable deprecated compatibility routes behind feature flags.
2. Remove legacy project/session domain modules from apps/api after stable windows.
3. Perform data and event reconciliation checks before final switch.

---

## 6. Deliverables

1. Service-separated compose/deployment topology.
2. Service trust model and auth middleware.
3. Cross-service observability dashboards and doctor checks.
4. Legacy compatibility removal plan and execution report.
5. Final cutover runbook and rollback playbook.

---

## 7. Acceptance Criteria

1. Production traffic runs through service-separated topology for two stable release windows.
2. No direct cross-service database reads remain.
3. Cross-service payloads validate against packages/core schemas at runtime boundaries.
4. Legacy compatibility routes are either removed or permanently scoped as explicit adapters.
5. SLOs meet or exceed baseline for run success rate and recovery time.

---

## 8. Actionable Tasks

- [x] E094-001 Add split-service compose profile and deployment manifests.
- [x] E094-002 Implement service identity and internal auth guards.
- [x] E094-003 Enforce cross-service correlation/causation propagation.
- [x] E094-004 Add full contract validation middleware at service boundaries.
- [x] E094-005 Expand doctor checks for schema drift, backlog, and service health.
- [ ] E094-006 Execute canary rollout and monitor operational SLOs.
- [ ] E094-007 Remove deprecated monolith routes/modules post-stabilization.
- [x] E094-008 Publish final migration and rollback runbook updates.

---

## 9. Test and Quality Gates

1. npm run lint
2. npm run lint:summary
3. Service-level test suites for api, kanban, chat
4. Cross-service contract tests
5. Deterministic kanban and chat integration regressions in split topology

---

## 10. Risks and Mitigations

1. Risk: Operational regressions during phased cutover.
   Mitigation: canary rollout, shadow traffic checks, rollback hooks.
2. Risk: Event replay and duplicate side effects.
   Mitigation: idempotency keys and inbox/outbox processors.
3. Risk: Incomplete decommission leaves hidden coupling.
   Mitigation: architecture checks and explicit module removal checklist.

---

## 11. Exit Criteria

1. Core, Kanban, and Chat run as independent services with contract-only integration.
2. Legacy in-monolith domain pathways are removed.
3. Operations team has validated monitoring, diagnostics, and recovery workflows.
