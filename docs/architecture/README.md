# Architecture Documentation Map

> **For a guided introduction, start at [docs/guide/README.md](../guide/README.md)** — the unified guide with C4 diagrams, domain overviews, and onboarding.

This folder contains architecture references for the orchestration engine, API contracts, runtime model, and current feature domains.

## Testing and Quality

- [Testing Strategy](../testing/README.md)
- [Workflow Testing](../testing/workflow-testing.md)

## Guides and Workflow

- [Development Workflow](../guides/development-workflow.md)
- [Skill Authoring](../guides/skill-authoring.md)
- [Prompt Management](../guides/prompt-management.md)

## Core System

- ARCH-kanban-workflow.md
- workflow-driven-kanban-policy-boundary.md
- workflow-engine.md
- playbook-orchestration.md
- rest-api.md
- telemetry-gateway.md
- container-orchestration.md
- database-schema.md
- webhooks.md
- gitops.md — GitOps reconciliation subsystem, credential resolver, `GITOPS_REQUIRE_CREDENTIALS` strict mode, env-var configuration

## Runtime and Execution

- execution-lifecycle-supervisor.md — orchestrator IP resolution override (DI tokens, strategies, setting keys, telemetry events, URL sanitization); WI-2026-064
- acp.md
- pi-agent-integration.md
- subagent-orchestration.md
- durable-agent-await.md — durable suspend/resume so an agent can await the child workflows it spawns without holding a container
- [SDD — Exact-Point Session Resume](../specs/SDD-exact-point-session-resume.md) — PI-first mid-turn checkpoint/resume: reaped/failed steps retry from the last durable snapshot (behind `SESSION_CHECKPOINT_RESUME_ENABLED`, default OFF)
- tool-registry.md
- tool-permissions-and-approvals.md
- tool-sandbox.md
- memory-management.md
- session-hydration.md
- observability.md
- security.md
- contract-versioning-policy.md
- host-mount-governance.md
- capability-governance-engine.md

## Feature Domains (EPIC-057 to EPIC-060)

- agent-skills.md
- project-goals.md
- workflow-graph-read-model.md
- agent-capability-orchestration.md
- war-room-collaboration.md

## Reliability and Diagnostics

- failure-classification-repair.md
- operations-doctor.md

## Extensibility

- plugin-system.md - trusted in-process special-step plugin architecture.
- [Plugin Platform Kernel](plugin-platform.md) - registry, lifecycle, runtime policy, worker-process adapter, and feature-gated container adapter boundary for third-party plugin isolation.
- [Writing Workflow Plugins](../guides/writing-workflow-plugins.md) - authoring guide for trusted in-process workflow/special-step plugins.

## External Integrations (EPIC-080)

- mcp-integration.md — MCP (Model Context Protocol) client runtime, server management, tool discovery

## Conversational Steering (EPIC-128)

- [Steering Operations Runbook](../operations/steering-operations-runbook.md) — Tools, session type, and workflow for conversational project steering via CEO agent chat.

## Related Operations Runbooks

- ../operations/dispatch-polling-runbook.md
- ../operations/ceo-restart-continuity-runbook.md
- ../operations/orchestration-lifecycle-hardening-runbook.md
- ../operations/war-room-retrospective-runbook.md
- ../operations/workflow-required-tools-audit-runbook.md
- ../operations/multi-service-cutover-runbook.md
- ../operations/host-mount-rollout-execution.md
- ../operations/steering-operations-runbook.md

## Architecture Decisions

Architecture Decision Records (ADRs) capture durable, hard-to-reverse
technical and orchestration choices. Two locations are in active use:

- `docs/adrs/` — the historical ADR index (`0001` … `0028`)
- `docs/architecture/ADR-*.md` — module-scoped ADRs that pair with a
  specific architecture document in this folder

### Module-scoped ADRs

- [ADR-0001 — API Module Dependency Inversion & `forwardRef` Policy](ADR-0001-api-module-dependency-inversion.md) — Reduce the `apps/api` module graph toward a DAG via leaf-module inversion and composition-root bootstrap; CI ratchets the `forwardRef` count.
- [ADR-0002 — Promote Orchestration Helpers to `@Injectable` Providers](ADR-0002-promote-orchestration-helpers-to-injectable-providers.md) — Drop manual DI in `OrchestrationService`; promote 5 helper services to NestJS providers and preserve the orchestrator↔cycle-decision cycle via the `ORCHESTRATION_CLEAR_PENDING_CONSECUTIVE_FAILURE` factory token.
- [ADR-20260623 — Per-Work-Item Orchestration Lease for `requestWorkItemRun` Link Path](ADR-20260623-work-item-run-link-lease.md) — Adopt option (b) per-work-item orchestration lease to close the orphan-run partial-write window on `requestWorkItemRun`; flag-gated rollback.
- [ADR — OAuth Login Session State Distribution](decisions/ADR-oauth-login-session-state-distribution.md) — Move the durable half of `OAuthLoginService.sessions` to Redis (`oauth:session:` namespace, 900-second TTL) and route cross-pod manual-code delivery through `RedisPubSubService`; replaces the per-pod `Map` that breaks horizontal scale and pod restart. Cross-links: [`oauth.module.ts`](../../apps/api/src/oauth/oauth.module.ts), [`oauth-login-session.store.ts`](../../apps/api/src/oauth/oauth-login-session.store.ts), [`oauth-login-session.bus.ts`](../../apps/api/src/oauth/oauth-login-session.bus.ts), [`oauth-login-session.bus.service.ts`](../../apps/api/src/oauth/oauth-login-session.bus.service.ts), [`oauth-login.service.spec.ts`](../../apps/api/src/oauth/oauth-login.service.spec.ts), [`oauth-login.service.spec-helpers.ts`](../../apps/api/src/oauth/oauth-login.service.spec-helpers.ts).

### Historical ADR index

- [docs/adrs/](../adrs/) — full list (`0001` … `0028`)
