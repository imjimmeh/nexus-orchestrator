# EPIC-061: Honcho Memory Backend and Self-Hosted Compose Integration

> Status: Proposed
> Priority: Critical
> Estimate: 3-5 weeks
> Created: 2026-04-06
> Last Updated: 2026-04-06
> Owner: TBD

---

## 1. Epic Summary

Replace Nexus local `memory_segments`-backed retrieval with a Honcho-backed memory system while preserving the existing `query_memory` runtime contract and operating Honcho in the same Docker Compose stack as Nexus.

This epic is compatibility-first:

1. Keep agent-facing tool names, route names, and payload shapes stable.
2. Add backend abstraction and feature flags so rollout can be staged and reversible.
3. Self-host Honcho services inside existing infrastructure boundaries.
4. Perform idempotent backfill and parity validation before hard cutover.

### 1.1 Implementation Targets

1. `query_memory` continues to work with no workflow/prompt contract changes.
2. Honcho runs locally in Compose with health checks and persistent storage.
3. API supports `postgres`, `honcho`, and `dual` memory backends.
4. Legacy memory can be migrated with repeatable, checkpointed jobs.
5. Rollback can be done by config toggle only.

### 1.2 Success Criteria

1. No functional regressions in workflows relying on `query_memory`.
2. Honcho-backed retrieval parity is within approved threshold versus legacy search.
3. Query latency and failure rates remain within existing SLO expectations.
4. Cutover can be reversed in under 5 minutes by environment change.

---

## 2. Problem Statement

Nexus memory retrieval currently depends on simple relational storage and keyword `LIKE` search over `memory_segments`. This is reliable but limited for long-running entity memory use cases and does not leverage richer memory reasoning/context facilities.

At the same time, there is broad coupling to `query_memory` across workflow seeds, IAM policy definitions, profile permissions, runtime capability manifests, and tests. Any migration that changes those surfaces would be high risk.

Therefore, the migration must swap the backend implementation only, not the runtime contract.

---

## 3. Current-State Architecture (Nexus)

### 3.1 Runtime contract path

1. Tool capability registration:
   - `apps/api/src/tool/capability-manifest.runtime.entries.ts`
   - `query_memory` maps to `POST /api/workflow-runtime/query-memory`.
2. Route/controller:
   - `apps/api/src/workflow/workflow-runtime-tools.controller.ts`
3. Service execution:
   - `apps/api/src/workflow/workflow-runtime-tools.service.ts`
   - `queryMemory(...)` delegates to `MemoryManagerService`.
4. Persistence layer:
   - `apps/api/src/memory/memory-manager.service.ts`
   - `apps/api/src/database/repositories/memory-segment.repository.ts`
   - `apps/api/src/database/entities/memory-segment.entity.ts`

### 3.2 Shared contract type

- `IMemorySegment` in `packages/core/src/interfaces/index.ts`.
- Includes `entity_type`, `entity_id`, `memory_type`, `content`, `version`, timestamps.

### 3.3 Coupling surfaces to preserve

1. IAM policy allow lists:
   - `apps/api/src/security/iam-policy.service.ts`
2. Setup defaults and tool seeding paths:
   - `apps/api/src/setup/setup.service.ts`
3. Workflow seed `allow_tools` entries across CEO and work-item workflows.
4. Test fixtures/specs that assert `query_memory` visibility and behavior.

### 3.4 Adjacent but separate subsystem

Session hydration/distillation pipeline is separate from memory segment retrieval:

1. `apps/api/src/session/session-hydration.service.ts`
2. `apps/api/src/memory/distillation.consumer.ts`
3. `apps/api/src/memory/token-counter.service.ts`

This epic does not replace distillation logic initially.

---

## 4. Honcho Capability and Deployment References

Primary upstream references used for this design:

1. Honcho repository root:
   - https://github.com/plastic-labs/honcho
2. README (architecture, setup, local docker flow):
   - https://raw.githubusercontent.com/plastic-labs/honcho/main/README.md
3. Self-hosting guide (v3):
   - https://github.com/plastic-labs/honcho/tree/main/docs/v3/contributing/self-hosting.mdx
4. Configuration guide (v3):
   - https://github.com/plastic-labs/honcho/tree/main/docs/v3/contributing/configuration.mdx
5. Docker entrypoint behavior (migrations + API startup):
   - https://github.com/plastic-labs/honcho/tree/main/docker/entrypoint.sh
6. Migration guidance style (mem0 example):
   - https://github.com/plastic-labs/honcho/tree/main/docs/v3/guides/migrations/mem0.mdx
7. SDK usage and base URL overrides:
   - https://docs.honcho.dev/

### 4.1 Honcho architecture primitives relevant to Nexus mapping

1. Workspace
2. Peer
3. Session
4. Message
5. Collections and Documents
6. Context/Search/Representation/Chat retrieval interfaces

### 4.2 Self-host requirements relevant to this epic

1. PostgreSQL with pgvector extension.
2. API process and deriver worker process.
3. Config via env/config file with env precedence.
4. Health endpoint at `/health` for service checks.

### 4.3 Licensing gate

Honcho repository is AGPL-3.0. Legal and compliance signoff is required before production rollout.

---

## 5. Scope

### 5.1 In scope

1. Add Honcho services to root Compose stack.
2. Introduce memory backend abstraction in Nexus API.
3. Implement Honcho adapter while preserving `query_memory` response envelope.
4. Add feature flags for backend selection and fallback.
5. Build idempotent migration tooling from `memory_segments`.
6. Add parity validation and observability for migration/cutover.
7. Execute staged rollout with rollback plan.

### 5.2 Out of scope

1. Replacing workflow/session distillation behavior in this epic.
2. Changing `query_memory` tool name or route contract.
3. Refactoring orchestration prompt strategies unrelated to memory backend.
4. Migrating to hosted Honcho SaaS (this epic is self-host only).

---

## 6. Target Architecture

### 6.1 Compatibility-first adapter architecture

Introduce a backend interface behind `MemoryManagerService`:

```ts
export interface MemoryBackend {
  getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: { memory_type?: "preference" | "fact" | "history" },
  ): Promise<IMemorySegment[]>;

  searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]>;

  createMemorySegment?(...args: unknown[]): Promise<IMemorySegment>;
  updateMemorySegment?(...args: unknown[]): Promise<IMemorySegment | null>;
  deleteMemorySegment?(id: string): Promise<void>;
}
```

Concrete implementations:

1. `PostgresMemoryBackend` (existing repository behavior).
2. `HonchoMemoryBackend` (HTTP adapter to Honcho).
3. `DualReadMemoryBackend` (Honcho primary, Postgres fallback).

### 6.2 Entity mapping strategy

Use deterministic peer identity:

- `peer_id = ${entity_type}:${entity_id}`

Workspace strategy options:

1. `per_project` (preferred): isolate memory by project/work context.
2. `global`: single workspace for all entities.

Initial default: `per_project` when project context is available, else `global` fallback.

### 6.3 Response normalization contract

`query_memory` output must remain:

1. `entity_type`
2. `entity_id`
3. `query`
4. `memory_type`
5. `count`
6. `segments[]` with fields expected by current code/tests.

When Honcho does not provide exact fields:

1. `memory_type`: infer from metadata tags, fallback to `history`.
2. `version`: fallback to `1`.
3. timestamps: map from source timestamps where available.

---

## 7. Detailed Implementation Plan

## Phase 0: Governance, ADR, and Spike

### Task 0.1: Add ADR for backend transition and AGPL boundary

Files:

1. `docs/adrs/0002-honcho-memory-backend-transition.md` (new)

Acceptance criteria:

1. ADR documents reasons, alternatives, licensing implications, and rollback approach.
2. Legal signoff checklist is explicitly captured.

### Task 0.2: Adapter spike against local Honcho

Files:

1. `apps/api/src/memory/honcho/honcho-adapter.spike.ts` (temporary)
2. `docs/analysis/ANALYSIS-honcho-adapter-spike.md` (new)

Acceptance criteria:

1. Demonstrated read/search calls can be normalized into `IMemorySegment` list.
2. Known field gaps and assumptions are documented.

## Phase 1: Compose Self-Hosting Integration

### Task 1.1: Add Honcho services to root compose

Files:

1. `docker-compose.yaml`
2. Optional: `.env.example` or README docs where env vars are described.

Services to add:

1. `honcho-db` (pgvector)
2. `honcho-api`
3. `honcho-deriver`
4. Optional `honcho-redis` if shared redis isolation is not acceptable

Recommended container-network URLs:

1. `http://honcho-api:8000` for Nexus API internal calls.

Acceptance criteria:

1. `honcho-api` healthy at `/health`.
2. `honcho-deriver` starts successfully and remains connected.
3. Data volumes persist across restarts.

### Task 1.2: Operational docs for local/dev boot

Files:

1. `README.md`
2. `apps/api/README.md` (if memory integration config is documented there)

Acceptance criteria:

1. Step-by-step local startup instructions include Honcho service readiness checks.
2. Required env vars are listed with defaults.

## Phase 2: Backend Abstraction in API

### Task 2.1: Introduce memory backend interface and selector

Files:

1. `apps/api/src/memory/memory-backend.interface.ts` (new)
2. `apps/api/src/memory/memory-backend.factory.ts` (new)
3. `apps/api/src/memory/memory.module.ts`
4. `apps/api/src/memory/memory-manager.service.ts`

Acceptance criteria:

1. `MemoryManagerService` no longer directly depends on repository for read/search.
2. Backend selection is config-driven via `MEMORY_BACKEND`.
3. Existing tests pass in default `postgres` mode.

### Task 2.2: Keep route/tool contract unchanged

Files:

1. `apps/api/src/workflow/workflow-runtime-tools.service.ts`
2. `apps/api/src/workflow/workflow-runtime-tools.controller.ts`

Acceptance criteria:

1. No API contract changes required by existing agent workflows.
2. Existing capability manifest entry remains valid.

## Phase 3: Honcho Client and Adapter

### Task 3.1: Add typed Honcho HTTP client

Files:

1. `apps/api/src/memory/honcho/honcho-client.service.ts` (new)
2. `apps/api/src/memory/honcho/honcho.types.ts` (new)

Acceptance criteria:

1. Timeouts, retries, and error mapping are explicit.
2. Auth headers configurable via env.

### Task 3.2: Implement `HonchoMemoryBackend`

Files:

1. `apps/api/src/memory/honcho/honcho-memory-backend.service.ts` (new)
2. `apps/api/src/memory/memory.module.ts`
3. `apps/api/src/memory/memory-manager.service.spec.ts`
4. `apps/api/src/workflow/workflow-runtime-tools.service.spec.ts`

Acceptance criteria:

1. `getMemorySegments` and `searchMemory` normalized to legacy shape.
2. Behavior under Honcho error conditions is deterministic.
3. Unit tests cover mapping and failures.

### Task 3.3: Add dual-mode fallback backend

Files:

1. `apps/api/src/memory/dual-read-memory-backend.service.ts` (new)
2. `apps/api/src/memory/memory.module.ts`

Acceptance criteria:

1. Honcho attempted first when in dual mode.
2. Postgres fallback occurs on transport errors and empty/invalid responses as configured.
3. Fallback is observable via logs/metrics.

## Phase 4: Data Migration and Backfill

### Task 4.1: Build migration runner

Files:

1. `apps/api/scripts/migrate-memory-segments-to-honcho.ts` (new)
2. `apps/api/scripts/migrate-memory-segments-to-honcho.spec.ts` (new)

Capabilities:

1. Dry-run mode.
2. Batched reads from `memory_segments`.
3. Idempotent writes to Honcho (dedupe keys).
4. Resume support from checkpoint.

Acceptance criteria:

1. Script can be re-run safely.
2. Progress and errors are emitted with entity IDs and counts.
3. Script exits non-zero on hard failures with actionable logs.

### Task 4.2: Add migration checkpoint persistence

Files:

1. `apps/api/src/database/entities/memory-migration-checkpoint.entity.ts` (new)
2. migration file in `apps/api/src/database/migrations/`

Acceptance criteria:

1. Checkpoint table stores last processed cursor and job metadata.
2. Resume picks up from checkpoint without duplicate writes.

## Phase 5: Validation, Observability, and Quality Gates

### Task 5.1: Parity validation tool

Files:

1. `apps/api/scripts/validate-honcho-parity.ts` (new)
2. `docs/analysis/ANALYSIS-honcho-memory-parity-template.md` (new)

Validation behavior:

1. Sample entities across `User`, `Project`, `System`.
2. Compare result counts and semantic relevance buckets.
3. Emit divergence report with severity.

Acceptance criteria:

1. Gate threshold can be configured.
2. Script returns non-zero when threshold exceeded.

### Task 5.2: Metrics and logs

Files:

1. `apps/api/src/observability/*` (as needed)
2. `apps/api/src/memory/*`

Metrics to add:

1. `memory_backend_requests_total{backend,operation,status}`
2. `memory_backend_latency_ms{backend,operation}`
3. `memory_backend_fallback_total{from,to,reason}`
4. `memory_query_result_count{backend}`

Acceptance criteria:

1. Metrics available in existing telemetry/observability surfaces.
2. Error logs include correlation ID and backend mode.

## Phase 6: Staged Cutover and Rollback

### Task 6.1: Stage environment rollout

Rollout order:

1. local/dev in `dual` mode
2. staging in `dual` mode
3. staging in `honcho` mode
4. production in `dual` mode
5. production in `honcho` mode after validation window

Acceptance criteria:

1. Each step has explicit go/no-go checks.
2. Rollback procedure validated in staging.

### Task 6.2: Legacy path deprecation plan

Files:

1. Follow-up epic or section update after stabilization window

Acceptance criteria:

1. Legacy repository reads are disabled only after proven stability.
2. `memory_segments` table is not dropped until post-cutover window ends.

## Phase 7 (Optional): Distillation Convergence

Evaluate replacing selected local context-distillation behaviors with Honcho context retrieval.

This is intentionally a separate epic to prevent scope creep and protect current session continuity behavior.

---

## 8. Configuration Contract

### 8.1 New Nexus API environment variables

1. `MEMORY_BACKEND=postgres|honcho|dual`
2. `HONCHO_BASE_URL=http://honcho-api:8000`
3. `HONCHO_API_KEY=` (optional when auth disabled)
4. `HONCHO_DEFAULT_WORKSPACE=nexus`
5. `HONCHO_WORKSPACE_STRATEGY=global|per_project`
6. `HONCHO_REQUEST_TIMEOUT_MS=5000`
7. `HONCHO_RETRY_COUNT=2`

### 8.2 Honcho service environment highlights

Per upstream documentation/configuration:

1. `DB_CONNECTION_URI` with `postgresql+psycopg://...` prefix
2. optional LLM provider keys
3. auth flags for local/dev

---

## 9. Proposed Compose Topology (Reference)

```yaml
services:
  honcho-db:
    image: pgvector/pgvector:pg15
    environment:
      - POSTGRES_USER=honcho
      - POSTGRES_PASSWORD=honcho_password
      - POSTGRES_DB=honcho
    volumes:
      - honcho_postgres_data:/var/lib/postgresql/data

  honcho-api:
    image: ghcr.io/plastic-labs/honcho:latest
    environment:
      - DB_CONNECTION_URI=postgresql+psycopg://honcho:honcho_password@honcho-db:5432/honcho
      - AUTH_USE_AUTH=false
    depends_on:
      - honcho-db

  honcho-deriver:
    image: ghcr.io/plastic-labs/honcho:latest
    command: ["python", "-m", "src.deriver"]
    environment:
      - DB_CONNECTION_URI=postgresql+psycopg://honcho:honcho_password@honcho-db:5432/honcho
    depends_on:
      - honcho-db
      - honcho-api

volumes:
  honcho_postgres_data:
```

Note: exact image tags/commands should be validated against current Honcho release docs before merge.

---

## 10. Testing Strategy

### 10.1 Unit

1. Mapping tests for Honcho response to `IMemorySegment`.
2. Backend selection tests (`postgres`, `honcho`, `dual`).
3. Fallback behavior tests under timeout/5xx/shape mismatch.

### 10.2 Integration

1. `POST /api/workflow-runtime/query-memory` with mocked Honcho adapter.
2. Compose smoke tests verifying health endpoint and API connectivity.
3. Migration script tests for idempotency and resume.

### 10.3 E2E

1. Targeted workflow suites that call `query_memory`.
2. Deterministic kanban path checks after backend toggle.
3. Failure-injection scenario: Honcho unavailable with fallback active.

### 10.4 Suggested commands

1. `npm run test:api`
2. targeted tests for `workflow-runtime-tools.service.spec.ts`
3. targeted tests for new memory adapter scripts/services
4. selective e2e suite for orchestration paths using memory

---

## 11. Risks and Mitigations

1. Contract drift vs existing tool response schema
   - Mitigation: strict adapter normalization and golden contract tests.
2. Compose complexity and startup fragility
   - Mitigation: dedicated health checks and startup dependency ordering.
3. Retrieval quality mismatch during migration
   - Mitigation: dual-run parity validation with explicit thresholds.
4. Licensing/compliance risk (AGPL)
   - Mitigation: legal checkpoint required before production rollout.
5. Operational outage risk in cutover
   - Mitigation: config-only rollback to `postgres`.

---

## 12. Dependencies

### 12.1 Upstream

1. Existing memory query contract surfaces (`query_memory`) remain stable.
2. Existing API observability and telemetry hooks for metric integration.
3. Existing Docker Compose network and deployment conventions.

### 12.2 Downstream

1. Agent workflows and profile policies continue unchanged.
2. Future epic can optimize session-distillation overlap after backend cutover is stable.

---

## 13. Delivery Milestones

1. M1: ADR + spike complete, legal checkpoint opened.
2. M2: Compose self-host working locally with health checks.
3. M3: API adapter abstraction merged behind feature flags.
4. M4: Backfill and parity tools complete.
5. M5: Staging cutover validated.
6. M6: Production cutover completed with rollback verified.

---

## 14. Definition of Done

1. `query_memory` behavior is preserved for all existing workflows/tests.
2. Honcho self-host stack is operational in Compose with documented runbook.
3. Memory migration is complete and validated for active entities.
4. Cutover and rollback procedures are documented and tested.
5. Post-cutover error/latency metrics remain within approved bounds.
6. AGPL compliance decision is recorded.

---

## 15. Appendix: Concrete File Touchpoints

Primary expected file changes:

1. `docker-compose.yaml`
2. `apps/api/src/memory/memory.module.ts`
3. `apps/api/src/memory/memory-manager.service.ts`
4. `apps/api/src/workflow/workflow-runtime-tools.service.ts` (minimal/no contract change)
5. `apps/api/src/tool/capability-manifest.runtime.entries.ts` (likely unchanged)
6. `apps/api/src/app.module.ts` (only if additional module wiring needed)

New expected files:

1. `apps/api/src/memory/memory-backend.interface.ts`
2. `apps/api/src/memory/memory-backend.factory.ts`
3. `apps/api/src/memory/honcho/honcho-client.service.ts`
4. `apps/api/src/memory/honcho/honcho-memory-backend.service.ts`
5. `apps/api/src/memory/dual-read-memory-backend.service.ts`
6. `apps/api/scripts/migrate-memory-segments-to-honcho.ts`
7. `apps/api/scripts/validate-honcho-parity.ts`
8. `docs/adrs/0002-honcho-memory-backend-transition.md`
