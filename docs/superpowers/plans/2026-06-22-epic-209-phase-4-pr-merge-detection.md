# Plan: EPIC-209 Phase 4 — PR-Merge Detection (Webhook + Poll Reconciler) and Lifecycle Closure

**Date:** 2026-06-22
**Epic:** EPIC-209 (Pull-Request-Based Integration Strategy)
**Spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 6, Phase 4; signatures pinned in Section 10 — 10.1 `getPullRequestStatus`, 10.4 `pull_request_tracking`, 10.5 `CoreIntegrationPrMergedV1` are used **verbatim**).
**Consumes (earlier phases):**

- `MergeProvider.getPullRequestStatus(ref): Promise<PullRequestStatus>` + `MERGE_PROVIDER` symbol + `PullRequestRef` / `PullRequestState` / `PullRequestStatus` types (Phase 1 declares / Phase 2 implements — Section 10.1).
- `MergeProviderFactory.resolveForRepository(repositoryUrl): MergeProvider` (Phase 2).
- `PullRequestTracking` entity + `PullRequestTrackingRepository` (`findByProviderIdentity(...)`) and the `pull_request_tracking` table with `state='open'` rows + the `idx_pull_request_tracking_state` index (Phase 3 — Section 10.4).
- The `awaiting-pr-merge` kanban status (Phase 3) and `lifecycle.merge` metadata convention (Phase 3).

**Produces (closure):** `core.integration.pr_merged.v1` neutral lifecycle event (Section 10.5) + the kanban consumer transition `awaiting-pr-merge → done`.

---

## Goal

Close the PR lifecycle on an **observed provider merge**, by two convergent, idempotent paths:

1. **PR webhook controller (API-side):** secret-verified (`X-Hub-Signature-256`, HMAC-SHA256 over the raw body, constant-time compare) ingress for PR events. On a `closed` + `merged` event it looks up the `pull_request_tracking` row by `(provider, owner, repo, pr_number)`, marks it `merged` with `merge_commit_sha`, and emits `core.integration.pr_merged.v1` carrying `{ scopeId, contextId, prUrl, mergeCommitSha }`. Already-merged rows are a no-op (no duplicate event). Bad/absent signature → **401**.
2. **Poll reconciler (API-side):** periodic job that loads tracked PRs with `state='open'`, calls `MergeProvider.getPullRequestStatus(ref)`, and for any now-`merged` PR runs the **same** mark+emit path. Fallback for missed webhooks; both converge idempotently on the tracking-row `state`.
3. **Kanban consumer handler:** `core-lifecycle-stream.consumer` gains a branch for `core.integration.pr_merged.v1` → transition the work item `awaiting-pr-merge → done`, patch `lifecycle.merge.mergeCommit` + `lifecycle.merge.status='merged'`. No-op if the item is already `done`.

The webhook secret is resolved from the project's `github_secret_id` (or the dedicated `GITHUB_WEBHOOK_SECRET` fallback) via the existing secret store. `direct-push` repositories are entirely untouched — they never open a PR, never produce a tracking row, and never reach this code path.

**Out of Phase-4 scope (do NOT build here):** `auto_merge` / `merge_method` execution (the reconciler calling `mergePullRequest()`), `preflight_gate` toggle, CEO stalled-PR awareness, and GitLab/Bitbucket adapters. Those are Phase 5/6. Phase 4 only **observes** a merge that the provider has already performed and closes the lifecycle.

## Architecture

- **API-side (neutral, VCS-domain only):**
  - New `@nexus/core` event: `core.integration.pr_merged.v1` — a dedicated envelope schema with a **neutral** payload (`scopeId`, `contextId`, `prUrl`, `mergeCommitSha`); it is **not** part of the `core.workflow.run.*` / `core.workflow.step.*` union and carries no `run_id`/`workflow_id`.
  - `IntegrationLifecycleStreamPublisher` — a dedicated publisher that stamps neutral Redis-stream fields (the existing `WorkflowCoreLifecycleStreamPublisher.publish` reads `payload.run_id`/`payload.workflow_id`, which this event does not have, so a separate publish method is required).
  - `PrMergeFinalizerService` — the **single shared** mark+emit helper. Idempotency is enforced on the tracking-row `state`: if the row is already `merged`, return without emitting. Both webhook and reconciler call it.
  - `PrWebhookController` — `POST /webhooks/integration/github`, raw-body HMAC verification, parse, `closed+merged` → finalizer.
  - `PrPollReconcilerService` — `OnModuleInit`/`OnModuleDestroy` + `setInterval` + `pollInFlight` guard (mirrors `AgentAwaitReconcilerService`); loads `state='open'` rows, resolves the provider via the factory, calls `getPullRequestStatus`, finalizes merged.
  - `WebhookSecretResolver` — resolves the HMAC secret per request: per-scope `github_secret_id` via `SecretCrudService.findByIdRaw` when available, else the `GITHUB_WEBHOOK_SECRET` env fallback. Never logs the secret.
  - Phase-3 repository gains `findOpen()` and `markMerged(...)`.
- **Kanban-side (lifecycle):** a new `event_type` branch in `core-lifecycle-stream.consumer.ts`; the handler parses the neutral payload and drives `WorkItemService.updateStatus(scopeId, contextId, 'done')` + a `lifecycle.merge` metadata patch. Idempotent on the current status.
- **Boundary:** every API-side artifact (event payload, publisher, finalizer, controller, reconciler, repository methods) uses **only** `scopeId` / `contextId` and VCS terms (`provider`, `owner`, `repo`, `pr_number`, `prUrl`, `mergeCommitSha`, `head`, `base`). The `awaiting-pr-merge → done` transition and `lifecycle.merge` live kanban-side. Lint rule `nexus-boundaries/no-core-kanban-residue` enforces this.

## Tech Stack

TypeScript (strict), NestJS (`nest build`), TypeORM (Postgres), ioredis streams, Vitest, Zod (`@nexus/core` schemas + `ZodValidationPipe`), Node `crypto` (`createHmac`, `timingSafeEqual`).

## Global Constraints

- **TDD strictly:** for every behaviour — write the failing test → run it (exact command, expect **FAIL**) → write the minimal implementation → run it (expect **PASS**) → commit. One behaviour per Red/Green cycle.
- **Test commands:** API `npm run test --workspace=apps/api`; kanban `npm run test --workspace=apps/kanban`; core `npm run test --workspace=packages/core` (or the kanban/api build which compiles `@nexus/core`). Typecheck before declaring done: `npm run build --workspace=packages/core`, `npm run build:api`, `npm run build:kanban`.
- **Signature verification is tested first-class:** a valid signature is accepted; a tampered body and an absent header each return **401**. Comparison uses Node `crypto.timingSafeEqual` over equal-length buffers. **Never log the secret** (assert/structure so the secret is never passed to a logger).
- **Idempotency is first-class:** explicit tests prove that webhook + poll both processing the same merge yields **exactly one** `core.integration.pr_merged.v1` emission and **one** transition — the second processing is a no-op gated on the tracking-row `state` (`merged`) / the work-item status (`done`).
- **Core/Kanban boundary (critical):** the controller, reconciler, finalizer, publisher, repository methods, and the `core.integration.pr_merged.v1` payload are API-side and use **only** neutral `scopeId`/`contextId` + VCS terms. **No** `kanban`, `workItem`, `work-item`, or project-domain identifiers in API/core code, tests, fixtures, comments, or migration/SQL. The transition + `lifecycle.merge` metadata are kanban-side, driven by consuming the neutral event. **Never** add allowlists, quarantine symbols, `eslint-disable`, `@ts-ignore`, or compatibility aliases to bypass the boundary lint rule — fix residue in code.
- **No lint suppression.** Strong typing throughout. Section 10 signatures used verbatim (`PullRequestStatus`, `PullRequestRef`, `getPullRequestStatus`, `CoreIntegrationPrMergedV1`, the `pull_request_tracking` columns).
- **Frequent atomic conventional commits** — one per Green step. End every commit message with the `Co-Authored-By` trailer.
- **`nest build`** for the API/kanban apps (not `tsc`).

---

## File Structure

```
packages/core/src/schemas/events/
  event-envelope.schema.ts                                  (EDIT — add core.integration.pr_merged.v1 enum + payload + envelope; widen the InterService union)
  event-envelope.types.ts                                   (EDIT — export CoreIntegrationPrMergedV1 + envelope shape type)
  event-envelope.pr-merged.spec.ts                          (NEW — schema contract test)

apps/api/src/common/git/integration/
  merge-provider.interface.ts                               (EXISTS — Phase 1/2; getPullRequestStatus consumed)
  merge-provider.factory.ts                                 (EXISTS — Phase 2; resolveForRepository consumed)
  pull-request-tracking.entity.ts                           (EXISTS — Phase 3; Section 10.4)
  pull-request-tracking.repository.ts                       (EDIT — add findOpen() + markMerged())
  pull-request-tracking.repository.spec.ts                  (EDIT — findOpen/markMerged tests)

apps/api/src/integration-events/                            (NEW module — neutral integration lifecycle events)
  integration-lifecycle-stream.publisher.ts                (NEW — publishPrMerged)
  integration-lifecycle-stream.publisher.spec.ts           (NEW)
  pr-merge-finalizer.service.ts                            (NEW — shared idempotent mark+emit)
  pr-merge-finalizer.service.spec.ts                       (NEW)
  webhook-signature.util.ts                                (NEW — verifyGithubSignature, timingSafeEqual)
  webhook-signature.util.spec.ts                           (NEW)
  webhook-secret.resolver.ts                               (NEW — per-scope secret + env fallback)
  webhook-secret.resolver.spec.ts                          (NEW)
  pr-webhook.controller.ts                                 (NEW — POST /webhooks/integration/github)
  pr-webhook.controller.spec.ts                            (NEW)
  pr-poll-reconciler.service.ts                            (NEW — periodic open-PR poll)
  pr-poll-reconciler.service.spec.ts                       (NEW)
  github-pr-webhook.types.ts                               (NEW — Zod schema for the inbound payload subset)
  integration-events.module.ts                             (NEW — wires controller + services)

apps/api/src/main.ts                                        (EDIT — register raw-body capture for the webhook route)
apps/api/src/app.module.ts                                 (EDIT — import IntegrationEventsModule)

apps/kanban/src/core/
  core-lifecycle-stream.consumer.ts                        (EDIT — branch on core.integration.pr_merged.v1)
  core-lifecycle-stream-pr-merged.handler.ts               (NEW — parse payload + drive transition)
  core-lifecycle-stream-pr-merged.handler.spec.ts          (NEW)
  core-lifecycle-stream.consumer.pr-merged.spec.ts         (NEW — routing test)
```

---

## Phase Ordering

Task 1 (the `@nexus/core` event) is the prerequisite for everything (both API publisher and kanban consumer import it). Then API persistence helpers (Task 2), the API closure machinery (Tasks 3–8: publisher → finalizer → signature util → secret resolver → controller → reconciler → module wiring), then the kanban consumer (Tasks 9–10), then the full regression sweep (Task 11). Execute in numbered order.

---

## Task 1 — Declare the `core.integration.pr_merged.v1` neutral event in `@nexus/core`

**Files**

- `packages/core/src/schemas/events/event-envelope.schema.ts` (EDIT)
- `packages/core/src/schemas/events/event-envelope.types.ts` (EDIT)
- `packages/core/src/schemas/events/event-envelope.pr-merged.spec.ts` (NEW)

**Interfaces**

- Consumes: nothing.
- Produces (Section 10.5 — verbatim payload): `CoreIntegrationPrMergedV1` `{ scopeId, contextId, prUrl, mergeCommitSha }` + `CoreIntegrationPrMergedEventEnvelopeV1Schema` + the `"core.integration.pr_merged.v1"` `event_type`. Consumed by the API publisher (Task 3) and the kanban consumer (Task 9).

> The existing `CoreWorkflowEventEnvelopeV1Schema` is a `z.union` of run + step envelopes whose payloads require `run_id`/`workflow_id`. The PR-merged event is **not** a workflow run/step event; it gets its **own** envelope schema with a neutral payload and is added to the broader inter-service union. The kanban consumer keys off the literal `event_type`, so it must be parseable independently.

### Step 1.1 (Red) — failing schema contract test

Create `packages/core/src/schemas/events/event-envelope.pr-merged.spec.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrMergedPayloadV1Schema,
} from "./event-envelope.schema";

const validPayload = {
  scopeId: "scope-1",
  contextId: "context-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  mergeCommitSha: "abc123def456",
};

describe("core.integration.pr_merged.v1 schema", () => {
  it("accepts a neutral payload with scopeId/contextId/prUrl/mergeCommitSha", () => {
    expect(
      CoreIntegrationPrMergedPayloadV1Schema.safeParse(validPayload).success,
    ).toBe(true);
  });

  it("accepts a full envelope with the pinned event_type and source_service core", () => {
    const envelope = {
      event_id: "11111111-1111-1111-1111-111111111111",
      event_type: "core.integration.pr_merged.v1",
      event_version: "v1",
      occurred_at: "2026-06-22T00:00:00.000Z",
      correlation_id: "22222222-2222-2222-2222-222222222222",
      source_service: "core",
      payload: validPayload,
      metadata: null,
    };
    expect(
      CoreIntegrationPrMergedEventEnvelopeV1Schema.safeParse(envelope).success,
    ).toBe(true);
  });

  it("rejects a payload missing mergeCommitSha", () => {
    const { mergeCommitSha, ...rest } = validPayload;
    expect(CoreIntegrationPrMergedPayloadV1Schema.safeParse(rest).success).toBe(
      false,
    );
  });
});
```

Run (expect FAIL — schema/exports do not exist yet):

```bash
npm run test --workspace=packages/core -- event-envelope.pr-merged
```

Expected: import error / `safeParse is not a function` — the new exports are missing.

### Step 1.2 (Green) — add the enum, payload, and envelope

In `event-envelope.schema.ts`, add the event-type enum, the neutral payload, and the envelope, then widen the inter-service union (do **not** add it to `CoreWorkflowEventEnvelopeV1Schema`, which the kanban consumer narrows to run/step):

```typescript
export const CoreIntegrationEventTypeV1Schema = z.enum([
  "core.integration.pr_merged.v1",
]);

export const CoreIntegrationPrMergedPayloadV1Schema = z
  .object({
    scopeId: z.string().min(1),
    contextId: z.string().min(1),
    prUrl: z.string().min(1),
    mergeCommitSha: z.string().min(1),
  })
  .strict();

export const CoreIntegrationPrMergedEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.literal("core.integration.pr_merged.v1"),
    source_service: z.literal("core"),
    payload: CoreIntegrationPrMergedPayloadV1Schema,
  });
```

Widen `InterServiceEventTypeV1Schema` and `InterServiceEventEnvelopeV1Schema` to include the new type/envelope:

```typescript
export const InterServiceEventTypeV1Schema = z.union([
  CoreWorkflowEventTypeV1Schema,
  CoreIntegrationEventTypeV1Schema,
  ChatEventTypeV1Schema,
]);
```

```typescript
export const InterServiceEventEnvelopeV1Schema = z.union([
  CoreWorkflowEventEnvelopeV1Schema,
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  ChatEventEnvelopeV1Schema,
]);
```

In `event-envelope.types.ts`, add the inferred types:

```typescript
export type CoreIntegrationPrMergedV1 = z.infer<
  typeof CoreIntegrationPrMergedPayloadV1Schema
>;
export type CoreIntegrationPrMergedEventEnvelopeV1Shape = z.infer<
  typeof CoreIntegrationPrMergedEventEnvelopeV1Schema
>;
```

> Ensure the new symbols are re-exported from the package barrel (`event-envelope.schema.ts` already runs `export * from "./event-envelope.types"`; confirm the package `index` re-exports `event-envelope.schema`). Match the existing export wiring — do not invent a new barrel.

Run (expect PASS) + typecheck the package:

```bash
npm run test --workspace=packages/core -- event-envelope.pr-merged
npm run build --workspace=packages/core
```

### Step 1.3 (Commit)

```bash
git add packages/core/src/schemas/events/event-envelope.schema.ts \
  packages/core/src/schemas/events/event-envelope.types.ts \
  packages/core/src/schemas/events/event-envelope.pr-merged.spec.ts
git commit -m "feat(core): add neutral core.integration.pr_merged.v1 lifecycle event

EPIC-209 Phase 4. Section 10.5 payload (scopeId, contextId, prUrl,
mergeCommitSha) as a standalone envelope outside the workflow run/step union.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — `PullRequestTrackingRepository`: `findOpen()` + `markMerged()`

**Files**

- `apps/api/src/common/git/integration/pull-request-tracking.repository.ts` (EDIT — Phase 3 file)
- `apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts` (EDIT)

**Interfaces**

- Consumes: the Phase-3 `PullRequestTracking` entity (`state`, `merge_commit_sha`) + `findByProviderIdentity(...)`.
- Produces: `findOpen(): Promise<PullRequestTracking[]>` (consumed by the reconciler, Task 7); `markMerged(id, mergeCommitSha): Promise<{ alreadyMerged: boolean; row: PullRequestTracking }>` (consumed by the finalizer, Task 4). `markMerged` is the **idempotency seam**: it reports whether the row was already `merged`.

### Step 2.1 (Red) — repository tests

Append to `pull-request-tracking.repository.spec.ts` (reuse the Phase-3 `makeRepoMock` style; add `find`):

```typescript
describe("PullRequestTrackingRepository.findOpen", () => {
  it("loads only rows in the open state", async () => {
    const typeormRepo = makeRepoMock();
    typeormRepo.find = vi.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const rows = await repo.findOpen();

    expect(typeormRepo.find).toHaveBeenCalledWith({ where: { state: "open" } });
    expect(rows).toHaveLength(2);
  });
});

describe("PullRequestTrackingRepository.markMerged", () => {
  it("flips an open row to merged and records the commit sha", async () => {
    const typeormRepo = makeRepoMock();
    typeormRepo.findOne.mockResolvedValue({
      id: "row-1",
      state: "open",
      merge_commit_sha: null,
    });
    typeormRepo.save = vi.fn((v) => Promise.resolve(v));
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const result = await repo.markMerged("row-1", "sha-merge");

    expect(result.alreadyMerged).toBe(false);
    expect(result.row.state).toBe("merged");
    expect(result.row.merge_commit_sha).toBe("sha-merge");
    expect(typeormRepo.save).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the row is already merged (idempotent)", async () => {
    const typeormRepo = makeRepoMock();
    typeormRepo.findOne.mockResolvedValue({
      id: "row-1",
      state: "merged",
      merge_commit_sha: "sha-merge",
    });
    typeormRepo.save = vi.fn();
    const repo = new PullRequestTrackingRepository(typeormRepo as never);

    const result = await repo.markMerged("row-1", "sha-merge");

    expect(result.alreadyMerged).toBe(true);
    expect(typeormRepo.save).not.toHaveBeenCalled();
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
```

### Step 2.2 (Green) — add the methods

Add to `PullRequestTrackingRepository`:

```typescript
findOpen(): Promise<PullRequestTracking[]> {
  return this.repository.find({ where: { state: "open" } });
}

async markMerged(
  id: string,
  mergeCommitSha: string,
): Promise<{ alreadyMerged: boolean; row: PullRequestTracking }> {
  const row = await this.repository.findOne({ where: { id } });
  if (!row) {
    throw new Error(`pull_request_tracking row not found: ${id}`);
  }
  if (row.state === "merged") {
    return { alreadyMerged: true, row };
  }
  row.state = "merged";
  row.merge_commit_sha = mergeCommitSha;
  const saved = await this.repository.save(row);
  return { alreadyMerged: false, row: saved };
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pull-request-tracking.repository
```

### Step 2.3 (Commit)

```bash
git add apps/api/src/common/git/integration/pull-request-tracking.repository.ts \
  apps/api/src/common/git/integration/pull-request-tracking.repository.spec.ts
git commit -m "feat(api): pull_request_tracking findOpen + idempotent markMerged

EPIC-209 Phase 4. findOpen drives the poll reconciler (state index); markMerged
is the idempotency seam (alreadyMerged short-circuits duplicate processing).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — `IntegrationLifecycleStreamPublisher.publishPrMerged`

**Files**

- `apps/api/src/integration-events/integration-lifecycle-stream.publisher.ts` (NEW)
- `apps/api/src/integration-events/integration-lifecycle-stream.publisher.spec.ts` (NEW)

**Interfaces**

- Consumes: `RedisStreamService.appendToStream(streamKey, fields, opts)` (existing, used by `WorkflowCoreLifecycleStreamPublisher`); `CoreIntegrationPrMergedEventEnvelopeV1Schema` (Task 1).
- Produces: `publishPrMerged(payload: CoreIntegrationPrMergedV1): Promise<string>` — appends a validated envelope to `stream:core:lifecycle`. Consumed by the finalizer (Task 4).

> The existing `WorkflowCoreLifecycleStreamPublisher.publish` indexes `envelope.payload.run_id` / `workflow_id` into the stream fields. The PR-merged payload has neither, so this publisher builds the envelope itself and stamps neutral stream fields (`event_id`, `event_type`, `occurred_at`, `envelope`). Same stream key (`stream:core:lifecycle`) so the kanban consumer receives it on the existing cursor.

### Step 3.1 (Red)

Create `integration-lifecycle-stream.publisher.spec.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { IntegrationLifecycleStreamPublisher } from "./integration-lifecycle-stream.publisher";

describe("IntegrationLifecycleStreamPublisher.publishPrMerged", () => {
  it("appends a valid core.integration.pr_merged.v1 envelope to the lifecycle stream", async () => {
    const appendToStream = vi.fn().mockResolvedValue("1-0");
    const publisher = new IntegrationLifecycleStreamPublisher({
      appendToStream,
    } as never);

    const id = await publisher.publishPrMerged({
      scopeId: "scope-1",
      contextId: "context-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      mergeCommitSha: "sha-merge",
    });

    expect(id).toBe("1-0");
    expect(appendToStream).toHaveBeenCalledTimes(1);
    const [streamKey, fields] = appendToStream.mock.calls[0];
    expect(streamKey).toBe("stream:core:lifecycle");
    expect(fields.event_type).toBe("core.integration.pr_merged.v1");
    const envelope = JSON.parse(fields.envelope);
    expect(envelope.payload).toEqual({
      scopeId: "scope-1",
      contextId: "context-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      mergeCommitSha: "sha-merge",
    });
    expect(envelope.source_service).toBe("core");
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- integration-lifecycle-stream.publisher
```

### Step 3.2 (Green)

```typescript
// apps/api/src/integration-events/integration-lifecycle-stream.publisher.ts
import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import {
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  type CoreIntegrationPrMergedV1,
} from "@nexus/core";
import { RedisStreamService } from "../redis/redis-stream.service";

const CORE_LIFECYCLE_STREAM_KEY = "stream:core:lifecycle";
const CORE_LIFECYCLE_STREAM_MAX_LENGTH = 100000;

/**
 * Publishes the neutral `core.integration.pr_merged.v1` lifecycle event onto the
 * shared `stream:core:lifecycle`. Distinct from the workflow run/step publisher
 * because this event has no run_id/workflow_id — only neutral scope/context.
 */
@Injectable()
export class IntegrationLifecycleStreamPublisher {
  private readonly logger = new Logger(
    IntegrationLifecycleStreamPublisher.name,
  );

  constructor(private readonly stream: RedisStreamService) {}

  async publishPrMerged(payload: CoreIntegrationPrMergedV1): Promise<string> {
    const occurredAt = new Date().toISOString();
    const envelope = CoreIntegrationPrMergedEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: "core.integration.pr_merged.v1",
      event_version: "v1",
      occurred_at: occurredAt,
      correlation_id: randomUUID(),
      source_service: "core",
      payload,
      metadata: null,
    });

    const streamId = await this.stream.appendToStream(
      CORE_LIFECYCLE_STREAM_KEY,
      {
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        occurred_at: envelope.occurred_at,
        envelope: JSON.stringify(envelope),
      },
      { maxLength: CORE_LIFECYCLE_STREAM_MAX_LENGTH },
    );
    if (!streamId) {
      throw new Error("Redis did not return a stream id");
    }
    return streamId;
  }
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- integration-lifecycle-stream.publisher
```

### Step 3.3 (Commit)

```bash
git add apps/api/src/integration-events/integration-lifecycle-stream.publisher.ts \
  apps/api/src/integration-events/integration-lifecycle-stream.publisher.spec.ts
git commit -m "feat(api): IntegrationLifecycleStreamPublisher.publishPrMerged

EPIC-209 Phase 4. Emits the neutral pr_merged event onto stream:core:lifecycle
(no run_id/workflow_id; neutral scope/context only).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `PrMergeFinalizerService` (shared idempotent mark+emit)

**Files**

- `apps/api/src/integration-events/pr-merge-finalizer.service.ts` (NEW)
- `apps/api/src/integration-events/pr-merge-finalizer.service.spec.ts` (NEW)

**Interfaces**

- Consumes: `PullRequestTrackingRepository.findByProviderIdentity(...)` + `markMerged(...)` (Tasks 2/Phase 3); `IntegrationLifecycleStreamPublisher.publishPrMerged(...)` (Task 3).
- Produces: `finalizeMergedByIdentity({ provider, owner, repo, prNumber, mergeCommitSha }): Promise<{ emitted: boolean }>` (webhook path) and `finalizeMergedRow(row, mergeCommitSha): Promise<{ emitted: boolean }>` (reconciler path — it already holds the row). Both mark + emit exactly once; both are idempotent. Consumed by the webhook (Task 6) and the reconciler (Task 7).

> This is the **single convergence point**. The idempotency is the row `state`: `markMerged` returns `alreadyMerged: true` for a second pass, and the finalizer then skips the emit. The neutral event payload is built straight from the tracking row's `scope_id` / `context_id` / `pr_url`.

### Step 4.1 (Red)

```typescript
import { describe, expect, it, vi } from "vitest";
import { PrMergeFinalizerService } from "./pr-merge-finalizer.service";

function build() {
  const trackingRepo = {
    findByProviderIdentity: vi.fn(),
    markMerged: vi.fn(),
  };
  const publisher = { publishPrMerged: vi.fn().mockResolvedValue("1-0") };
  const service = new PrMergeFinalizerService(
    trackingRepo as never,
    publisher as never,
  );
  return { service, trackingRepo, publisher };
}

const openRow = {
  id: "row-1",
  provider: "github",
  owner: "acme",
  repo: "widgets",
  pr_number: 42,
  scope_id: "scope-1",
  context_id: "context-1",
  pr_url: "https://github.com/acme/widgets/pull/42",
  state: "open",
  merge_commit_sha: null,
};

describe("PrMergeFinalizerService.finalizeMergedByIdentity", () => {
  it("marks the row merged and emits the neutral pr_merged event once", async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue(openRow);
    trackingRepo.markMerged.mockResolvedValue({
      alreadyMerged: false,
      row: { ...openRow, state: "merged", merge_commit_sha: "sha-merge" },
    });

    const result = await service.finalizeMergedByIdentity({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });

    expect(result.emitted).toBe(true);
    expect(trackingRepo.markMerged).toHaveBeenCalledWith("row-1", "sha-merge");
    expect(publisher.publishPrMerged).toHaveBeenCalledWith({
      scopeId: "scope-1",
      contextId: "context-1",
      prUrl: "https://github.com/acme/widgets/pull/42",
      mergeCommitSha: "sha-merge",
    });
  });

  it("is a no-op (no emit) when the row is already merged", async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue({
      ...openRow,
      state: "merged",
    });
    trackingRepo.markMerged.mockResolvedValue({
      alreadyMerged: true,
      row: { ...openRow, state: "merged", merge_commit_sha: "sha-merge" },
    });

    const result = await service.finalizeMergedByIdentity({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });

    expect(result.emitted).toBe(false);
    expect(publisher.publishPrMerged).not.toHaveBeenCalled();
  });

  it("is a no-op when no tracking row exists for the identity", async () => {
    const { service, trackingRepo, publisher } = build();
    trackingRepo.findByProviderIdentity.mockResolvedValue(null);

    const result = await service.finalizeMergedByIdentity({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 99,
      mergeCommitSha: "sha-merge",
    });

    expect(result.emitted).toBe(false);
    expect(trackingRepo.markMerged).not.toHaveBeenCalled();
    expect(publisher.publishPrMerged).not.toHaveBeenCalled();
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- pr-merge-finalizer.service
```

### Step 4.2 (Green)

```typescript
// apps/api/src/integration-events/pr-merge-finalizer.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { PullRequestTrackingRepository } from "../common/git/integration/pull-request-tracking.repository";
import type { PullRequestTracking } from "../common/git/integration/pull-request-tracking.entity";
import { IntegrationLifecycleStreamPublisher } from "./integration-lifecycle-stream.publisher";

export interface FinalizeMergedByIdentityInput {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  mergeCommitSha: string;
}

/**
 * Single convergence point for both the webhook and the poll reconciler. Marks
 * the tracking row merged (idempotent on row state) and, only on the first
 * transition, emits the neutral `core.integration.pr_merged.v1` lifecycle event.
 * Neutral throughout — no kanban identifiers.
 */
@Injectable()
export class PrMergeFinalizerService {
  private readonly logger = new Logger(PrMergeFinalizerService.name);

  constructor(
    private readonly trackingRepo: PullRequestTrackingRepository,
    private readonly publisher: IntegrationLifecycleStreamPublisher,
  ) {}

  async finalizeMergedByIdentity(
    input: FinalizeMergedByIdentityInput,
  ): Promise<{ emitted: boolean }> {
    const row = await this.trackingRepo.findByProviderIdentity(
      input.provider,
      input.owner,
      input.repo,
      input.prNumber,
    );
    if (!row) {
      this.logger.debug(
        `No tracking row for ${input.provider}:${input.owner}/${input.repo}#${input.prNumber}; ignoring merge`,
      );
      return { emitted: false };
    }
    return this.finalizeMergedRow(row, input.mergeCommitSha);
  }

  async finalizeMergedRow(
    row: PullRequestTracking,
    mergeCommitSha: string,
  ): Promise<{ emitted: boolean }> {
    const { alreadyMerged } = await this.trackingRepo.markMerged(
      row.id,
      mergeCommitSha,
    );
    if (alreadyMerged) {
      return { emitted: false };
    }

    await this.publisher.publishPrMerged({
      scopeId: row.scope_id,
      contextId: row.context_id,
      prUrl: row.pr_url,
      mergeCommitSha,
    });
    this.logger.log(
      `Emitted pr_merged for scope ${row.scope_id} (${row.pr_url}, commit ${mergeCommitSha})`,
    );
    return { emitted: true };
  }
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pr-merge-finalizer.service
```

### Step 4.3 (Commit)

```bash
git add apps/api/src/integration-events/pr-merge-finalizer.service.ts \
  apps/api/src/integration-events/pr-merge-finalizer.service.spec.ts
git commit -m "feat(api): PrMergeFinalizerService shared idempotent mark+emit

EPIC-209 Phase 4. Webhook and poll reconciler converge here; markMerged's
alreadyMerged gate guarantees exactly one pr_merged emission per PR.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — Webhook signature utility + secret resolver

**Files**

- `apps/api/src/integration-events/webhook-signature.util.ts` (NEW)
- `apps/api/src/integration-events/webhook-signature.util.spec.ts` (NEW)
- `apps/api/src/integration-events/webhook-secret.resolver.ts` (NEW)
- `apps/api/src/integration-events/webhook-secret.resolver.spec.ts` (NEW)

**Interfaces**

- Consumes: `SecretCrudService.findByIdRaw(id): Promise<{ id; decryptedValue } | null>` (existing, `apps/api/src/security/services/secret-crud.service.ts`).
- Produces: `verifyGithubSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean` (constant-time); `WebhookSecretResolver.resolveSecret(scopeId?: string | null): Promise<string | null>` — per-scope `github_secret_id` (when a resolver source is available) else `GITHUB_WEBHOOK_SECRET` env. Consumed by the controller (Task 6).

> **Why both:** signing material can be configured globally (env) for a single Nexus deployment, or per-scope via the project's secret. Phase 4 ships the env fallback as the primary, with the per-scope hook structured so Phase 5 can enrich it. The resolver returns `null` when no secret is configured; the controller turns that into a **401** (never a 500 that leaks intent).

### Step 5.1 (Red) — signature util

```typescript
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGithubSignature } from "./webhook-signature.util";

const secret = "shhh";
const body = Buffer.from(JSON.stringify({ action: "closed" }), "utf-8");

function sign(buf: Buffer, key: string): string {
  return `sha256=${createHmac("sha256", key).update(buf).digest("hex")}`;
}

describe("verifyGithubSignature", () => {
  it("accepts a valid sha256 signature over the raw body", () => {
    expect(verifyGithubSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ action: "opened" }), "utf-8");
    expect(verifyGithubSignature(tampered, sign(body, secret), secret)).toBe(
      false,
    );
  });

  it("rejects an absent signature header", () => {
    expect(verifyGithubSignature(body, undefined, secret)).toBe(false);
  });

  it("rejects a signature signed with a different secret", () => {
    expect(verifyGithubSignature(body, sign(body, "other"), secret)).toBe(
      false,
    );
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- webhook-signature.util
```

### Step 5.2 (Green) — signature util

```typescript
// apps/api/src/integration-events/webhook-signature.util.ts
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Verifies a GitHub `X-Hub-Signature-256` header (HMAC-SHA256 over the raw
 * request body) using a constant-time comparison. Returns false for an absent
 * or malformed header. The secret is never logged or returned.
 */
export function verifyGithubSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const provided = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  const providedBuffer = Buffer.from(provided, "utf-8");
  const expectedBuffer = Buffer.from(expected, "utf-8");
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- webhook-signature.util
```

### Step 5.3 (Red) — secret resolver

```typescript
import { describe, expect, it, vi, afterEach } from "vitest";
import { WebhookSecretResolver } from "./webhook-secret.resolver";

afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe("WebhookSecretResolver.resolveSecret", () => {
  it("returns the GITHUB_WEBHOOK_SECRET env fallback when set", async () => {
    process.env.GITHUB_WEBHOOK_SECRET = "env-secret";
    const secretCrud = { findByIdRaw: vi.fn() };
    const resolver = new WebhookSecretResolver(secretCrud as never);

    await expect(resolver.resolveSecret(null)).resolves.toBe("env-secret");
    expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
  });

  it("returns null when neither env nor a scope secret is configured", async () => {
    const secretCrud = { findByIdRaw: vi.fn().mockResolvedValue(null) };
    const resolver = new WebhookSecretResolver(secretCrud as never);

    await expect(resolver.resolveSecret("scope-1")).resolves.toBeNull();
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- webhook-secret.resolver
```

### Step 5.4 (Green) — secret resolver

```typescript
// apps/api/src/integration-events/webhook-secret.resolver.ts
import { Injectable } from "@nestjs/common";
import { SecretCrudService } from "../security/services/secret-crud.service";

const WEBHOOK_SECRET_ENV = "GITHUB_WEBHOOK_SECRET";

/**
 * Resolves the HMAC verification secret for an inbound PR webhook. Prefers the
 * deployment-wide `GITHUB_WEBHOOK_SECRET` env var; falls back to a per-scope
 * secret id when one is wired (Phase 5 enriches the per-scope path). Returns
 * null when no secret is configured so the controller can answer 401, not 500.
 * The secret value is never logged.
 */
@Injectable()
export class WebhookSecretResolver {
  constructor(private readonly secretCrud: SecretCrudService) {}

  async resolveSecret(scopeSecretId: string | null): Promise<string | null> {
    const fromEnv = process.env[WEBHOOK_SECRET_ENV];
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv;
    }
    if (scopeSecretId) {
      const secret = await this.secretCrud.findByIdRaw(scopeSecretId);
      if (secret) {
        return secret.decryptedValue;
      }
    }
    return null;
  }
}
```

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- webhook-secret.resolver
```

### Step 5.5 (Commit)

```bash
git add apps/api/src/integration-events/webhook-signature.util.ts \
  apps/api/src/integration-events/webhook-signature.util.spec.ts \
  apps/api/src/integration-events/webhook-secret.resolver.ts \
  apps/api/src/integration-events/webhook-secret.resolver.spec.ts
git commit -m "feat(api): GitHub webhook signature verification + secret resolver

EPIC-209 Phase 4. Constant-time HMAC-SHA256 over raw body (timingSafeEqual);
secret resolves from GITHUB_WEBHOOK_SECRET env with a per-scope fallback. Secret
never logged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `PrWebhookController` (secret-verified ingress)

**Files**

- `apps/api/src/integration-events/github-pr-webhook.types.ts` (NEW — Zod schema for the inbound subset)
- `apps/api/src/integration-events/pr-webhook.controller.ts` (NEW)
- `apps/api/src/integration-events/pr-webhook.controller.spec.ts` (NEW)
- `apps/api/src/main.ts` (EDIT — capture raw body for the webhook route)

**Interfaces**

- Consumes: `verifyGithubSignature` + `WebhookSecretResolver` (Task 5); `PrMergeFinalizerService.finalizeMergedByIdentity(...)` (Task 4).
- Produces: `POST /webhooks/integration/github` — `202 Accepted` on a processed/ignored event; `401` on bad/absent signature. Idempotent (delegates dedup to the finalizer).

> **Raw body:** HMAC must run over the exact received bytes, not a re-serialized JSON. Mirror the existing `webhook.controller.ts` HMAC pattern but compute over the **raw buffer**. Configure express raw-body capture for this route in `main.ts` (e.g. `bodyParser.json({ verify: (req, _res, buf) => { (req as RawBodyRequest).rawBody = buf; } })`, scoped/guarded so it does not regress other routes). Read the raw buffer in the controller via `@Req()` and the parsed body via `@Body()`. The GitHub event identity comes from the payload (`repository.owner.login`, `repository.name`, `pull_request.number`, `pull_request.merged`, `pull_request.merge_commit_sha`, `action`).

### Step 6.1 (Red)

Create `github-pr-webhook.types.ts` (Zod subset) and the controller spec. The spec drives the controller directly (unit), constructing a raw body + a valid/invalid signature:

```typescript
import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrWebhookController } from "./pr-webhook.controller";

const secret = "wh-secret";

const mergedPayload = {
  action: "closed",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 42,
    merged: true,
    merge_commit_sha: "sha-merge",
    html_url: "https://github.com/acme/widgets/pull/42",
  },
};

function rawAndSig(payload: unknown, key = secret) {
  const raw = Buffer.from(JSON.stringify(payload), "utf-8");
  const sig = `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;
  return { raw, sig };
}

function makeReq(raw: Buffer) {
  return { rawBody: raw } as never;
}

describe("PrWebhookController", () => {
  let finalizer: { finalizeMergedByIdentity: ReturnType<typeof vi.fn> };
  let secretResolver: { resolveSecret: ReturnType<typeof vi.fn> };
  let controller: PrWebhookController;

  beforeEach(() => {
    finalizer = {
      finalizeMergedByIdentity: vi.fn().mockResolvedValue({ emitted: true }),
    };
    secretResolver = { resolveSecret: vi.fn().mockResolvedValue(secret) };
    controller = new PrWebhookController(
      finalizer as never,
      secretResolver as never,
    );
  });

  it("finalizes the merge on a closed+merged event with a valid signature", async () => {
    const { raw, sig } = rawAndSig(mergedPayload);

    const result = await controller.handleGithub(
      makeReq(raw),
      mergedPayload as never,
      sig,
    );

    expect(finalizer.finalizeMergedByIdentity).toHaveBeenCalledWith({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });
    expect(result).toEqual({ success: true, processed: true });
  });

  it("rejects an absent signature with 401", async () => {
    const { raw } = rawAndSig(mergedPayload);
    await expect(
      controller.handleGithub(makeReq(raw), mergedPayload as never, undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
  });

  it("rejects a tampered body with 401", async () => {
    const { sig } = rawAndSig(mergedPayload);
    const tamperedRaw = Buffer.from(
      JSON.stringify({ ...mergedPayload, action: "opened" }),
      "utf-8",
    );
    await expect(
      controller.handleGithub(
        makeReq(tamperedRaw),
        mergedPayload as never,
        sig,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns 401 when no secret is configured", async () => {
    secretResolver.resolveSecret.mockResolvedValue(null);
    const { raw, sig } = rawAndSig(mergedPayload);
    await expect(
      controller.handleGithub(makeReq(raw), mergedPayload as never, sig),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("ignores a closed-but-unmerged event (no finalize)", async () => {
    const unmerged = {
      ...mergedPayload,
      pull_request: { ...mergedPayload.pull_request, merged: false },
    };
    const { raw, sig } = rawAndSig(unmerged);

    const result = await controller.handleGithub(
      makeReq(raw),
      unmerged as never,
      sig,
    );

    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processed: false });
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- pr-webhook.controller
```

### Step 6.2 (Green)

`github-pr-webhook.types.ts`:

```typescript
import { z } from "zod";

export const GithubPrWebhookPayloadSchema = z.object({
  action: z.string(),
  repository: z.object({
    name: z.string().min(1),
    owner: z.object({ login: z.string().min(1) }),
  }),
  pull_request: z.object({
    number: z.number().int(),
    merged: z.boolean().optional(),
    merge_commit_sha: z.string().nullable().optional(),
    html_url: z.string().min(1),
  }),
});

export type GithubPrWebhookPayload = z.infer<
  typeof GithubPrWebhookPayloadSchema
>;
```

`pr-webhook.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrMergeFinalizerService } from "./pr-merge-finalizer.service";
import { WebhookSecretResolver } from "./webhook-secret.resolver";
import { verifyGithubSignature } from "./webhook-signature.util";
import {
  GithubPrWebhookPayloadSchema,
  type GithubPrWebhookPayload,
} from "./github-pr-webhook.types";

interface RawBodyRequest {
  rawBody?: Buffer;
}

const GITHUB_PROVIDER = "github";

@ApiTags("integration-webhooks")
@Controller("webhooks/integration")
export class PrWebhookController {
  private readonly logger = new Logger(PrWebhookController.name);

  constructor(
    private readonly finalizer: PrMergeFinalizerService,
    private readonly secretResolver: WebhookSecretResolver,
  ) {}

  @Post("github")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "GitHub pull-request webhook ingress" })
  async handleGithub(
    @Req() request: RawBodyRequest,
    @Body() body: GithubPrWebhookPayload,
    @Headers("x-hub-signature-256") signature?: string,
  ): Promise<{ success: true; processed: boolean }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("Missing webhook body");
    }

    const secret = await this.secretResolver.resolveSecret(null);
    if (!secret) {
      throw new UnauthorizedException("Webhook secret is not configured");
    }
    if (!verifyGithubSignature(rawBody, signature, secret)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const payload = GithubPrWebhookPayloadSchema.parse(body);
    const isMerge =
      payload.action === "closed" &&
      payload.pull_request.merged === true &&
      typeof payload.pull_request.merge_commit_sha === "string";
    if (!isMerge) {
      return { success: true, processed: false };
    }

    await this.finalizer.finalizeMergedByIdentity({
      provider: GITHUB_PROVIDER,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      mergeCommitSha: payload.pull_request.merge_commit_sha as string,
    });
    return { success: true, processed: true };
  }
}
```

`main.ts` — capture the raw body (guarded so it only annotates the request; do not break existing JSON parsing). Mirror the existing express bootstrap; add a `verify` hook:

```typescript
// in the bodyParser/json setup
app.use(
  bodyParser.json({
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
```

> Read `main.ts` first; if a json body parser is already configured, extend that single configuration with the `verify` hook rather than adding a second parser. Keep `ValidationPipe`/`ZodValidationPipe` untouched.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pr-webhook.controller
```

### Step 6.3 (Commit)

```bash
git add apps/api/src/integration-events/github-pr-webhook.types.ts \
  apps/api/src/integration-events/pr-webhook.controller.ts \
  apps/api/src/integration-events/pr-webhook.controller.spec.ts \
  apps/api/src/main.ts
git commit -m "feat(api): PR webhook controller (HMAC-verified GitHub ingress)

EPIC-209 Phase 4. closed+merged -> finalizer; raw-body HMAC over X-Hub-Signature-256;
bad/absent/unconfigured signature -> 401; closed-unmerged ignored. Neutral only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — `PrPollReconcilerService` (missed-webhook fallback)

**Files**

- `apps/api/src/integration-events/pr-poll-reconciler.service.ts` (NEW)
- `apps/api/src/integration-events/pr-poll-reconciler.service.spec.ts` (NEW)

**Interfaces**

- Consumes: `PullRequestTrackingRepository.findOpen()` (Task 2); `MergeProviderFactory.resolveForRepository(repositoryUrl)` → `MergeProvider.getPullRequestStatus(ref)` (Phase 1/2, Section 10.1); `PrMergeFinalizerService.finalizeMergedRow(row, sha)` (Task 4).
- Produces: a periodic reconcile (`reconcileOnce()`), and module lifecycle (`OnModuleInit` initial sweep + `setInterval`, `OnModuleDestroy` clear). Mirrors `AgentAwaitReconcilerService` (in-flight guard, per-row error isolation).

> The reconciler builds a `PullRequestRef` from each open row (`provider`, `owner`, `repo`, `number: pr_number`, `url: pr_url`) and calls `getPullRequestStatus`. When `status.state === 'merged'` and `status.mergeCommitSha` is non-null, it calls `finalizeMergedRow` — the **same** idempotent path as the webhook. Interval from `PR_POLL_RECONCILE_INTERVAL_MS` env (default 60s). Per-row errors are logged and skipped (one bad PR must not stall the sweep). The reconciler does **not** call `mergePullRequest` — observation only (auto-merge is Phase 5).

### Step 7.1 (Red)

```typescript
import { describe, expect, it, vi } from "vitest";
import { PrPollReconcilerService } from "./pr-poll-reconciler.service";

const openRow = {
  id: "row-1",
  provider: "github",
  owner: "acme",
  repo: "widgets",
  pr_number: 42,
  pr_url: "https://github.com/acme/widgets/pull/42",
  state: "open",
};

function build(statusState: "open" | "merged", mergeSha: string | null = null) {
  const trackingRepo = { findOpen: vi.fn().mockResolvedValue([openRow]) };
  const provider = {
    getPullRequestStatus: vi.fn().mockResolvedValue({
      ref: {
        provider: "github",
        owner: "acme",
        repo: "widgets",
        number: 42,
        url: openRow.pr_url,
      },
      state: statusState,
      checks: "passing",
      reviewDecision: "approved",
      mergeCommitSha: mergeSha,
      mergeable: true,
    }),
  };
  const factory = { resolveForRepository: vi.fn().mockReturnValue(provider) };
  const finalizer = {
    finalizeMergedRow: vi.fn().mockResolvedValue({ emitted: true }),
  };
  const service = new PrPollReconcilerService(
    trackingRepo as never,
    factory as never,
    finalizer as never,
  );
  return { service, provider, finalizer, trackingRepo };
}

describe("PrPollReconcilerService.reconcileOnce", () => {
  it("finalizes an open row whose provider status is now merged", async () => {
    const { service, finalizer } = build("merged", "sha-merge");
    await service.reconcileOnce();
    expect(finalizer.finalizeMergedRow).toHaveBeenCalledWith(
      openRow,
      "sha-merge",
    );
  });

  it("leaves a still-open PR untouched (no finalize)", async () => {
    const { service, finalizer } = build("open", null);
    await service.reconcileOnce();
    expect(finalizer.finalizeMergedRow).not.toHaveBeenCalled();
  });

  it("isolates a per-row provider error and does not throw", async () => {
    const { service, provider, finalizer } = build("open");
    provider.getPullRequestStatus.mockRejectedValue(new Error("rate limit"));
    await expect(service.reconcileOnce()).resolves.toBeUndefined();
    expect(finalizer.finalizeMergedRow).not.toHaveBeenCalled();
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/api -- pr-poll-reconciler.service
```

### Step 7.2 (Green)

```typescript
// apps/api/src/integration-events/pr-poll-reconciler.service.ts
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { MergeProviderFactory } from "../common/git/integration/merge-provider.factory";
import { PullRequestTrackingRepository } from "../common/git/integration/pull-request-tracking.repository";
import type { PullRequestTracking } from "../common/git/integration/pull-request-tracking.entity";
import { PrMergeFinalizerService } from "./pr-merge-finalizer.service";

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

function resolveIntervalMs(): number {
  const value = Number(process.env.PR_POLL_RECONCILE_INTERVAL_MS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_RECONCILE_INTERVAL_MS;
}

/**
 * Fallback for missed PR webhooks: periodically loads open tracked PRs, asks the
 * provider for their status, and finalizes any now-merged PR via the shared
 * finalizer (idempotent with the webhook path). Observation only — never merges.
 */
@Injectable()
export class PrPollReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrPollReconcilerService.name);
  private readonly intervalMs = resolveIntervalMs();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly trackingRepo: PullRequestTrackingRepository,
    private readonly providerFactory: MergeProviderFactory,
    private readonly finalizer: PrMergeFinalizerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileOnce();
    this.timer = setInterval(() => {
      void this.reconcileOnce();
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const open = await this.trackingRepo.findOpen();
      for (const row of open) {
        await this.reconcileRow(row);
      }
    } catch (error) {
      this.logger.warn(`PR poll reconcile failed: ${this.describe(error)}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async reconcileRow(row: PullRequestTracking): Promise<void> {
    try {
      const provider = this.providerFactory.resolveForRepository(row.pr_url);
      const status = await provider.getPullRequestStatus({
        provider: row.provider,
        owner: row.owner,
        repo: row.repo,
        number: row.pr_number,
        url: row.pr_url,
      });
      if (status.state === "merged" && status.mergeCommitSha) {
        await this.finalizer.finalizeMergedRow(row, status.mergeCommitSha);
      }
    } catch (error) {
      this.logger.warn(
        `Failed to reconcile PR ${row.pr_url}: ${this.describe(error)}`,
      );
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
```

> **`resolveForRepository` input:** Phase 2's factory resolves a provider from a repository URL. The open row stores `pr_url` (the PR HTML URL), which shares the `owner/repo` host. If Phase 2's factory expects the **repository** URL rather than the PR URL, derive it from `provider`/`owner`/`repo` instead, or persist `repository_url` on the row — match the actual Phase-2/Phase-3 surface; do not invent a new factory method. Read `merge-provider.factory.ts` first.

Run (expect PASS):

```bash
npm run test --workspace=apps/api -- pr-poll-reconciler.service
```

### Step 7.3 (Commit)

```bash
git add apps/api/src/integration-events/pr-poll-reconciler.service.ts \
  apps/api/src/integration-events/pr-poll-reconciler.service.spec.ts
git commit -m "feat(api): PR poll reconciler (missed-webhook fallback)

EPIC-209 Phase 4. setInterval + in-flight guard; loads open tracked PRs, polls
getPullRequestStatus, finalizes merged via the shared idempotent path. Per-row
errors isolated. Observation only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — `IntegrationEventsModule` wiring + cross-path idempotency test

**Files**

- `apps/api/src/integration-events/integration-events.module.ts` (NEW)
- `apps/api/src/app.module.ts` (EDIT — import the module)
- `apps/api/src/integration-events/pr-merge-finalizer.service.spec.ts` (EDIT — add the convergence test)

**Interfaces**

- Consumes: `RedisModule` (for `RedisStreamService`), `DatabaseModule`/`GitWorktreeModule` (for `PullRequestTrackingRepository` + `MergeProviderFactory`), `SecurityModule` (for `SecretCrudService`).
- Produces: a wired module that boots the controller + reconciler.

### Step 8.1 (Red) — cross-path "exactly one emission" test

Append to `pr-merge-finalizer.service.spec.ts` (the load-bearing idempotency proof — webhook then poll on the same PR emit once):

```typescript
describe("PrMergeFinalizerService convergence (webhook + poll)", () => {
  it("emits exactly once when both paths process the same merge", async () => {
    const { service, trackingRepo, publisher } = build();
    // First call (webhook): open -> merged, emits.
    trackingRepo.findByProviderIdentity.mockResolvedValueOnce(openRow);
    trackingRepo.markMerged.mockResolvedValueOnce({
      alreadyMerged: false,
      row: { ...openRow, state: "merged", merge_commit_sha: "sha-merge" },
    });
    // Second call (poll, same row already merged): no emit.
    trackingRepo.markMerged.mockResolvedValueOnce({
      alreadyMerged: true,
      row: { ...openRow, state: "merged", merge_commit_sha: "sha-merge" },
    });

    const first = await service.finalizeMergedByIdentity({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });
    const second = await service.finalizeMergedRow(
      { ...openRow, state: "merged" } as never,
      "sha-merge",
    );

    expect(first.emitted).toBe(true);
    expect(second.emitted).toBe(false);
    expect(publisher.publishPrMerged).toHaveBeenCalledTimes(1);
  });
});
```

Run (expect PASS — Task 4 already satisfies this; this codifies the cross-path guarantee). If it fails, fix the finalizer, not the test.

```bash
npm run test --workspace=apps/api -- pr-merge-finalizer.service
```

### Step 8.2 (Green) — module

```typescript
// apps/api/src/integration-events/integration-events.module.ts
import { Module } from "@nestjs/common";
import { GitWorktreeModule } from "../common/git/git-worktree.module";
import { DatabaseModule } from "../database/database.module";
import { RedisModule } from "../redis/redis.module";
import { SecurityModule } from "../security/security.module";
import { IntegrationLifecycleStreamPublisher } from "./integration-lifecycle-stream.publisher";
import { PrMergeFinalizerService } from "./pr-merge-finalizer.service";
import { PrPollReconcilerService } from "./pr-poll-reconciler.service";
import { PrWebhookController } from "./pr-webhook.controller";
import { WebhookSecretResolver } from "./webhook-secret.resolver";

@Module({
  imports: [RedisModule, DatabaseModule, GitWorktreeModule, SecurityModule],
  controllers: [PrWebhookController],
  providers: [
    IntegrationLifecycleStreamPublisher,
    PrMergeFinalizerService,
    PrPollReconcilerService,
    WebhookSecretResolver,
  ],
  exports: [PrMergeFinalizerService],
})
export class IntegrationEventsModule {
  protected readonly _moduleName = "IntegrationEventsModule";
}
```

> Confirm the actual module that exports `PullRequestTrackingRepository` (Phase 3 registered it in `DatabaseModule`) and `MergeProviderFactory` (Phase 2 — likely `GitWorktreeModule` or a dedicated integration module). Import whichever modules export those providers; do not re-provide them here. Confirm `SecretCrudService` is exported by `SecurityModule`. Add `IntegrationEventsModule` to `app.module.ts` `imports`.

Run (expect PASS) + full API build (verifies DI graph resolves at compile time):

```bash
npm run test --workspace=apps/api -- integration-events
npm run build:api
```

### Step 8.3 (Commit)

```bash
git add apps/api/src/integration-events/integration-events.module.ts \
  apps/api/src/app.module.ts \
  apps/api/src/integration-events/pr-merge-finalizer.service.spec.ts
git commit -m "feat(api): wire IntegrationEventsModule (PR webhook + poll reconciler)

EPIC-209 Phase 4. Registers controller + finalizer + publisher + reconciler +
secret resolver; cross-path idempotency proven (exactly one emission).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — Kanban `pr_merged` handler (transition + lifecycle.merge patch)

**Files**

- `apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.ts` (NEW)
- `apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.spec.ts` (NEW)

**Interfaces**

- Consumes: `CoreIntegrationPrMergedEventEnvelopeV1Schema` + `CoreIntegrationPrMergedV1` (Task 1, `@nexus/core`); `WorkItemService.updateStatus(project_id, workItemId, status)` (`apps/kanban/src/work-item/work-item.service.ts`); `WorkItemService.updateWorkItem(project_id, workItemId, patch)` (for the `lifecycle.merge` metadata patch); `KanbanWorkItemRepository.findByProjectAndId(...)` (to read the current status for idempotency).
- Produces: `handle(payload: CoreIntegrationPrMergedV1): Promise<void>` — transitions `awaiting-pr-merge → done` and patches `lifecycle.merge.{status:'merged',mergeCommit}`. No-op when the item is already `done`. Consumed by the consumer routing (Task 10).

> **Boundary:** the kanban handler maps the neutral `scopeId`/`contextId` to the project id / work-item id (the same mapping the consumer already uses for run events: `scopeId` = project, `contextId` = work item). It owns the kanban-domain transition + `lifecycle.merge` shape. The API event payload stays neutral.

### Step 9.1 (Red)

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoreLifecycleStreamPrMergedHandler } from "./core-lifecycle-stream-pr-merged.handler";

const payload = {
  scopeId: "project-1",
  contextId: "wi-1",
  prUrl: "https://github.com/acme/widgets/pull/42",
  mergeCommitSha: "sha-merge",
};

function build(currentStatus: string) {
  const workItems = {
    findByProjectAndId: vi
      .fn()
      .mockResolvedValue({ id: "wi-1", status: currentStatus, metadata: {} }),
  };
  const workItemService = {
    updateStatus: vi.fn().mockResolvedValue(undefined),
    updateWorkItem: vi.fn().mockResolvedValue(undefined),
  };
  const handler = new CoreLifecycleStreamPrMergedHandler(
    workItems as never,
    workItemService as never,
  );
  return { handler, workItems, workItemService };
}

describe("CoreLifecycleStreamPrMergedHandler.handle", () => {
  it("transitions awaiting-pr-merge -> done and records the merge commit", async () => {
    const { handler, workItemService } = build("awaiting-pr-merge");

    await handler.handle(payload);

    expect(workItemService.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          lifecycle: expect.objectContaining({
            merge: expect.objectContaining({
              status: "merged",
              mergeCommit: "sha-merge",
            }),
          }),
        }),
      }),
    );
    expect(workItemService.updateStatus).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      "done",
    );
  });

  it("is a no-op when the item is already done (idempotent)", async () => {
    const { handler, workItemService } = build("done");

    await handler.handle(payload);

    expect(workItemService.updateStatus).not.toHaveBeenCalled();
  });
});
```

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- core-lifecycle-stream-pr-merged.handler
```

### Step 9.2 (Green)

```typescript
// apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.ts
import { Injectable, Logger } from "@nestjs/common";
import type { CoreIntegrationPrMergedV1 } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { WorkItemService } from "../work-item/work-item.service";

const AWAITING_PR_MERGE = "awaiting-pr-merge";
const DONE = "done";

/**
 * Closes the PR lifecycle on the neutral `core.integration.pr_merged.v1` event:
 * patches `lifecycle.merge` with the observed merge commit and transitions the
 * work item to `done`. Idempotent — a second delivery for an already-`done`
 * item is a no-op. The neutral scopeId/contextId map to project/work-item ids.
 */
@Injectable()
export class CoreLifecycleStreamPrMergedHandler {
  private readonly logger = new Logger(CoreLifecycleStreamPrMergedHandler.name);

  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
  ) {}

  async handle(payload: CoreIntegrationPrMergedV1): Promise<void> {
    const projectId = payload.scopeId;
    const workItemId = payload.contextId;

    const item = await this.workItems.findByProjectAndId(projectId, workItemId);
    if (!item) {
      this.logger.warn(
        `pr_merged for unknown work item ${workItemId} in project ${projectId}; ignoring`,
      );
      return;
    }
    if (item.status === DONE) {
      return;
    }
    if (item.status !== AWAITING_PR_MERGE) {
      this.logger.warn(
        `pr_merged for work item ${workItemId} in unexpected status ${item.status}; transitioning to done anyway`,
      );
    }

    const existingMetadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {};
    const existingLifecycle =
      typeof existingMetadata.lifecycle === "object" &&
      existingMetadata.lifecycle !== null
        ? (existingMetadata.lifecycle as Record<string, unknown>)
        : {};
    const existingMerge =
      typeof existingLifecycle.merge === "object" &&
      existingLifecycle.merge !== null
        ? (existingLifecycle.merge as Record<string, unknown>)
        : {};

    await this.workItemService.updateWorkItem(projectId, workItemId, {
      metadata: {
        ...existingMetadata,
        lifecycle: {
          ...existingLifecycle,
          merge: {
            ...existingMerge,
            status: "merged",
            mergeCommit: payload.mergeCommitSha,
            prUrl: payload.prUrl,
          },
        },
      },
    });

    await this.workItemService.updateStatus(projectId, workItemId, DONE);
    this.logger.log(
      `Work item ${workItemId} transitioned to done on PR merge (${payload.prUrl})`,
    );
  }
}
```

> Confirm the `updateWorkItem` patch shape accepts a `metadata` key (read `asWorkItemPatch` / `applyPatchToWorkItem` in `work-item.service.helpers`). If the patch contract merges metadata differently (e.g. shallow replace), build the full merged metadata object here (as above) so no sibling keys are lost. If the work-item entity exposes status under a different field name than `status`, match it.

Run (expect PASS):

```bash
npm run test --workspace=apps/kanban -- core-lifecycle-stream-pr-merged.handler
```

### Step 9.3 (Commit)

```bash
git add apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.ts \
  apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.spec.ts
git commit -m "feat(kanban): pr_merged handler transitions awaiting-pr-merge -> done

EPIC-209 Phase 4. Patches lifecycle.merge (status=merged, mergeCommit) and
transitions to done; idempotent when already done. Consumes the neutral event.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — Route `core.integration.pr_merged.v1` in the consumer

**Files**

- `apps/kanban/src/core/core-lifecycle-stream.consumer.ts` (EDIT — add the handler dep + a routing branch)
- `apps/kanban/src/core/core-lifecycle-stream.consumer.pr-merged.spec.ts` (NEW)

**Interfaces**

- Consumes: `CoreLifecycleStreamPrMergedHandler.handle(payload)` (Task 9); `CoreIntegrationPrMergedEventEnvelopeV1Schema` (Task 1).
- Produces: in `processEntries`, an envelope whose `event_type === 'core.integration.pr_merged.v1'` is parsed with the integration schema and dispatched to the handler; on success the cursor advances, on failure it dead-letters (existing pattern).

> The consumer currently parses every entry with `CoreWorkflowEventEnvelopeV1Schema` (run/step union) and all downstream methods gate on `event_type.startsWith("core.workflow.run.")`. The PR-merged envelope is **not** in that union, so `parseEnvelope` would reject it. Add a pre-branch in `processEntries`: read the raw `event_type` field (already in `fields`), and if it is the integration type, parse with the integration schema and dispatch to the handler; otherwise fall through to the existing workflow path unchanged.

### Step 10.1 (Red)

```typescript
import { describe, expect, it, vi } from "vitest";

// Construct the consumer with stubbed deps; only the pr_merged routing matters.
// Mirror the existing consumer spec's construction helper; here we focus on the
// new branch: an integration envelope is dispatched to the pr_merged handler and
// NOT routed through the workflow-run path.

describe("CoreLifecycleStreamConsumerService pr_merged routing", () => {
  it("dispatches a core.integration.pr_merged.v1 entry to the handler and advances the cursor", async () => {
    const prMergedHandler = { handle: vi.fn().mockResolvedValue(undefined) };
    const cursors = {
      getCursor: vi.fn().mockResolvedValue(null),
      saveCursor: vi.fn().mockResolvedValue(undefined),
    };
    const deadLetters = { saveDeadLetter: vi.fn(), countRecent: vi.fn() };

    // Build the consumer with the new prMergedHandler dependency and the
    // existing stubbed collaborators (projectionService, workItems, etc. as
    // no-op mocks). See the existing consumer spec for the full mock set.
    const consumer = buildConsumerUnderTest({
      prMergedHandler,
      cursors,
      deadLetters,
    });

    const envelope = {
      event_id: "e1",
      event_type: "core.integration.pr_merged.v1",
      event_version: "v1",
      occurred_at: "2026-06-22T00:00:00.000Z",
      correlation_id: "c1",
      source_service: "core",
      payload: {
        scopeId: "project-1",
        contextId: "wi-1",
        prUrl: "https://github.com/acme/widgets/pull/42",
        mergeCommitSha: "sha-merge",
      },
      metadata: null,
    };
    const entries = [
      [
        "1-0",
        [
          "event_type",
          envelope.event_type,
          "envelope",
          JSON.stringify(envelope),
        ],
      ],
    ];

    await consumer.processEntriesForTest(entries, "test-consumer");

    expect(prMergedHandler.handle).toHaveBeenCalledWith(envelope.payload);
    expect(cursors.saveCursor).toHaveBeenCalledWith("test-consumer", "1-0");
    expect(deadLetters.saveDeadLetter).not.toHaveBeenCalled();
  });
});
```

> Reuse the existing consumer spec's mock-construction helper for all the other constructor args (`buildConsumerUnderTest` here stands in for that helper plus the new `prMergedHandler`). If `processEntries` is private, expose a thin `processEntriesForTest` wrapper or test through `processAvailableEvents` with a stubbed `redis.xrange`. Read `core-lifecycle-stream.consumer.ts` + any existing consumer spec first and mirror its construction exactly.

Run (expect FAIL):

```bash
npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer.pr-merged
```

### Step 10.2 (Green) — add the branch

Inject the handler in the constructor:

```typescript
import { CoreIntegrationPrMergedEventEnvelopeV1Schema } from "@nexus/core";
import { CoreLifecycleStreamPrMergedHandler } from "./core-lifecycle-stream-pr-merged.handler";
// ...
constructor(
  // ...existing deps...
  private readonly prMergedHandler: CoreLifecycleStreamPrMergedHandler,
) { /* ... */ }
```

Add a constant and a pre-branch inside the `processEntries` loop, before the existing `parseEnvelope` workflow path:

```typescript
const PR_MERGED_EVENT_TYPE = "core.integration.pr_merged.v1";
```

```typescript
for (const [streamId, rawFields] of entries) {
  lastStreamId = streamId;
  const fields = toFields(rawFields);
  try {
    if (fields.event_type === PR_MERGED_EVENT_TYPE) {
      await this.handlePrMergedEntry(fields.envelope);
      processed += 1;
    } else {
      const envelope = this.parseEnvelope(fields.envelope);
      if (envelope.event_type.startsWith("core.workflow.run.")) {
        await this.projectionService.recordCoreLifecycleEvent(
          envelope as never,
        );
        await this.linkWorkItemRunFromLifecycleEvent(envelope);
      }
      await this.evaluateContinuationForTerminalRun(envelope);
      processed += 1;
    }
  } catch (error: unknown) {
    deadLettered += 1;
    const reason = error instanceof Error ? error.message : String(error);
    await this.deadLetters.saveDeadLetter({
      stream_key: CORE_LIFECYCLE_STREAM_KEY,
      stream_id: streamId,
      reason,
      payload: fields,
    });
    this.logger.warn(
      `Dead-lettered core lifecycle stream entry ${streamId}: ${reason}`,
    );
  }

  await this.cursors.saveCursor(consumerName, streamId);
}
```

Add the private dispatch method:

```typescript
private async handlePrMergedEntry(value: string | undefined): Promise<void> {
  if (!value) {
    throw new Error("Malformed pr_merged event: missing envelope");
  }
  const envelope = CoreIntegrationPrMergedEventEnvelopeV1Schema.parse(
    JSON.parse(value),
  );
  await this.prMergedHandler.handle(envelope.payload);
}
```

Register `CoreLifecycleStreamPrMergedHandler` as a provider in the kanban module that provides `CoreLifecycleStreamConsumerService` (the `core` module — confirm filename, e.g. `core.module.ts` / `kanban-core.module.ts`). Ensure `WorkItemService` + `KanbanWorkItemRepository` are resolvable there (the consumer already injects `KanbanWorkItemRepository`, and `WorkItemService` is in the work-item module — import it if needed).

Run (expect PASS) + kanban build:

```bash
npm run test --workspace=apps/kanban -- core-lifecycle-stream.consumer.pr-merged
npm run build:kanban
```

### Step 10.3 (Commit)

```bash
git add apps/kanban/src/core/core-lifecycle-stream.consumer.ts \
  apps/kanban/src/core/core-lifecycle-stream.consumer.pr-merged.spec.ts \
  apps/kanban/src/core/core.module.ts
git commit -m "feat(kanban): route core.integration.pr_merged.v1 to the merge handler

EPIC-209 Phase 4. Pre-branches the consumer loop on the integration event type
(parsed with its own schema), dispatches to the pr_merged handler; workflow
run/step path unchanged. Failures still dead-letter.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — Full regression sweep + boundary lint

**Files** — none (verification only).

```bash
npm run build --workspace=packages/core
npm run build:api
npm run build:kanban
npm run test --workspace=packages/core
npm run test --workspace=apps/api
npm run test --workspace=apps/kanban
npm run lint:api
npm run lint:kanban
```

Expected: all green. Specifically confirm `nexus-boundaries/no-core-kanban-residue` raises **no** finding against any new `apps/api/src/integration-events/*` file, the `@nexus/core` event schema, the publisher, finalizer, controller, reconciler, or repository edits — they contain only `scopeId`/`contextId` and VCS terms (`provider`, `owner`, `repo`, `pr_number`, `prUrl`, `mergeCommitSha`). The only kanban-domain identifiers (`awaiting-pr-merge`, `done`, `lifecycle.merge`, `work item`) live in `apps/kanban/src/core/core-lifecycle-stream-pr-merged.handler.ts` and the consumer branch. If the lint flags anything, fix the residue in code — never add an allowlist or `eslint-disable`.

Final commit if any lint-driven fixes were needed:

```bash
git add -A
git commit -m "chore(epic-209): phase 4 regression sweep and boundary verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes on decisions deliberately deferred

- **`auto_merge` / `merge_method` execution** (reconciler calling `MergeProvider.mergePullRequest`): Phase 5. Phase 4 only **observes** a provider-performed merge.
- **`preflight_gate` toggle** and **CEO stalled-PR awareness** (surfacing red checks / changes-requested / over-threshold PRs from `getPullRequestStatus.checks` / `reviewDecision`): Phase 5. Phase 4 reads `status.state`/`status.mergeCommitSha` only.
- **PR-path worktree cleanup on merge:** if not handled by the kanban transition side effects, it can be added to the `pr_merged` handler — but only if a Phase-3 deferral left it open; keep Phase 4 to detection + closure unless that cleanup is a strict prerequisite for `done`.
- **GitLab/Bitbucket webhook ingress** (different signature headers/algorithms behind the same `MergeProvider`): Phase 6.
- **Raw-body scope hardening:** the `main.ts` `verify` hook annotates `rawBody` for all JSON routes; if memory/perf is a concern, scope it to the webhook path in a follow-up. Not behaviour-affecting for Phase 4.

---

## Phase boundary — what Phase 5 consumes from Phase 4

Phase 4 leaves these handoffs for Phase 5 (tuning / auto-merge / stalled-PR visibility):

1. **The shared `PrMergeFinalizerService`** — Phase 5's reconciler, once it observes required checks green, calls `MergeProvider.mergePullRequest(ref, method)` and then routes the resulting `mergeCommitSha` through the **same** `finalizeMergedRow` path, so auto-merge converges with webhook/poll identically (no second emission).
2. **`getPullRequestStatus` already wired in the reconciler** — Phase 5 extends `reconcileRow` to act on `status.checks` (`failing`/`pending`) and `status.reviewDecision` (`changes_requested`) to (a) trigger provider-native merge-when-green when `auto_merge` is on, and (b) surface stalled/red PRs to the CEO. Phase 4 already loads `state='open'` rows and resolves the provider per row; Phase 5 only adds branches on the status fields it already fetches.
3. **The neutral `core.integration.pr_merged.v1` event + the `awaiting-pr-merge → done` consumer** — unchanged by Phase 5; auto-merge reuses them. Phase 5 may add sibling neutral events (e.g. `core.integration.pr_checks_failed.v1`) following the exact Task 1 pattern.

Phase 4 ships detection + closure only: a provider-observed merge (via webhook or poll) marks the tracking row `merged`, emits the neutral event exactly once, and the kanban consumer lands the work item in `done` with the merge commit recorded. `direct-push` repositories never enter this path and remain byte-for-byte unchanged.
