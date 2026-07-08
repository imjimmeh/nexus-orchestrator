# Epic E — Code-Change Bridge + Repair-Agent Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the improvement-proposal pipeline a governed path from a diagnosed code problem to a merged fix: a `code_change` proposal kind whose applier emits a neutral `improvement.task.requested.v1` event onto the core lifecycle stream, a Kanban-side consumer that files the brief as a work item on a configured self-improvement project (or parks with a warning when unconfigured), embedding-based dedup that bumps `occurrence_count` instead of creating duplicates, web-UI detail rendering for `code_change` proposals — and the complete deletion of the unused, ungoverned `apps/repair-agent`.

**Architecture:** API/core stays Kanban-neutral end to end. The `CodeChangeApplier` (registered on Epic A's `IMPROVEMENT_APPLIERS` multi-token) validates the proposal payload against a shared Zod schema in `packages/core`, then publishes a strict-Zod envelope to the existing Redis core lifecycle stream (`stream:core:lifecycle`) via a small `ImprovementTaskEventPublisher` that mirrors `WorkflowCoreLifecycleStreamPublisher`. On the Kanban side the existing `CoreIntegrationEventRouter` (the pre-parse dispatch tier of `CoreLifecycleStreamConsumerService`) gains one event type routed to a new `CoreLifecycleStreamImprovementTaskHandler`, which reads the new `self_improvement_project_id` Kanban setting and calls `WorkItemService.createWorkItem` with the work-item id set to the proposal id (natural idempotency). Unconfigured environments park the event through the consumer's established warn + dead-letter + advance-cursor convention. Dedup runs at proposal intake using the existing `CANDIDATE_SIMILARITY` machinery (`EmbeddingSimilarityService.findNearest` with an explicit corpus), preceded by a deterministic normalized-title equality guard that also covers embeddings-unconfigured environments.

**Tech Stack:** TypeScript, NestJS (apps/api + apps/kanban), Zod contracts in `packages/core` / `packages/kanban-contracts`, Redis streams (ioredis), TypeORM, React + Tailwind (apps/web), Vitest everywhere.

## Global Constraints

- **Depends on Epic A merged** — this plan consumes (never redefines) Epic A's contracts: `ImprovementProposalKind`, entity `ImprovementProposal` (with `occurrence_count`), `ImprovementProposalService.submitProposal/approve/reject`, `IImprovementApplier { readonly kind; apply(proposal): Promise<ImprovementApplyResult { ok, detail?, unrouted? }> }`, DI multi-token `IMPROVEMENT_APPLIERS` with appliers at `apps/api/src/improvement/appliers/`, and `ImprovementGovernancePolicyService` (tiered: `code_change` → `propose`; autonomous: `auto_apply` = file the work item automatically — the code itself always passes the quality-gate/merge pipeline).
- If Epic A landed the per-kind payload schemas at a path other than `packages/core/src/schemas/improvement/`, colocate Task 1's schema with them — the exported names in this plan are fixed, the directory follows Epic A.
- Boundary lint `nexus-boundaries/no-core-kanban-residue` must stay green; never add allowlists, `eslint-disable`, or quarantine symbols. Every API-side artifact (code, tests, comments) speaks only neutral vocabulary — no `kanban`, work-item, or project-domain identifiers.
- Never suppress linting anywhere (`eslint-disable`, `@ts-ignore`, rule downgrades); fix findings in code.
- Strict TDD Red-Green-Refactor per task; run only the targeted spec files while iterating.
- NestJS builds via `nest build` (`npm run build:api`), never raw `tsc`; build `packages/core` before dependent workspaces.
- apps/api and apps/kanban have separate Vitest suites (`npm run test:api` / `npm run test:kanban`); NestJS tests rely on SWC decorator metadata — follow existing spec conventions (plain `vi.fn()` object mocks + direct instantiation, no TestingModule needed for these services).
- No re-exports, no deprecation stubs, no legacy paths — repair-agent is deleted outright and every reference updated.
- `CLAUDE.md` is a symlink to `AGENTS.md` — editing `AGENTS.md` covers both.
- Commit per task on the working branch; message trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Resolved spec ambiguities (decisions baked into this plan)

1. **"Outbox → core lifecycle stream" conflates two mechanisms.** apps/api has (a) a DB-backed `domain_event_outbox` drained to an _in-process_ fanout only, and (b) the Redis stream `stream:core:lifecycle` published directly via `RedisStreamService` — only (b) reaches apps/kanban (its `CoreLifecycleStreamConsumerService` polls that stream). The applier therefore publishes to the Redis lifecycle stream, mirroring `WorkflowCoreLifecycleStreamPublisher` exactly. No outbox bridge is built.
2. **Event-type wire literal is `improvement.task.requested.v1`.** The spec names the event `improvement.task.requested`; every event type on this stream carries a `.v1` suffix (`core.integration.pr_merged.v1`, …) and the strict envelope has `event_version: "v1"` — the versioned literal follows the established contract convention.
3. **Dedup runs at proposal intake, not inside `apply()`.** The spec says both "before filing, the applier embeds…" and "…instead of creating a new one [proposal]"; bumping `occurrence_count` _instead of creating a proposal_ is only possible at submission time. A `CodeChangeProposalIntakeService` wraps `ImprovementProposalService.submitProposal` and is the mandatory entry point for `code_change` producers. Statuses checked: `pending` + `applied` (per spec §4.5); window: last 30 days.
4. **Park semantics are boundary-safe and asymmetric by design.** The API-side applier returns `ok: true` optimistically once the event is published (delivery is asynchronous; it cannot know Kanban's routing outcome without a back-channel that would violate the boundary). The spec's "`unrouted` marker in provenance" is therefore _not_ written for `code_change`; instead the Kanban consumer owns the park record: a warning log plus a dead-letter row (the consumer's existing warn + dead-letter + advance-cursor convention), replayable after configuration. Documented in the applier doc comment and the onboarding runbook.
5. **Work-item idempotency via deterministic id.** The Kanban handler passes `id: payload.proposalId` to `createWorkItem` and skips when `findByProjectAndId` already returns a row — duplicate stream deliveries can never file twice. (Proposal ids and work-item ids are both UUIDs.)
6. **Producer wiring is out of scope.** No Epic E code emits `code_change` drafts; the analyst/router producers arrive with Epic D's prompt extension. Epic E ships the intake entry point they must call.
7. **Historical docs stay.** `docs/plans/`, `docs/analysis/`, `docs/project-context/probe-results/`, `docs/work*/`, `.rpiv/`, `.beads/` references to repair-agent are historical records and are intentionally left untouched; all _living_ surfaces (README, AGENTS.md, .env.example, compose, docs/guide, docs/architecture, docs/operations, SDD, project-context architecture tables) are cleaned.

---

### Task 1: `code_change` payload schema (`packages/core`)

**Files:**

- Create: `packages/core/src/schemas/improvement/code-change.schema.ts`
- Create: `packages/core/src/schemas/improvement/code-change.schema.spec.ts`
- Create: `packages/core/src/schemas/improvement/index.ts`
- Modify: `packages/core/src/schemas/index.ts` (add `export * from "./improvement";` — skip if Epic A already added it)
- Verify (no change expected): Epic A's `ImprovementProposalKind` union already contains `"code_change"` (spec §4.1 kind enum). If it does not, add the literal there in this task — additive only.

**Interfaces:**

- Consumes: nothing (leaf contract).
- Produces:
  - `CodeChangeSeveritySchema = z.enum(["low", "medium", "high", "critical"])`
  - `CodeChangeEvidenceSchema` — `{ runIds: string[], failureClasses: string[], ledgerRefs: string[] }` (strict)
  - `CodeChangeProposalPayloadSchema` — `{ title: string, description: string, suspectedArea?: string[], evidence: CodeChangeEvidence, severity: CodeChangeSeverity }` (strict)
  - Types: `CodeChangeSeverity`, `CodeChangeEvidence`, `CodeChangeProposalPayload`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/schemas/improvement/code-change.schema.spec.ts
import { describe, expect, it } from "vitest";
import {
  CodeChangeProposalPayloadSchema,
  CodeChangeSeveritySchema,
} from "./code-change.schema";

const validPayload = {
  title: "Fix NUL-byte handling in outbox insert",
  description:
    "Runs fail terminally when docker log tails containing NUL bytes reach the outbox INSERT.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
};

describe("CodeChangeProposalPayloadSchema", () => {
  it("parses a fully-populated brief", () => {
    expect(CodeChangeProposalPayloadSchema.parse(validPayload)).toEqual(
      validPayload,
    );
  });

  it("parses without the optional suspectedArea", () => {
    const { suspectedArea: _omitted, ...rest } = validPayload;
    expect(CodeChangeProposalPayloadSchema.parse(rest)).toEqual(rest);
  });

  it("rejects a missing title", () => {
    const { title: _omitted, ...rest } = validPayload;
    expect(() => CodeChangeProposalPayloadSchema.parse(rest)).toThrow();
  });

  it("rejects an unknown severity", () => {
    expect(() =>
      CodeChangeProposalPayloadSchema.parse({
        ...validPayload,
        severity: "urgent",
      }),
    ).toThrow();
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      CodeChangeProposalPayloadSchema.parse({
        ...validPayload,
        workItemHint: "nope",
      }),
    ).toThrow();
  });

  it("exposes the severity enum for UI filters", () => {
    expect(CodeChangeSeveritySchema.options).toEqual([
      "low",
      "medium",
      "high",
      "critical",
    ]);
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=packages/core -- packages/core/src/schemas/improvement/code-change.schema.spec.ts` — expected: module-not-found for `./code-change.schema`.
- [ ] **Step 3: Minimal implementation**

```typescript
// packages/core/src/schemas/improvement/code-change.schema.ts
import { z } from "zod";

export const CodeChangeSeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const CodeChangeEvidenceSchema = z
  .object({
    runIds: z.array(z.string().min(1)),
    failureClasses: z.array(z.string().min(1)),
    ledgerRefs: z.array(z.string().min(1)),
  })
  .strict();

/**
 * Structured engineering brief carried by a `code_change` improvement
 * proposal: what is wrong, where the evidence lives, and how urgent it is.
 */
export const CodeChangeProposalPayloadSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().min(1),
    suspectedArea: z.array(z.string().min(1)).optional(),
    evidence: CodeChangeEvidenceSchema,
    severity: CodeChangeSeveritySchema,
  })
  .strict();

export type CodeChangeSeverity = z.infer<typeof CodeChangeSeveritySchema>;
export type CodeChangeEvidence = z.infer<typeof CodeChangeEvidenceSchema>;
export type CodeChangeProposalPayload = z.infer<
  typeof CodeChangeProposalPayloadSchema
>;
```

```typescript
// packages/core/src/schemas/improvement/index.ts
export * from "./code-change.schema";
```

And in `packages/core/src/schemas/index.ts` add (alphabetical placement beside the other subdir exports): `export * from "./improvement";`

- [ ] **Step 4: Run to green** — `npm run test --workspace=packages/core -- packages/core/src/schemas/improvement/code-change.schema.spec.ts`, then `npm run build --workspace=packages/core`.
- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "feat(core): add code_change improvement proposal payload schema" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 2: Neutral event contract `improvement.task.requested.v1` (`packages/core`)

**Files:**

- Modify: `packages/core/src/schemas/events/event-envelope.schema.ts`
- Modify: `packages/core/src/schemas/events/event-envelope.types.ts`
- Create: `packages/core/src/schemas/events/event-envelope.improvement-task.spec.ts`

**Interfaces:**

- Consumes: `EventEnvelopeV1Schema`, `InterServiceEventTypeV1Schema`, `InterServiceEventEnvelopeV1Schema` (existing, same file); `CodeChangeSeveritySchema`, `CodeChangeEvidenceSchema` (Task 1).
- Produces:
  - `ImprovementEventTypeV1Schema = z.enum(["improvement.task.requested.v1"])`
  - `ImprovementTaskRequestedPayloadV1Schema` (strict): `{ proposalId: string, title: string, description: string, suspectedArea?: string[], evidence: { runIds, failureClasses, ledgerRefs }, severity: "low"|"medium"|"high"|"critical", occurrenceCount: number (int ≥ 1) }`
  - `ImprovementTaskRequestedEventEnvelopeV1Schema = EventEnvelopeV1Schema.extend({ event_type: z.literal("improvement.task.requested.v1"), source_service: z.literal("core"), payload: ImprovementTaskRequestedPayloadV1Schema })`
  - Types: `ImprovementTaskRequestedV1` (payload), `ImprovementTaskRequestedEventEnvelopeV1Shape`
  - `InterServiceEventTypeV1Schema` union gains `ImprovementEventTypeV1Schema`; `InterServiceEventEnvelopeV1Schema` union gains the new envelope schema.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/schemas/events/event-envelope.improvement-task.spec.ts
import { describe, expect, it } from "vitest";
import {
  ImprovementTaskRequestedEventEnvelopeV1Schema,
  InterServiceEventEnvelopeV1Schema,
} from "./event-envelope.schema";

const validEnvelope = {
  event_id: "0f0e0d0c-0000-4000-8000-000000000001",
  event_type: "improvement.task.requested.v1",
  event_version: "v1",
  occurred_at: "2026-07-02T12:00:00.000Z",
  correlation_id: "11111111-0000-4000-8000-000000000002",
  source_service: "core",
  payload: {
    proposalId: "11111111-0000-4000-8000-000000000002",
    title: "Fix NUL-byte handling in outbox insert",
    description: "Runs fail terminally when NUL bytes reach the outbox INSERT.",
    suspectedArea: ["apps/api/src/domain-events"],
    evidence: {
      runIds: ["eac4e46e-0000-4000-8000-000000000001"],
      failureClasses: ["outbox_insert_failed"],
      ledgerRefs: ["ledger:123"],
    },
    severity: "high",
    occurrenceCount: 3,
  },
};

describe("ImprovementTaskRequestedEventEnvelopeV1Schema", () => {
  it("parses a valid envelope", () => {
    expect(
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse(validEnvelope),
    ).toEqual(validEnvelope);
  });

  it("is a member of the inter-service envelope union", () => {
    expect(InterServiceEventEnvelopeV1Schema.parse(validEnvelope)).toEqual(
      validEnvelope,
    );
  });

  it("rejects a non-core source service", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        source_service: "chat",
      }),
    ).toThrow();
  });

  it("rejects a zero occurrenceCount", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, occurrenceCount: 0 },
      }),
    ).toThrow();
  });

  it("rejects unknown payload keys (strict)", () => {
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, boardColumn: "todo" },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=packages/core -- packages/core/src/schemas/events/event-envelope.improvement-task.spec.ts` — expected: `ImprovementTaskRequestedEventEnvelopeV1Schema` is not exported.
- [ ] **Step 3: Minimal implementation** — in `event-envelope.schema.ts`:

Add after `CoreIntegrationEventTypeV1Schema` (line ~39):

```typescript
export const ImprovementEventTypeV1Schema = z.enum([
  "improvement.task.requested.v1",
]);
```

Extend the `InterServiceEventTypeV1Schema` union (line ~61):

```typescript
export const InterServiceEventTypeV1Schema = z.union([
  CoreWorkflowEventTypeV1Schema,
  CoreIntegrationEventTypeV1Schema,
  ImprovementEventTypeV1Schema,
  ChatEventTypeV1Schema,
]);
```

Add after `CoreIntegrationPrStatusEventEnvelopeV1Schema` (line ~206):

```typescript
import {
  CodeChangeEvidenceSchema,
  CodeChangeSeveritySchema,
} from "../improvement/code-change.schema"; // import goes at the top of the file

export const ImprovementTaskRequestedPayloadV1Schema = z
  .object({
    proposalId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    suspectedArea: z.array(z.string().min(1)).optional(),
    evidence: CodeChangeEvidenceSchema,
    severity: CodeChangeSeveritySchema,
    occurrenceCount: z.number().int().positive(),
  })
  .strict();

export const ImprovementTaskRequestedEventEnvelopeV1Schema =
  EventEnvelopeV1Schema.extend({
    event_type: z.literal("improvement.task.requested.v1"),
    source_service: z.literal("core"),
    payload: ImprovementTaskRequestedPayloadV1Schema,
  });
```

Extend the `InterServiceEventEnvelopeV1Schema` union (line ~232):

```typescript
export const InterServiceEventEnvelopeV1Schema = z.union([
  CoreWorkflowEventEnvelopeV1Schema,
  CoreIntegrationPrMergedEventEnvelopeV1Schema,
  CoreIntegrationPrStatusEventEnvelopeV1Schema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
  ChatEventEnvelopeV1Schema,
]);
```

In `event-envelope.types.ts` add (mirroring the `CoreIntegrationPrMergedV1` pattern):

```typescript
export type ImprovementTaskRequestedV1 = z.infer<
  typeof ImprovementTaskRequestedPayloadV1Schema
>;
export type ImprovementTaskRequestedEventEnvelopeV1Shape = z.infer<
  typeof ImprovementTaskRequestedEventEnvelopeV1Schema
>;
```

(and add both schema names to the import list at the top of the types file).

- [ ] **Step 4: Run to green** — `npm run test --workspace=packages/core -- packages/core/src/schemas/events/event-envelope.improvement-task.spec.ts packages/core/src/schemas/events/event-envelope.schema.spec.ts` (the second file guards against union regressions), then `npm run build --workspace=packages/core`.
- [ ] **Step 5: Commit** — `git add packages/core && git commit -m "feat(core): add improvement.task.requested.v1 inter-service event contract" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 3: `ImprovementTaskEventPublisher` (apps/api)

**Files:**

- Create: `apps/api/src/improvement/improvement-task-event.publisher.ts`
- Create: `apps/api/src/improvement/improvement-task-event.publisher.spec.ts`
- Modify: `apps/api/src/improvement/improvement.module.ts` (Epic A module: add `RedisModule` to `imports` if absent, `ImprovementTaskEventPublisher` to `providers`)

**Interfaces:**

- Consumes:
  - `RedisStreamService.appendToStream(key, fields, { maxLength }): Promise<string | null>` (`apps/api/src/redis/redis-stream.service.ts`, exported by `RedisModule` at `apps/api/src/redis/redis.module.ts`)
  - `CORE_LIFECYCLE_STREAM_KEY = 'stream:core:lifecycle'` (exported constant, `apps/api/src/workflow/workflow-core-lifecycle-stream.publisher.ts:5`)
  - `ImprovementTaskRequestedEventEnvelopeV1Shape` (Task 2, `@nexus/core`)
- Produces: `ImprovementTaskEventPublisher.publish(envelope: ImprovementTaskRequestedEventEnvelopeV1Shape): Promise<string>` — appends `{ event_id, event_type, occurred_at, envelope: JSON.stringify(envelope) }` to the lifecycle stream. (No `run_id`/`workflow_id` fields: the Kanban consumer's router tier reads only `event_type` + `envelope`; see `toFields` in `apps/kanban/src/core/core-lifecycle-stream.helpers.ts:60`.)

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/improvement/improvement-task-event.publisher.spec.ts
import { describe, expect, it, vi } from "vitest";
import { ImprovementTaskRequestedEventEnvelopeV1Schema } from "@nexus/core";
import { ImprovementTaskEventPublisher } from "./improvement-task-event.publisher";
import type { RedisStreamService } from "../redis/redis-stream.service";

const envelope = ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
  event_id: "0f0e0d0c-0000-4000-8000-000000000001",
  event_type: "improvement.task.requested.v1",
  event_version: "v1",
  occurred_at: "2026-07-02T12:00:00.000Z",
  correlation_id: "11111111-0000-4000-8000-000000000002",
  source_service: "core",
  payload: {
    proposalId: "11111111-0000-4000-8000-000000000002",
    title: "Fix NUL-byte handling in outbox insert",
    description: "Runs fail terminally when NUL bytes reach the outbox INSERT.",
    evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
    severity: "high",
    occurrenceCount: 1,
  },
});

function buildPublisher(appendResult: string | null) {
  const stream = { appendToStream: vi.fn().mockResolvedValue(appendResult) };
  const publisher = new ImprovementTaskEventPublisher(
    stream as unknown as RedisStreamService,
  );
  return { stream, publisher };
}

describe("ImprovementTaskEventPublisher", () => {
  it("appends the envelope to the core lifecycle stream", async () => {
    const { stream, publisher } = buildPublisher("1-1");

    await expect(publisher.publish(envelope)).resolves.toBe("1-1");

    expect(stream.appendToStream).toHaveBeenCalledWith(
      "stream:core:lifecycle",
      {
        event_id: envelope.event_id,
        event_type: "improvement.task.requested.v1",
        occurred_at: envelope.occurred_at,
        envelope: JSON.stringify(envelope),
      },
      { maxLength: 100000 },
    );
  });

  it("throws when Redis returns no stream id", async () => {
    const { publisher } = buildPublisher(null);

    await expect(publisher.publish(envelope)).rejects.toThrow(
      "Redis did not return a stream id",
    );
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=apps/api -- apps/api/src/improvement/improvement-task-event.publisher.spec.ts` — expected: cannot resolve `./improvement-task-event.publisher`.
- [ ] **Step 3: Minimal implementation**

```typescript
// apps/api/src/improvement/improvement-task-event.publisher.ts
import { Injectable, Logger } from "@nestjs/common";
import type { ImprovementTaskRequestedEventEnvelopeV1Shape } from "@nexus/core";
import { RedisStreamService } from "../redis/redis-stream.service";
import { CORE_LIFECYCLE_STREAM_KEY } from "../workflow/workflow-core-lifecycle-stream.publisher";

const IMPROVEMENT_TASK_STREAM_MAX_LENGTH = 100000;

/**
 * Publishes neutral improvement-task events onto the core lifecycle stream.
 * Mirrors WorkflowCoreLifecycleStreamPublisher; downstream consumers of the
 * stream decide how (and whether) to route the brief.
 */
@Injectable()
export class ImprovementTaskEventPublisher {
  private readonly logger = new Logger(ImprovementTaskEventPublisher.name);

  constructor(private readonly stream: RedisStreamService) {}

  async publish(
    envelope: ImprovementTaskRequestedEventEnvelopeV1Shape,
  ): Promise<string> {
    try {
      const streamId = await this.stream.appendToStream(
        CORE_LIFECYCLE_STREAM_KEY,
        {
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          occurred_at: envelope.occurred_at,
          envelope: JSON.stringify(envelope),
        },
        { maxLength: IMPROVEMENT_TASK_STREAM_MAX_LENGTH },
      );
      if (!streamId) {
        throw new Error("Redis did not return a stream id");
      }
      return streamId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to publish improvement task event ${envelope.event_id}: ${message}`,
      );
      throw error;
    }
  }
}
```

Module wiring in `apps/api/src/improvement/improvement.module.ts`: add `RedisModule` (from `../redis/redis.module`) to `imports` and `ImprovementTaskEventPublisher` to `providers`.

- [ ] **Step 4: Run to green** — `npm run test --workspace=apps/api -- apps/api/src/improvement/improvement-task-event.publisher.spec.ts`, then `npm run build:api`.
- [ ] **Step 5: Commit** — `git add apps/api/src/improvement && git commit -m "feat(api): publish improvement task events onto the core lifecycle stream" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 4: Dedup — `CodeChangeDedupService` + intake entry point

**Files:**

- Create: `apps/api/src/improvement/code-change-dedup.helpers.ts` (pure `normalizeCodeChangeTitle`)
- Create: `apps/api/src/improvement/code-change-dedup.helpers.spec.ts`
- Create: `apps/api/src/improvement/code-change-dedup.service.ts`
- Create: `apps/api/src/improvement/code-change-dedup.service.spec.ts`
- Create: `apps/api/src/improvement/code-change-proposal-intake.service.ts`
- Create: `apps/api/src/improvement/code-change-proposal-intake.service.spec.ts`
- Modify: Epic A's `ImprovementProposal` repository (at `apps/api/src/improvement/`, exact filename per Epic A — additive methods only): add `findRecentByKindAndStatuses(kind, statuses, sinceDays)` and `bumpOccurrence(id)` if Epic A did not already ship them.
- Modify: `apps/api/src/improvement/improvement.module.ts` — add `MemorySignalsModule` (from `../memory/signals/memory-signals.module`, which provides and exports the `CANDIDATE_SIMILARITY` token) to `imports`; add the two new services to `providers`; export `CodeChangeProposalIntakeService` (future producers in Epic D call it).

**Interfaces:**

- Consumes:
  - `CANDIDATE_SIMILARITY` DI token + `ICandidateSimilarity.findNearest(text, k, scope): Promise<SimilarNeighbor[]>` with `scope = { ownerType, ownerIds, corpus }` (`apps/api/src/memory/signals/candidate-similarity.interface.ts`) — bound to `EmbeddingSimilarityService` (`apps/api/src/memory/signals/embedding-similarity.service.ts`), which already degrades to lexical scoring when `EmbeddingProviderService.embed` reports `configured: false`. This is the exact pattern of `LearningRouterService.matchesExistingSkill`/`loadSkillCorpus` (`apps/api/src/memory/learning/learning-router.service.ts:168-199`) — reuse, no new embedding infra.
  - `CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT = 0.85` (`apps/api/src/memory/signals/candidate-similarity.config.ts`)
  - `ImprovementProposalService.submitProposal(draft)` and the `ImprovementProposal` entity/repository (Epic A).
  - `CodeChangeProposalPayloadSchema` (Task 1).
- Produces:
  - `normalizeCodeChangeTitle(title: string): string` — lowercase, punctuation → space, collapse whitespace, trim.
  - `CodeChangeDedupService.findDuplicate(payload: CodeChangeProposalPayload): Promise<ImprovementProposal | null>`
  - `CodeChangeProposalIntakeService.submitCodeChangeProposal(draft): Promise<{ proposal: ImprovementProposal; deduplicated: boolean }>` — the single entry point for `code_change` producers: duplicate → `bumpOccurrence` on the existing row (no new proposal); otherwise → `submitProposal`.
  - Constants: `CODE_CHANGE_DEDUP_K = 5`, `CODE_CHANGE_DEDUP_OWNER_TYPE = 'improvement_proposal'`, `CODE_CHANGE_DEDUP_RECENT_DAYS = 30`, `CODE_CHANGE_DEDUP_STATUSES = ['pending', 'applied'] as const`.

- [ ] **Step 1: Write the failing helper test**

```typescript
// apps/api/src/improvement/code-change-dedup.helpers.spec.ts
import { describe, expect, it } from "vitest";
import { normalizeCodeChangeTitle } from "./code-change-dedup.helpers";

describe("normalizeCodeChangeTitle", () => {
  it("lowercases, strips punctuation, and collapses whitespace", () => {
    expect(
      normalizeCodeChangeTitle("  Fix: NUL-byte  handling (outbox INSERT)! "),
    ).toBe("fix nul byte handling outbox insert");
  });

  it("treats equivalent titles as identical", () => {
    expect(normalizeCodeChangeTitle("Fix outbox NUL bytes.")).toBe(
      normalizeCodeChangeTitle("fix outbox   nul bytes"),
    );
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=apps/api -- apps/api/src/improvement/code-change-dedup.helpers.spec.ts` — expected: module not found.
- [ ] **Step 3: Minimal helper implementation**

```typescript
// apps/api/src/improvement/code-change-dedup.helpers.ts
/**
 * Deterministic title key used for exact-duplicate detection — and as the
 * dedup floor in environments where the embedding provider is unconfigured.
 */
export function normalizeCodeChangeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
```

- [ ] **Step 4: Run helper to green**, then **write the failing dedup-service test**

```typescript
// apps/api/src/improvement/code-change-dedup.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { CodeChangeDedupService } from "./code-change-dedup.service";

const payload = {
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
  severity: "high" as const,
};

function buildProposal(id: string, title: string, description: string) {
  return {
    id,
    kind: "code_change",
    status: "pending",
    payload: { ...payload, title, description },
    occurrence_count: 1,
  };
}

function buildService(recent: unknown[], neighbours: unknown[] = []) {
  const proposals = {
    findRecentByKindAndStatuses: vi.fn().mockResolvedValue(recent),
  };
  const similarity = { findNearest: vi.fn().mockResolvedValue(neighbours) };
  const service = new CodeChangeDedupService(
    similarity as never,
    proposals as never,
  );
  return { service, proposals, similarity };
}

describe("CodeChangeDedupService", () => {
  it("returns null when no recent code_change proposals exist", async () => {
    const { service, similarity } = buildService([]);
    await expect(service.findDuplicate(payload)).resolves.toBeNull();
    expect(similarity.findNearest).not.toHaveBeenCalled();
  });

  it("matches on normalized-title equality without calling similarity", async () => {
    const existing = buildProposal(
      "p-1",
      "fix nul byte handling in outbox insert!",
      "different wording",
    );
    const { service, similarity } = buildService([existing]);
    await expect(service.findDuplicate(payload)).resolves.toBe(existing);
    expect(similarity.findNearest).not.toHaveBeenCalled();
  });

  it("matches via embedding similarity above the threshold", async () => {
    const existing = buildProposal("p-2", "Outbox wedges on binary logs", "x");
    const { service, similarity } = buildService(
      [existing],
      [{ ownerType: "improvement_proposal", ownerId: "p-2", score: 0.91 }],
    );
    await expect(service.findDuplicate(payload)).resolves.toBe(existing);
    expect(similarity.findNearest).toHaveBeenCalledWith(
      `${payload.title}\n${payload.description}`,
      5,
      expect.objectContaining({
        ownerType: "improvement_proposal",
        ownerIds: ["p-2"],
        corpus: [
          { ownerId: "p-2", content: "Outbox wedges on binary logs\nx" },
        ],
      }),
    );
  });

  it("returns null when the best neighbour is below the threshold", async () => {
    const existing = buildProposal("p-3", "Unrelated flake in web tests", "y");
    const { service } = buildService(
      [existing],
      [{ ownerType: "improvement_proposal", ownerId: "p-3", score: 0.4 }],
    );
    await expect(service.findDuplicate(payload)).resolves.toBeNull();
  });
});
```

- [ ] **Step 5: Run and confirm failure**, then **implement the dedup service**

```typescript
// apps/api/src/improvement/code-change-dedup.service.ts
import { Inject, Injectable } from "@nestjs/common";
import type { CodeChangeProposalPayload } from "@nexus/core";
import { CodeChangeProposalPayloadSchema } from "@nexus/core";
import {
  CANDIDATE_SIMILARITY,
  type ICandidateSimilarity,
} from "../memory/signals/candidate-similarity.interface";
import { CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT } from "../memory/signals/candidate-similarity.config";
import { normalizeCodeChangeTitle } from "./code-change-dedup.helpers";
// Epic A entity + repository — import from their Epic A locations:
import type { ImprovementProposal } from "./database/entities/improvement-proposal.entity";
import { ImprovementProposalRepository } from "./database/repositories/improvement-proposal.repository";

export const CODE_CHANGE_DEDUP_K = 5;
export const CODE_CHANGE_DEDUP_OWNER_TYPE = "improvement_proposal";
export const CODE_CHANGE_DEDUP_RECENT_DAYS = 30;
export const CODE_CHANGE_DEDUP_STATUSES = ["pending", "applied"] as const;

@Injectable()
export class CodeChangeDedupService {
  constructor(
    @Inject(CANDIDATE_SIMILARITY)
    private readonly similarity: ICandidateSimilarity,
    private readonly proposals: ImprovementProposalRepository,
  ) {}

  async findDuplicate(
    payload: CodeChangeProposalPayload,
  ): Promise<ImprovementProposal | null> {
    const recent = await this.proposals.findRecentByKindAndStatuses(
      "code_change",
      [...CODE_CHANGE_DEDUP_STATUSES],
      CODE_CHANGE_DEDUP_RECENT_DAYS,
    );
    if (recent.length === 0) {
      return null;
    }

    const normalizedTitle = normalizeCodeChangeTitle(payload.title);
    const byTitle = recent.find(
      (proposal) =>
        normalizeCodeChangeTitle(this.readPayload(proposal).title) ===
        normalizedTitle,
    );
    if (byTitle) {
      return byTitle;
    }

    const corpus = recent.map((proposal) => {
      const existing = this.readPayload(proposal);
      return {
        ownerId: proposal.id,
        content: `${existing.title}\n${existing.description}`,
      };
    });
    const neighbours = await this.similarity.findNearest(
      `${payload.title}\n${payload.description}`,
      CODE_CHANGE_DEDUP_K,
      {
        ownerType: CODE_CHANGE_DEDUP_OWNER_TYPE,
        ownerIds: corpus.map((entry) => entry.ownerId),
        corpus,
      },
    );
    const top = neighbours[0];
    if (top && top.score >= CANDIDATE_SIMILARITY_THRESHOLD_DEFAULT) {
      return recent.find((proposal) => proposal.id === top.ownerId) ?? null;
    }
    return null;
  }

  private readPayload(
    proposal: ImprovementProposal,
  ): CodeChangeProposalPayload {
    return CodeChangeProposalPayloadSchema.parse(proposal.payload);
  }
}
```

Adjust the two Epic A import paths to Epic A's actual entity/repository filenames (the classes and method names above are the contract; only the paths follow Epic A). If the repository lacks the two methods, add them:

```typescript
// additive methods on Epic A's ImprovementProposalRepository
async findRecentByKindAndStatuses(
  kind: string,
  statuses: string[],
  sinceDays: number,
): Promise<ImprovementProposal[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  return this.repository.find({
    where: { kind, status: In(statuses), created_at: MoreThan(since) },
    order: { created_at: 'DESC' },
  });
}

async bumpOccurrence(id: string): Promise<void> {
  await this.repository.increment({ id }, 'occurrence_count', 1);
}
```

(with matching repository spec cases: filters by kind + status + window; increment issues a single atomic `increment` call.)

- [ ] **Step 6: Run dedup service to green**, then **write the failing intake test**

```typescript
// apps/api/src/improvement/code-change-proposal-intake.service.spec.ts
import { describe, expect, it, vi } from "vitest";
import { CodeChangeProposalIntakeService } from "./code-change-proposal-intake.service";

const draft = {
  kind: "code_change" as const,
  payload: {
    title: "Fix NUL-byte handling in outbox insert",
    description: "NUL bytes abort the outbox INSERT and wedge the run.",
    evidence: {
      runIds: ["run-1"],
      failureClasses: ["outbox_insert_failed"],
      ledgerRefs: [],
    },
    severity: "high" as const,
  },
  evidence: {
    runIds: ["run-1"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: [],
  },
  confidence: 0.6,
  provenance: { source: "spec" },
};

function buildService(duplicate: { id: string } | null) {
  const dedup = { findDuplicate: vi.fn().mockResolvedValue(duplicate) };
  const proposals = {
    bumpOccurrence: vi.fn().mockResolvedValue(undefined),
    findById: vi
      .fn()
      .mockResolvedValue(
        duplicate ? { ...duplicate, occurrence_count: 2 } : null,
      ),
  };
  const proposalService = {
    submitProposal: vi
      .fn()
      .mockResolvedValue({ id: "new-1", occurrence_count: 1 }),
  };
  const service = new CodeChangeProposalIntakeService(
    dedup as never,
    proposals as never,
    proposalService as never,
  );
  return { service, dedup, proposals, proposalService };
}

describe("CodeChangeProposalIntakeService", () => {
  it("bumps occurrence_count on a duplicate instead of creating a proposal", async () => {
    const { service, proposals, proposalService } = buildService({ id: "p-1" });

    const result = await service.submitCodeChangeProposal(draft as never);

    expect(result.deduplicated).toBe(true);
    expect(proposals.bumpOccurrence).toHaveBeenCalledWith("p-1");
    expect(proposalService.submitProposal).not.toHaveBeenCalled();
  });

  it("submits a new proposal when no duplicate is found", async () => {
    const { service, proposals, proposalService } = buildService(null);

    const result = await service.submitCodeChangeProposal(draft as never);

    expect(result.deduplicated).toBe(false);
    expect(proposalService.submitProposal).toHaveBeenCalledWith(draft);
    expect(proposals.bumpOccurrence).not.toHaveBeenCalled();
  });

  it("rejects a draft whose payload fails the code_change schema", async () => {
    const { service } = buildService(null);
    await expect(
      service.submitCodeChangeProposal({
        ...draft,
        payload: { title: "" },
      } as never),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run and confirm failure**, then **implement the intake service**

```typescript
// apps/api/src/improvement/code-change-proposal-intake.service.ts
import { Injectable, Logger } from "@nestjs/common";
import { CodeChangeProposalPayloadSchema } from "@nexus/core";
import { CodeChangeDedupService } from "./code-change-dedup.service";
import type { ImprovementProposal } from "./database/entities/improvement-proposal.entity";
import { ImprovementProposalRepository } from "./database/repositories/improvement-proposal.repository";
import { ImprovementProposalService } from "./improvement-proposal.service";
import type { ImprovementProposalDraft } from "./improvement-proposal.types"; // Epic A draft type

/**
 * Single entry point for code_change producers. Runs dedup before any row is
 * created: a duplicate bumps occurrence_count on the existing proposal so
 * recurring failure classes become a prioritization signal, never queue spam.
 */
@Injectable()
export class CodeChangeProposalIntakeService {
  private readonly logger = new Logger(CodeChangeProposalIntakeService.name);

  constructor(
    private readonly dedup: CodeChangeDedupService,
    private readonly proposals: ImprovementProposalRepository,
    private readonly proposalService: ImprovementProposalService,
  ) {}

  async submitCodeChangeProposal(
    draft: ImprovementProposalDraft,
  ): Promise<{ proposal: ImprovementProposal; deduplicated: boolean }> {
    const payload = CodeChangeProposalPayloadSchema.parse(draft.payload);
    const duplicate = await this.dedup.findDuplicate(payload);
    if (duplicate) {
      await this.proposals.bumpOccurrence(duplicate.id);
      this.logger.log(
        `code_change draft deduplicated against proposal ${duplicate.id}`,
      );
      const refreshed = await this.proposals.findById(duplicate.id);
      return { proposal: refreshed ?? duplicate, deduplicated: true };
    }
    const proposal = await this.proposalService.submitProposal(draft);
    return { proposal, deduplicated: false };
  }
}
```

(Adjust the three Epic A import paths — entity, repository, service, draft type — to Epic A's actual filenames.)

- [ ] **Step 8: Run to green** — `npm run test --workspace=apps/api -- apps/api/src/improvement/code-change-dedup.helpers.spec.ts apps/api/src/improvement/code-change-dedup.service.spec.ts apps/api/src/improvement/code-change-proposal-intake.service.spec.ts`, then `npm run build:api`.
- [ ] **Step 9: Commit** — `git add apps/api/src/improvement && git commit -m "feat(api): dedup code_change proposals at intake via embedding similarity with title-equality floor" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 5: `CodeChangeApplier` (apps/api)

**Files:**

- Create: `apps/api/src/improvement/appliers/code-change.applier.ts`
- Create: `apps/api/src/improvement/appliers/code-change.applier.spec.ts`
- Modify: `apps/api/src/improvement/improvement.module.ts` — add `CodeChangeApplier` to `providers` **and** to the `IMPROVEMENT_APPLIERS` multi-provider registration (Epic A's registry shape — same pattern as the special-step handler registry).

**Interfaces:**

- Consumes:
  - `IImprovementApplier` + `ImprovementApplyResult { ok, detail?, unrouted? }` + `IMPROVEMENT_APPLIERS` (Epic A, `apps/api/src/improvement/appliers/`)
  - `ImprovementTaskEventPublisher.publish(envelope)` (Task 3)
  - `ImprovementTaskRequestedEventEnvelopeV1Schema` / `CodeChangeProposalPayloadSchema` (`@nexus/core`, Tasks 1–2)
  - `EventLedgerService.emitBestEffort(params: EmitEventLedgerParams): Promise<void>` (`apps/api/src/observability/event-ledger.service.ts:31`)
- Produces: `CodeChangeApplier implements IImprovementApplier` with `readonly kind = 'code_change'`; `apply(proposal)` validates the payload, publishes one `improvement.task.requested.v1` envelope (`correlation_id = proposal.id`, `occurrenceCount = proposal.occurrence_count`), emits a best-effort ledger entry, and returns `{ ok: true, detail: ... }`. No `rollback` (a filed brief is withdrawn downstream, not rolled back here); no `rollback_data` (the applier mutates nothing). Retried `apply` re-publishes the same `proposalId` — the downstream consumer is idempotent on it (Task 7), so the applier is idempotent end-to-end.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/improvement/appliers/code-change.applier.spec.ts
import { describe, expect, it, vi } from "vitest";
import { ImprovementTaskRequestedEventEnvelopeV1Schema } from "@nexus/core";
import { CodeChangeApplier } from "./code-change.applier";

const proposal = {
  id: "11111111-0000-4000-8000-000000000002",
  kind: "code_change",
  status: "approved",
  occurrence_count: 3,
  payload: {
    title: "Fix NUL-byte handling in outbox insert",
    description: "NUL bytes abort the outbox INSERT and wedge the run.",
    suspectedArea: ["apps/api/src/domain-events"],
    evidence: {
      runIds: ["eac4e46e-0000-4000-8000-000000000001"],
      failureClasses: ["outbox_insert_failed"],
      ledgerRefs: ["ledger:123"],
    },
    severity: "high",
  },
};

function buildApplier() {
  const publisher = { publish: vi.fn().mockResolvedValue("1-1") };
  const ledger = { emitBestEffort: vi.fn().mockResolvedValue(undefined) };
  const applier = new CodeChangeApplier(publisher as never, ledger as never);
  return { applier, publisher, ledger };
}

describe("CodeChangeApplier", () => {
  it("declares the code_change kind", () => {
    expect(buildApplier().applier.kind).toBe("code_change");
  });

  it("publishes a schema-valid neutral envelope carrying the brief", async () => {
    const { applier, publisher } = buildApplier();

    const result = await applier.apply(proposal as never);

    expect(result.ok).toBe(true);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    const envelope = publisher.publish.mock.calls[0][0];
    expect(() =>
      ImprovementTaskRequestedEventEnvelopeV1Schema.parse(envelope),
    ).not.toThrow();
    expect(envelope.correlation_id).toBe(proposal.id);
    expect(envelope.payload).toMatchObject({
      proposalId: proposal.id,
      title: proposal.payload.title,
      severity: "high",
      occurrenceCount: 3,
    });
  });

  it("emits a best-effort ledger audit entry on publish", async () => {
    const { applier, ledger } = buildApplier();
    await applier.apply(proposal as never);
    expect(ledger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "improvement.task.requested.v1",
        outcome: "success",
        correlationId: proposal.id,
      }),
    );
  });

  it("returns ok:false with detail when the payload fails validation", async () => {
    const { applier, publisher } = buildApplier();
    const result = await applier.apply({
      ...proposal,
      payload: { title: "" },
    } as never);
    expect(result.ok).toBe(false);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=apps/api -- apps/api/src/improvement/appliers/code-change.applier.spec.ts` — expected: module not found.
- [ ] **Step 3: Minimal implementation**

```typescript
// apps/api/src/improvement/appliers/code-change.applier.ts
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  CodeChangeProposalPayloadSchema,
  ImprovementTaskRequestedEventEnvelopeV1Schema,
} from "@nexus/core";
import { EventLedgerService } from "../../observability/event-ledger.service";
import { ImprovementTaskEventPublisher } from "../improvement-task-event.publisher";
import type { ImprovementProposal } from "../database/entities/improvement-proposal.entity";
import type {
  IImprovementApplier,
  ImprovementApplyResult,
} from "./improvement-applier.interface"; // Epic A interface location

/**
 * Applies a code_change proposal by publishing the neutral
 * improvement.task.requested.v1 event onto the core lifecycle stream.
 *
 * Boundary note: this applier never references any downstream consumer's
 * domain. Delivery is asynchronous — a successful apply means "the brief was
 * published", and routing outcomes (including parking when no destination is
 * configured) are logged by the consuming service. `unrouted` is therefore
 * never set here. Re-applying publishes the same proposalId, which downstream
 * consumers treat idempotently.
 */
@Injectable()
export class CodeChangeApplier implements IImprovementApplier {
  readonly kind = "code_change" as const;
  private readonly logger = new Logger(CodeChangeApplier.name);

  constructor(
    private readonly publisher: ImprovementTaskEventPublisher,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async apply(proposal: ImprovementProposal): Promise<ImprovementApplyResult> {
    const parsed = CodeChangeProposalPayloadSchema.safeParse(proposal.payload);
    if (!parsed.success) {
      return {
        ok: false,
        detail: `code_change payload failed validation: ${parsed.error.message}`,
      };
    }
    const payload = parsed.data;

    const envelope = ImprovementTaskRequestedEventEnvelopeV1Schema.parse({
      event_id: randomUUID(),
      event_type: "improvement.task.requested.v1",
      event_version: "v1",
      occurred_at: new Date().toISOString(),
      correlation_id: proposal.id,
      source_service: "core",
      payload: {
        proposalId: proposal.id,
        title: payload.title,
        description: payload.description,
        ...(payload.suspectedArea
          ? { suspectedArea: payload.suspectedArea }
          : {}),
        evidence: payload.evidence,
        severity: payload.severity,
        occurrenceCount: proposal.occurrence_count,
      },
    });

    await this.publisher.publish(envelope);
    await this.eventLedger.emitBestEffort({
      domain: "improvement",
      eventName: "improvement.task.requested.v1",
      outcome: "success",
      source: CodeChangeApplier.name,
      correlationId: proposal.id,
      payload: { proposalId: proposal.id, severity: payload.severity },
    });

    return {
      ok: true,
      detail:
        "improvement.task.requested.v1 published; downstream routing is asynchronous and recorded by the consuming service",
    };
  }
}
```

(Adjust the Epic A import paths for the entity and applier interface; check `EmitEventLedgerParams` in `apps/api/src/observability/event-ledger.service.types.ts` for the exact `domain`/`outcome` value types and align.) Register in `improvement.module.ts` providers + the `IMPROVEMENT_APPLIERS` multi-provider list, and import `ObservabilityModule` (or wherever `EventLedgerService` is exported from — mirror how other apps/api modules consume it) if the module does not already.

- [ ] **Step 4: Run to green** — `npm run test --workspace=apps/api -- apps/api/src/improvement/appliers/code-change.applier.spec.ts`, then `npm run build:api`.
- [ ] **Step 5: Boundary check** — `npm run lint:api` — `nexus-boundaries/no-core-kanban-residue` must pass with zero new findings; also `grep -rniE "kanban|work.item" apps/api/src/improvement/` must return nothing.
- [ ] **Step 6: Commit** — `git add apps/api/src/improvement && git commit -m "feat(api): CodeChangeApplier publishes neutral improvement.task.requested events" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 6: Kanban setting `self_improvement_project_id`

**Files:**

- Modify: `packages/kanban-contracts/src/settings.schema.ts` — add `"self_improvement_project_id"` to `KanbanSettingKeySchema` (line 3–18 enum).
- Modify: `apps/kanban/src/settings/kanban-settings.constants.ts` — add the key to `KANBAN_SETTING_DEFAULTS`.
- Create: `apps/kanban/src/settings/kanban-settings.constants.spec.ts` (if a constants spec does not already exist; otherwise extend it).

**Interfaces:**

- Consumes: `KanbanSettingKey` (kanban-contracts), `KanbanSettingDefinition` (constants file).
- Produces: setting key `self_improvement_project_id` — `type: "string"`, `group: "orchestration"`, default `""` (empty = disabled/parked). Read at runtime via `KanbanSettingsService.get<string>("self_improvement_project_id", "")` (`apps/kanban/src/settings/kanban-settings.service.ts`); seeded on boot by the service's `OnModuleInit` defaults pass; writable through the existing settings API because `isKanbanSettingKey` derives from `KANBAN_SETTING_DEFAULTS`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/kanban/src/settings/kanban-settings.constants.spec.ts
import { describe, expect, it } from "vitest";
import {
  isKanbanSettingKey,
  KANBAN_SETTING_DEFAULTS,
} from "./kanban-settings.constants";

describe("self_improvement_project_id setting", () => {
  it("is a registered setting key", () => {
    expect(isKanbanSettingKey("self_improvement_project_id")).toBe(true);
  });

  it("defaults to empty (filing disabled) in the orchestration group", () => {
    const definition = KANBAN_SETTING_DEFAULTS.self_improvement_project_id;
    expect(definition.value).toBe("");
    expect(definition.type).toBe("string");
    expect(definition.group).toBe("orchestration");
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=apps/kanban -- apps/kanban/src/settings/kanban-settings.constants.spec.ts` — expected: TS error, `"self_improvement_project_id"` is not a `KanbanSettingKey` / property missing from defaults.
- [ ] **Step 3: Minimal implementation** — add to `KanbanSettingKeySchema` enum (after `"orchestration_wake_policy"`): `"self_improvement_project_id",` — then rebuild contracts (`npm run build --workspace=packages/kanban-contracts`) and add to `KANBAN_SETTING_DEFAULTS` (after the `orchestration_wake_policy` entry):

```typescript
  self_improvement_project_id: {
    value: "",
    description:
      "Project id that receives improvement.task.requested engineering briefs from core as new work items. Empty disables filing — events are parked (warning + dead letter). See docs/operations/self-improvement-project.md.",
    type: "string",
    group: "orchestration",
  },
```

- [ ] **Step 4: Run to green** — `npm run test --workspace=apps/kanban -- apps/kanban/src/settings/kanban-settings.constants.spec.ts apps/kanban/src/settings/kanban-settings.service.spec.ts` (the service spec guards the seeded-defaults pass), then `npm run build:kanban`.
- [ ] **Step 5: Commit** — `git add packages/kanban-contracts apps/kanban/src/settings && git commit -m "feat(kanban): add self_improvement_project_id setting" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 7: Kanban consumer — `CoreLifecycleStreamImprovementTaskHandler` + router extension

**Files:**

- Create: `apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.ts` (pure description/priority mapping + park error)
- Create: `apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.spec.ts`
- Create: `apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.ts`
- Create: `apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.spec.ts`
- Modify: `apps/kanban/src/core/core-integration-event.router.ts` (new event-type constant, `handles()`, `route()`, parse method, injected handler)
- Modify: `apps/kanban/src/core/core-integration-event.router.spec.ts` (if present; otherwise create) — routing cases for the new type
- Modify: `apps/kanban/src/core/core-integration.module.ts` — add `KanbanSettingsModule` to `imports` (from `../settings/kanban-settings.module`), `CoreLifecycleStreamImprovementTaskHandler` to `providers`

**Interfaces:**

- Consumes:
  - `ImprovementTaskRequestedEventEnvelopeV1Schema` / `ImprovementTaskRequestedV1` (`@nexus/core`, Task 2)
  - `KanbanSettingsService.get<string>(key, fallback)` (Task 6)
  - `WorkItemService.createWorkItem(project_id: string, input: CreateWorkItemInput): Promise<WorkItemRecord>` (`apps/kanban/src/work-item/work-item.service.ts:79`; `CreateWorkItemInput` from `@nexus/kanban-contracts` — `id?`, `title`, `description?`, `priority?` (`"p0"|"p1"|"p2"`), `status?`, `metadata?`)
  - `KanbanWorkItemRepository.findByProjectAndId(projectId, id)` (`apps/kanban/src/database/repositories/kanban-work-item.repository.ts`)
  - The consumer's existing dead-letter park path: any throw inside `CoreIntegrationEventRouter.route` is caught by `CoreLifecycleStreamConsumerService.processEntries` (`apps/kanban/src/core/core-lifecycle-stream.consumer.ts:222-234`) → `saveDeadLetter` + warn + cursor advance.
- Produces:
  - `IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE = "improvement.task.requested.v1"` (router constant beside `PR_MERGED_EVENT_TYPE`)
  - `ImprovementTaskParkedError extends Error` (helpers file)
  - `severityToPriority(severity): "p0" | "p1" | "p2"` — critical→p0, high→p1, medium/low→p2
  - `buildImprovementWorkItemDescription(payload: ImprovementTaskRequestedV1): string` — brief + suspected area + evidence (run ids, failure classes, ledger refs) + occurrence count as markdown
  - `CoreLifecycleStreamImprovementTaskHandler.handle(payload: ImprovementTaskRequestedV1): Promise<void>` — idempotent work-item filing keyed on `id = payload.proposalId`, `status: "backlog"`, `metadata.improvement = { proposalId, severity, occurrenceCount, suspectedArea, evidence }`; throws `ImprovementTaskParkedError` when `self_improvement_project_id` is unset (after logging its own warning) so the consumer's dead-letter convention records the park durably.

- [ ] **Step 1: Write the failing helpers test**

```typescript
// apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.spec.ts
import { describe, expect, it } from "vitest";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import {
  buildImprovementWorkItemDescription,
  severityToPriority,
} from "./core-lifecycle-stream-improvement-task.helpers";

const payload: ImprovementTaskRequestedV1 = {
  proposalId: "11111111-0000-4000-8000-000000000002",
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
  occurrenceCount: 3,
};

describe("severityToPriority", () => {
  it.each([
    ["critical", "p0"],
    ["high", "p1"],
    ["medium", "p2"],
    ["low", "p2"],
  ] as const)("maps %s to %s", (severity, priority) => {
    expect(severityToPriority(severity)).toBe(priority);
  });
});

describe("buildImprovementWorkItemDescription", () => {
  it("renders brief, suspected area, evidence, and occurrence count", () => {
    const description = buildImprovementWorkItemDescription(payload);
    expect(description).toContain(payload.description);
    expect(description).toContain("apps/api/src/domain-events");
    expect(description).toContain("eac4e46e-0000-4000-8000-000000000001");
    expect(description).toContain("outbox_insert_failed");
    expect(description).toContain("ledger:123");
    expect(description).toContain("Occurrences: 3");
    expect(description).toContain(payload.proposalId);
  });

  it("omits the suspected-area section when absent", () => {
    const { suspectedArea: _omitted, ...rest } = payload;
    expect(buildImprovementWorkItemDescription(rest)).not.toContain(
      "Suspected area",
    );
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test --workspace=apps/kanban -- apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.spec.ts` — expected: module not found.
- [ ] **Step 3: Minimal helpers implementation**

```typescript
// apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.ts
import type { ImprovementTaskRequestedV1 } from "@nexus/core";

/** Thrown to route an unconfigured improvement task into the consumer's dead-letter park. */
export class ImprovementTaskParkedError extends Error {}

export function severityToPriority(
  severity: ImprovementTaskRequestedV1["severity"],
): "p0" | "p1" | "p2" {
  if (severity === "critical") {
    return "p0";
  }
  if (severity === "high") {
    return "p1";
  }
  return "p2";
}

export function buildImprovementWorkItemDescription(
  payload: ImprovementTaskRequestedV1,
): string {
  const lines: string[] = [payload.description, ""];
  if (payload.suspectedArea && payload.suspectedArea.length > 0) {
    lines.push(
      "## Suspected area",
      ...payload.suspectedArea.map((area) => `- \`${area}\``),
      "",
    );
  }
  lines.push(
    "## Evidence",
    `- Run ids: ${payload.evidence.runIds.map((id) => `\`${id}\``).join(", ") || "none"}`,
    `- Failure classes: ${payload.evidence.failureClasses.join(", ") || "none"}`,
    `- Ledger refs: ${payload.evidence.ledgerRefs.join(", ") || "none"}`,
    "",
    `Occurrences: ${payload.occurrenceCount}`,
    `Source improvement proposal: ${payload.proposalId}`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run helpers to green**, then **write the failing handler test**

```typescript
// apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.spec.ts
import { describe, expect, it, vi } from "vitest";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import { CoreLifecycleStreamImprovementTaskHandler } from "./core-lifecycle-stream-improvement-task.handler";
import { ImprovementTaskParkedError } from "./core-lifecycle-stream-improvement-task.helpers";

const payload: ImprovementTaskRequestedV1 = {
  proposalId: "11111111-0000-4000-8000-000000000002",
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  evidence: {
    runIds: ["run-1"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: [],
  },
  severity: "critical",
  occurrenceCount: 2,
};

function buildHandler(options: { projectId: string; existing?: unknown }) {
  const settings = { get: vi.fn().mockResolvedValue(options.projectId) };
  const workItems = {
    findByProjectAndId: vi.fn().mockResolvedValue(options.existing ?? null),
  };
  const workItemService = {
    createWorkItem: vi.fn().mockResolvedValue({ id: payload.proposalId }),
  };
  const handler = new CoreLifecycleStreamImprovementTaskHandler(
    settings as never,
    workItemService as never,
    workItems as never,
  );
  return { handler, settings, workItems, workItemService };
}

describe("CoreLifecycleStreamImprovementTaskHandler", () => {
  it("creates a work item on the configured project mapped from the brief", async () => {
    const { handler, workItemService } = buildHandler({ projectId: "proj-1" });

    await handler.handle(payload);

    expect(workItemService.createWorkItem).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        id: payload.proposalId,
        title: payload.title,
        priority: "p0",
        status: "backlog",
        metadata: {
          improvement: expect.objectContaining({
            proposalId: payload.proposalId,
            severity: "critical",
            occurrenceCount: 2,
          }),
        },
      }),
    );
    const input = workItemService.createWorkItem.mock.calls[0][1];
    expect(input.description).toContain("outbox_insert_failed");
  });

  it("parks with ImprovementTaskParkedError when no project is configured", async () => {
    const { handler, workItemService } = buildHandler({ projectId: "" });

    await expect(handler.handle(payload)).rejects.toBeInstanceOf(
      ImprovementTaskParkedError,
    );
    expect(workItemService.createWorkItem).not.toHaveBeenCalled();
  });

  it("skips filing when a work item for the proposal already exists", async () => {
    const { handler, workItemService } = buildHandler({
      projectId: "proj-1",
      existing: { id: payload.proposalId },
    });

    await handler.handle(payload);

    expect(workItemService.createWorkItem).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run and confirm failure**, then **implement the handler**

```typescript
// apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.ts
import { Injectable, Logger } from "@nestjs/common";
import type { ImprovementTaskRequestedV1 } from "@nexus/core";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { KanbanSettingsService } from "../settings/kanban-settings.service";
import { WorkItemService } from "../work-item/work-item.service";
import {
  buildImprovementWorkItemDescription,
  ImprovementTaskParkedError,
  severityToPriority,
} from "./core-lifecycle-stream-improvement-task.helpers";

const SELF_IMPROVEMENT_PROJECT_SETTING = "self_improvement_project_id";
const BACKLOG = "backlog";

/**
 * Files a core improvement.task.requested brief as a work item on the
 * configured self-improvement project. Idempotent: the work-item id IS the
 * proposal id, so redelivery never files twice. When no project is
 * configured the event is parked — warning here plus the consumer's
 * dead-letter record — never a silent drop.
 */
@Injectable()
export class CoreLifecycleStreamImprovementTaskHandler {
  private readonly logger = new Logger(
    CoreLifecycleStreamImprovementTaskHandler.name,
  );

  constructor(
    private readonly settings: KanbanSettingsService,
    private readonly workItemService: WorkItemService,
    private readonly workItems: KanbanWorkItemRepository,
  ) {}

  async handle(payload: ImprovementTaskRequestedV1): Promise<void> {
    const projectId = await this.settings.get<string>(
      SELF_IMPROVEMENT_PROJECT_SETTING,
      "",
    );
    if (!projectId) {
      this.logger.warn(
        `improvement.task.requested ${payload.proposalId} parked: ${SELF_IMPROVEMENT_PROJECT_SETTING} is not configured (see docs/operations/self-improvement-project.md)`,
      );
      throw new ImprovementTaskParkedError(
        `${SELF_IMPROVEMENT_PROJECT_SETTING} not configured`,
      );
    }

    const existing = await this.workItems.findByProjectAndId(
      projectId,
      payload.proposalId,
    );
    if (existing) {
      this.logger.log(
        `improvement task ${payload.proposalId} already filed on project ${projectId}; skipping`,
      );
      return;
    }

    await this.workItemService.createWorkItem(projectId, {
      id: payload.proposalId,
      title: payload.title,
      description: buildImprovementWorkItemDescription(payload),
      priority: severityToPriority(payload.severity),
      status: BACKLOG,
      metadata: {
        improvement: {
          proposalId: payload.proposalId,
          severity: payload.severity,
          occurrenceCount: payload.occurrenceCount,
          suspectedArea: payload.suspectedArea ?? [],
          evidence: payload.evidence,
        },
      },
    });
    this.logger.log(
      `Filed improvement work item ${payload.proposalId} on project ${projectId} (severity ${payload.severity}, occurrences ${payload.occurrenceCount})`,
    );
  }
}
```

- [ ] **Step 6: Extend the router (failing test first)** — add to `core-integration-event.router.spec.ts` (create the file with this shape if absent, mirroring the handler-spec mock style):

```typescript
// added cases in apps/kanban/src/core/core-integration-event.router.spec.ts
import { describe, expect, it, vi } from "vitest";
import { CoreIntegrationEventRouter } from "./core-integration-event.router";

function buildRouter() {
  const prMergedHandler = { handle: vi.fn() };
  const prStatusHandler = { handle: vi.fn() };
  const improvementTaskHandler = { handle: vi.fn() };
  const router = new CoreIntegrationEventRouter(
    prMergedHandler as never,
    prStatusHandler as never,
    improvementTaskHandler as never,
  );
  return { router, improvementTaskHandler };
}

const envelopeJson = JSON.stringify({
  event_id: "0f0e0d0c-0000-4000-8000-000000000001",
  event_type: "improvement.task.requested.v1",
  event_version: "v1",
  occurred_at: "2026-07-02T12:00:00.000Z",
  correlation_id: "11111111-0000-4000-8000-000000000002",
  source_service: "core",
  payload: {
    proposalId: "11111111-0000-4000-8000-000000000002",
    title: "Fix NUL-byte handling in outbox insert",
    description: "NUL bytes abort the outbox INSERT.",
    evidence: { runIds: [], failureClasses: [], ledgerRefs: [] },
    severity: "high",
    occurrenceCount: 1,
  },
});

describe("CoreIntegrationEventRouter — improvement.task.requested.v1", () => {
  it("handles the improvement task event type", () => {
    expect(buildRouter().router.handles("improvement.task.requested.v1")).toBe(
      true,
    );
  });

  it("routes the parsed payload to the improvement task handler", async () => {
    const { router, improvementTaskHandler } = buildRouter();
    await router.route("improvement.task.requested.v1", envelopeJson);
    expect(improvementTaskHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "11111111-0000-4000-8000-000000000002",
      }),
    );
  });

  it("throws on a missing envelope so the consumer dead-letters it", async () => {
    const { router } = buildRouter();
    await expect(
      router.route("improvement.task.requested.v1", undefined),
    ).rejects.toThrow("Malformed improvement task event: missing envelope");
  });
});
```

Then implement in `core-integration-event.router.ts`: add `export const IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE = "improvement.task.requested.v1";`, inject `improvementTaskHandler: CoreLifecycleStreamImprovementTaskHandler` as the third constructor param, extend `handles()` with `|| eventType === IMPROVEMENT_TASK_REQUESTED_EVENT_TYPE`, add the `route()` branch calling `this.improvementTaskHandler.handle(this.parseImprovementTask(envelopeJson))`, and add:

```typescript
  private parseImprovementTask(value: string | undefined) {
    if (!value) {
      throw new Error("Malformed improvement task event: missing envelope");
    }
    return ImprovementTaskRequestedEventEnvelopeV1Schema.parse(
      JSON.parse(value),
    ).payload;
  }
```

(import `ImprovementTaskRequestedEventEnvelopeV1Schema` from `@nexus/core`). Register `CoreLifecycleStreamImprovementTaskHandler` in `core-integration.module.ts` providers and add `KanbanSettingsModule` to its imports.

- [ ] **Step 7: Run to green** — `npm run test --workspace=apps/kanban -- apps/kanban/src/core/core-lifecycle-stream-improvement-task.helpers.spec.ts apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.spec.ts apps/kanban/src/core/core-integration-event.router.spec.ts apps/kanban/src/core/core-lifecycle-stream.consumer.spec.ts` (consumer spec guards the DI param-order assertion and the dead-letter path), then `npm run build:kanban` and `npm run lint:kanban`.
- [ ] **Step 8: Commit** — `git add apps/kanban/src/core && git commit -m "feat(kanban): file improvement.task.requested briefs as self-improvement work items" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 8: Web UI — `code_change` detail rendering in the improvements queue

**Files:**

- Create: `apps/web/src/pages/improvements/ImprovementCodeChangeDetail.tsx`
- Create: `apps/web/src/pages/improvements/ImprovementCodeChangeDetail.spec.tsx`
- Modify: Epic A's improvements queue page — the per-kind detail switch that already renders YAML/field/skill detail for the other kinds (locate with `grep -rn "kind" apps/web/src/pages/improvements/`; if Epic A placed the queue elsewhere, `grep -rln "improvement" apps/web/src`). Add the `code_change` branch rendering `<ImprovementCodeChangeDetail payload={...} occurrenceCount={proposal.occurrence_count} />`. Colocate the new component beside Epic A's other per-kind renderers if they live in a different directory.

**Interfaces:**

- Consumes: `CodeChangeProposalPayload` + `CodeChangeProposalPayloadSchema` (from `@nexus/core` — already a web dependency), `Badge` from `@/components/ui/badge` (existing UI kit, same as `LearningTabProposalsCard.tsx`).
- Produces: `ImprovementCodeChangeDetail({ payload, occurrenceCount }: Readonly<{ payload: CodeChangeProposalPayload; occurrenceCount: number }>)` — presentation-only component (web quality gate: no side effects, no fetching) showing title + severity badge, occurrence-count badge when > 1, description, suspected area, and linked-run evidence (run ids, failure classes, ledger refs).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/improvements/ImprovementCodeChangeDetail.spec.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CodeChangeProposalPayload } from "@nexus/core";
import { ImprovementCodeChangeDetail } from "./ImprovementCodeChangeDetail";

const payload: CodeChangeProposalPayload = {
  title: "Fix NUL-byte handling in outbox insert",
  description: "NUL bytes abort the outbox INSERT and wedge the run.",
  suspectedArea: ["apps/api/src/domain-events"],
  evidence: {
    runIds: ["eac4e46e-0000-4000-8000-000000000001"],
    failureClasses: ["outbox_insert_failed"],
    ledgerRefs: ["ledger:123"],
  },
  severity: "high",
};

describe("ImprovementCodeChangeDetail", () => {
  it("renders the brief with severity and evidence", () => {
    render(
      <ImprovementCodeChangeDetail payload={payload} occurrenceCount={3} />,
    );

    expect(
      screen.getByText("Fix NUL-byte handling in outbox insert"),
    ).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("seen 3×")).toBeInTheDocument();
    expect(
      screen.getByText("eac4e46e-0000-4000-8000-000000000001"),
    ).toBeInTheDocument();
    expect(screen.getByText("outbox_insert_failed")).toBeInTheDocument();
    expect(screen.getByText("apps/api/src/domain-events")).toBeInTheDocument();
  });

  it("hides the occurrence badge for first occurrences and omits absent sections", () => {
    const { suspectedArea: _omitted, ...rest } = payload;
    render(<ImprovementCodeChangeDetail payload={rest} occurrenceCount={1} />);

    expect(screen.queryByText(/seen/)).not.toBeInTheDocument();
    expect(screen.queryByText("Suspected area")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm failure** — `npm run test:unit --workspace=apps/web -- apps/web/src/pages/improvements/ImprovementCodeChangeDetail.spec.tsx` — expected: module not found.
- [ ] **Step 3: Minimal implementation**

```tsx
// apps/web/src/pages/improvements/ImprovementCodeChangeDetail.tsx
import { Badge } from "@/components/ui/badge";
import type { CodeChangeProposalPayload } from "@nexus/core";

const SEVERITY_BADGE_VARIANT: Record<
  CodeChangeProposalPayload["severity"],
  "outline" | "secondary" | "default" | "destructive"
> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

interface ImprovementCodeChangeDetailProps {
  payload: CodeChangeProposalPayload;
  occurrenceCount: number;
}

/** Read-only detail body for a code_change improvement proposal. */
export function ImprovementCodeChangeDetail({
  payload,
  occurrenceCount,
}: Readonly<ImprovementCodeChangeDetailProps>) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{payload.title}</h3>
        <Badge variant={SEVERITY_BADGE_VARIANT[payload.severity]}>
          {payload.severity}
        </Badge>
        {occurrenceCount > 1 ? (
          <Badge variant="outline">{`seen ${occurrenceCount}×`}</Badge>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
        {payload.description}
      </p>
      {payload.suspectedArea && payload.suspectedArea.length > 0 ? (
        <section className="space-y-1">
          <h4 className="text-xs font-medium uppercase text-muted-foreground">
            Suspected area
          </h4>
          <ul className="space-y-0.5">
            {payload.suspectedArea.map((area) => (
              <li key={area}>
                <code className="text-xs">{area}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="space-y-1">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">
          Evidence
        </h4>
        <ul className="space-y-0.5 text-xs">
          {payload.evidence.runIds.map((runId) => (
            <li key={runId}>
              Run: <code>{runId}</code>
            </li>
          ))}
          {payload.evidence.failureClasses.map((failureClass) => (
            <li key={failureClass}>
              Failure class: <code>{failureClass}</code>
            </li>
          ))}
          {payload.evidence.ledgerRefs.map((ref) => (
            <li key={ref}>
              Ledger: <code>{ref}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Register in the queue page** — add the `code_change` case to Epic A's per-kind detail switch, passing `proposal.payload` (parse with `CodeChangeProposalPayloadSchema.safeParse` at the switch boundary if Epic A types payloads as `unknown` — render Epic A's existing fallback/raw view on parse failure) and `proposal.occurrence_count`. Also surface the occurrence count in the queue's list row if Epic A's columns don't already show it (a `seen N×` badge next to the kind chip, only when `> 1`).
- [ ] **Step 5: Run to green** — `npm run test:unit --workspace=apps/web -- apps/web/src/pages/improvements/ImprovementCodeChangeDetail.spec.tsx`, then `npm run lint:web`.
- [ ] **Step 6: Commit** — `git add apps/web/src/pages/improvements && git commit -m "feat(web): render code_change proposal detail with evidence and occurrence count" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 9: DELETE `apps/repair-agent` entirely

No deprecation stubs, no flags, no re-exports. Every current (living) reference is enumerated below from a full repo sweep (`repair-agent`, `repair_agent`, `repairAgent`, `RepairAgent`, `8765`, telemetry wiring). Root `package.json` workspaces are globs (`apps/*`) — there is **no explicit workspace entry or root script to remove**; deleting the directory drops the workspace. No Makefile, turbo.json, root tsconfig/eslint/vitest, or `.github` reference exists. Nothing else in compose `depends_on` the service. Do **not** touch the unrelated in-process workflow-repair/doctor system (`WorkflowRepairModule`, `apps/web` Doctor pages, `packages/e2e-tests/src/scenarios/repair-paths.e2e-spec.ts`, `doctor-requests.schema.ts`, `runtime-feedback.schema.ts`) or coincidental `"repair-agent"` agent-profile fixture strings in `apps/api`/`packages/core` specs (`memory-tools.handler.spec.ts`, `workflow-runtime-lifecycle.controller.spec.ts`, `record-learning.service.spec.ts`, `query-memory-response.schema.spec.ts`).

**Files (delete whole):**

- `apps/repair-agent/` — entire directory (~26 source files + tests + `Dockerfile`, `package.json` `@nexus/repair-agent`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.env.example`, `README.md`, `dist/`, `.turbo/`)
- `apps/api/src/telemetry/telemetry-gateway-repair.helpers.ts` — repair-only helper (`broadcastWorkflowRepairEvent` → `server.to('repair')`); **zero callers repo-wide besides the gateway method below**; no spec file exists for it
- `docs/architecture/repair-agent.md` — dedicated architecture doc
- `docs/guide/29-repair-agent.md` — dedicated guide chapter

**Files (edit — every line):**

- `apps/api/src/telemetry/telemetry.gateway.ts` — line 52 (`import { broadcastWorkflowRepairEvent } from './telemetry-gateway-repair.helpers';`), lines 497–499 (method `broadcastRepairEvent(payload: WorkflowRunEvent)` — it has **no callers anywhere**; the feed is already inert)
- `apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.ts` — line 8 role union `'agent' | 'ui' | 'repair'` → drop `'repair'`; lines 31–34 (`if (client.role === 'repair') { await client.join('repair'); return; }`) → delete branch
- `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts` — lines 63–67 role cast union → drop `'repair'`
- `apps/api/src/telemetry/types.ts` — line 43 `role?: 'agent' | 'ui' | 'repair';` → drop `'repair'` (existing specs `telemetry-gateway-post-auth.helpers.spec.ts` / `telemetry-gateway-connection.helpers.spec.ts` contain no `'repair'` assertions — no test edits expected)
- `docker-compose.yaml` — lines 196–251: the entire `repair-agent:` service block (build/dockerfile `apps/repair-agent/Dockerfile`, container `nexus-repair-agent`, profile `repair-agent`, env incl. `TELEMETRY_URL=ws://api:3001/api/telemetry/ws`, ports `"${REPAIR_AGENT_HOST_PORT:-8765}:8765"`, docker.sock + workspace volumes, healthcheck, `depends_on: api/postgres`)
- `.env.example` — lines 82–97: the whole `# Repair Agent (profile: repair-agent)` block (`REPAIR_AGENT_HOST_PORT`, `REPAIR_AGENT_CONTAINER_NAME`, `REPAIR_AGENT_PORT`, `REPAIR_MAX_WORKERS`, `REPAIR_TIMEOUT_MS`, and the commented `GIT_USER`/`GIT_EMAIL`/`GIT_REMOTE`/`GIT_BRANCH` lines — verified unused by compose and apps/api)
- `README.md` — line 54 (structure list entry), line 118 (`| Repair Agent | http://localhost:8765 |` table row), line 134 (`npm run start:dev --workspace=apps/repair-agent`), line 222 (link to `docs/architecture/repair-agent.md`)
- `AGENTS.md` (symlinked as `CLAUDE.md`) — line 10 (monorepo-structure table `repair-agent/` row), line 38 (`npm run build --workspace=apps/repair-agent`), line 47 (`npm run start:dev --workspace=apps/repair-agent`), line 99 (`| Repair Agent HTTP | 8765 |` service-ports row)
- `docs/architecture/README.md` — line 65 (index entry for repair-agent.md)
- `docs/architecture/failure-classification-repair.md` — lines 22, 102, 115 (references to `apps/repair-agent` / its Socket.IO stream; reword to note the standalone agent was removed and code-change repair flows through the improvement pipeline)
- `docs/guide/README.md` — line 390 (guide index entry for chapter 29)
- `docs/guide/33-port-map.md` — line 20 (8765 row), lines 538/544 (repair-agent section + `REPAIR_AGENT_PORT`)
- `docs/guide/01-system-overview.md` — lines 39, 70 (port table row), 102
- `docs/guide/02-getting-started.md` — lines 48, 94
- `docs/guide/03-container-architecture.md` — lines 27, 59–60 (Mermaid `Rel(repair_agent, ...)` edges), 121, 127 (`Port: 8765`), 204
- `docs/guide/10-workflow-repair.md` — line 3 (delegation mention)
- `docs/guide/19-security.md` — line 516 (Mermaid `REPAIR[...:8765]` node)
- `docs/guide/26-web-overview.md` — line 404
- `docs/guide/28-pi-runner.md` — line 387
- `docs/guide/31-packages.md` — lines 22, 331
- `docs/guide/34-glossary.md` — line 403 (glossary entry)
- `docs/guide/43-repair-diagnostics-operator-guide.md` — lines 19, 258
- `docs/operations/README.md` — line 38 (link to guide 29)
- `docs/SDD.md` — lines 626, 726 (service-port tables)
- `docs/project-context/ARCHITECTURE.md` — lines 1030, 1154 (`| Repair Agent HTTP | 8765 |`), 1207

**Intentionally untouched (historical records):** `docs/plans/2026-05-06-repair-agent-{plan,design}.md` and other passing plan mentions, `docs/analysis/*`, `docs/project-context/{CAPABILITY_MAP,CODEBASE_HEALTH,INVESTIGATION_SUMMARY,OPEN_QUESTIONS}.md`, `docs/project-context/probe-results/*`, `docs/epics/EPIC-164*`, `docs/work*/`, `docs/work-items-backup-*/`, `docs/superpowers/plans/2026-06-09*/2026-06-10*`, `.rpiv/`, `.beads/`, and this plan's own spec (`docs/superpowers/specs/2026-07-02-self-improvement-pipeline-design.md`). Git worktree copies under `.worktrees/` / `.claude/worktrees/` belong to other branches — out of scope.

**Interfaces:**

- Consumes: nothing.
- Produces: removal only. The `TelemetryGateway`, `telemetry.module.ts`, and all `ui`/`agent` rooms **must stay** — they serve `apps/web` hooks (`useWorkflowRunTelemetry.ts`, `useSessionTelemetry.ts`, `useChatSessionTelemetry.ts`, `useWorkflowSubagentExecutions.ts`) and the harness runtime. Only the `'repair'` role/room path goes.

- [ ] **Step 1: Remove API-side repair telemetry wiring** — delete `apps/api/src/telemetry/telemetry-gateway-repair.helpers.ts`; apply the four `apps/api/src/telemetry/` edits above.
- [ ] **Step 2: Verify API still builds and telemetry specs pass** — `npm run build:api && npm run test --workspace=apps/api -- apps/api/src/telemetry/telemetry-gateway-post-auth.helpers.spec.ts apps/api/src/telemetry/telemetry-gateway-connection.helpers.spec.ts apps/api/src/telemetry/telemetry-gateway.helpers.spec.ts`
- [ ] **Step 3: Delete the app** — `git rm -r apps/repair-agent`
- [ ] **Step 4: Edit compose + env** — remove `docker-compose.yaml:196-251` and `.env.example:82-97`; validate: `docker compose config -q` (must exit 0) and `docker compose config --services` (must not list `repair-agent`).
- [ ] **Step 5: Update living docs** — apply every README/AGENTS.md/docs edit enumerated above (delete the two dedicated files; remove rows/lines/Mermaid edges elsewhere; reword `failure-classification-repair.md` and `10-workflow-repair.md` mentions to reflect that code-change repair now flows through the improvement pipeline → work-item pipeline).
- [ ] **Step 6: Regenerate the lockfile** — `npm install` (removes `apps/repair-agent` + `node_modules/@nexus/repair-agent` entries from `package-lock.json`, currently at lines ~203 and ~5976).
- [ ] **Step 7: Prove zero references remain** — all of the following must return no output:
  - `grep -rniE "repair[-_]agent" package.json package-lock.json docker-compose.yaml .env.example Makefile README.md AGENTS.md apps/api/src apps/kanban/src apps/web/src packages/*/src docs/guide docs/operations docs/architecture/README.md`
  - `grep -rn "8765" docker-compose.yaml .env.example README.md AGENTS.md docs/guide docs/SDD.md docs/project-context/ARCHITECTURE.md`
  - `grep -rn "broadcastRepairEvent\|broadcastWorkflowRepairEvent\|'repair'" apps/api/src/telemetry`
  - `test ! -d apps/repair-agent && echo GONE`
- [ ] **Step 8: Full verification** — `npm run build --workspace=packages/core && npm run build:api && npm run build:kanban && npm run build:web && npm run test:api`
- [ ] **Step 9: Commit** — `git add -A && git commit -m "chore!: delete apps/repair-agent and its inert telemetry feed" -m "The standalone repair agent was unused, non-functional, and ungoverned; code-change repair now flows through the governed improvement-proposal -> work-item pipeline (see docs/superpowers/specs/2026-07-02-self-improvement-pipeline-design.md §4.5). Removes the compose service (port 8765), env block, repair telemetry room, and all living doc references." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 10: Onboarding runbook — configuring the self-improvement project

**Files:**

- Create: `docs/operations/self-improvement-project.md`
- Modify: `docs/operations/README.md` — add an index entry linking the new runbook (in the section where line 38's repair-agent link was removed by Task 9)

**Interfaces:** documentation only.

- [ ] **Step 1: Write the runbook** covering, in order:
  1. **What it is** — the `code_change` bridge: approved (or auto-applied in `autonomous` mode) `code_change` proposals publish `improvement.task.requested.v1` onto `stream:core:lifecycle`; the Kanban consumer files them as work items that ride the normal dispatch → implement → quality-gate → auto-merge pipeline.
  2. **Create the project** — a normal Kanban project whose repository is the Nexus Orchestrator repo itself, via the existing repo-import flow (import the orchestrator repo's git URL, same as any external repo). Not seeded — deliberately an explicit operator decision.
  3. **Set the setting** — `self_improvement_project_id` = the new project's id, via the Kanban settings UI or `PATCH` on the existing Kanban settings endpoint (`UpdateKanbanSettingRequestSchema`: `{ "value": "<project-uuid>" }`). Default is empty = filing disabled.
  4. **Unconfigured behavior (parking)** — events are never silently dropped: the API-side proposal completes as `applied` (publish succeeded; delivery is asynchronous and the API stays Kanban-neutral, so it does not track routing), while the Kanban consumer logs a warning and records a dead-letter row (`kanban-core-lifecycle-dead-letter`, visible via the consumer's diagnostics `deadLetterCount`). After configuring the project, parked events can be re-driven by re-approving the proposal or replaying the dead-letter payload.
  5. **Dedup behavior** — recurring briefs bump `occurrence_count` on the existing proposal instead of filing again; when the embedding provider is unconfigured, dedup degrades to lexical similarity plus exact normalized-title matching (note: weaker recall — near-duplicate wordings may slip through).
  6. **Verification** — approve a test `code_change` proposal, then `docker exec` into Redis (`redis-cli -p 6379 XREVRANGE stream:core:lifecycle + - COUNT 5` inside the container; host port 6380) to see the event, and confirm the work item appears on the project board with `metadata.improvement.proposalId` set.
- [ ] **Step 2: Cross-link** — verify the runbook is linked from `docs/operations/README.md` and referenced from the setting description (Task 6) and park warnings (Task 7) — those already cite `docs/operations/self-improvement-project.md`.
- [ ] **Step 3: Commit** — `git add docs/operations && git commit -m "docs(operations): self-improvement project onboarding runbook" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`

---

### Task 11: E2E note + full-suite verification and docs sweep

**Files:**

- Optional create: `packages/e2e-tests/src/scenarios/improvement-code-change.e2e-spec.ts`
- Modify: `docs/guide/README.md` / the improvement-pipeline guide page Epic A introduced — add the `code_change` bridge to the kinds table and link the runbook (if Epic A's guide page does not exist, add the bridge summary to `docs/guide/35-memory-learning.md`'s improvement section instead).

**Interfaces:** verification only.

- [ ] **Step 1: E2E decision (per spec §6 "one flow per epic")** — `packages/e2e-tests` scenarios (`src/scenarios/*.e2e-spec.ts`, run via `npm run test:e2e`) are black-box tests against the **live docker-compose stack** (they use `pg`, Redis, and real service ports). The Epic E flow test is therefore **live-stack-only: mark it optional/manual**. If written, `improvement-code-change.e2e-spec.ts` should: set `self_improvement_project_id` via the Kanban settings API → `XADD` a valid `improvement.task.requested.v1` entry to `stream:core:lifecycle` (fields `event_id`, `event_type`, `occurred_at`, `envelope`) → poll the Kanban work-items API until the work item with `id = proposalId` appears (mirror the polling helpers in `src/scenarios/kanban-lifecycle.e2e-spec.ts`). Otherwise the runbook's manual verification steps (Task 10, step 1.6) stand in for it — record which option was taken in the PR description.
- [ ] **Step 2: Full builds** — `npm run build --workspace=packages/core && npm run build --workspace=packages/kanban-contracts && npm run build:api && npm run build:kanban && npm run build:web`
- [ ] **Step 3: Full test suites** — `npm run test:api && npm run test:kanban && npm run test:unit:web && npm run test --workspace=packages/core && npm run test --workspace=packages/kanban-contracts`
- [ ] **Step 4: Repo-wide lint** — `npm run lint:summary` — zero new findings; boundary rule `nexus-boundaries/no-core-kanban-residue` green.
- [ ] **Step 5: Docs sweep** — confirm `docs/guide` improvement/learning page mentions the bridge; confirm AGENTS.md/README no longer mention repair-agent (Task 9) and nothing new references it; confirm the runbook link resolves.
- [ ] **Step 6: Final commit** — `git add -A && git commit -m "docs(guide): document the code_change improvement bridge; epic E verification green" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`
