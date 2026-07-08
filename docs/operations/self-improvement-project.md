# Self-Improvement Project Runbook

## Scope

Operational runbook for the self-improvement code-change bridge: how approved
`code_change` improvement proposals turn into Kanban work items, how to
configure the destination project, and how to recover events that were parked
because no project was configured yet. Use this when onboarding the
self-improvement pipeline for the first time, or when the Kanban logs show
`improvement.task.requested ... parked: self_improvement_project_id is not
configured`.

## What it does

`code_change` is one of the improvement-proposal kinds produced by the
retrospective/governance pipeline (`apps/api/src/improvement/`). When a
`code_change` proposal is approved (or auto-applied — see
[Governance posture](#governance-posture-propose-vs-auto_apply) below), its
applier (`CodeChangeApplier`,
`apps/api/src/improvement/appliers/code-change.applier.ts`) publishes a
neutral `improvement.task.requested.v1` event onto the shared Redis stream
`stream:core:lifecycle`. The API stays Kanban-neutral here: a successful
`apply()` only means the event was published — it does not know or track
whether anything downstream consumes it.

On the Kanban side, `CoreLifecycleStreamConsumerService` polls that stream
(every 5s, consumer name `core-lifecycle-projection`) and routes
`improvement.task.requested.v1` entries to
`CoreLifecycleStreamImprovementTaskHandler`
(`apps/kanban/src/core/core-lifecycle-stream-improvement-task.handler.ts`).
When a destination project is configured, the handler files the brief as a
work item on that project's backlog, and the work item rides the normal
dispatch → implement → quality-gate → auto-merge pipeline like any other work
item. The work-item **id is the proposal id**, so redelivery of the same event
(e.g. after a replay) never files a duplicate — the handler checks for an
existing work item first and logs-and-returns if one is already there.

## Create the project

The self-improvement project is a normal Kanban project — there is no special
project type. It is **not seeded**; creating it is a deliberate operator
decision, made once, before the setting is turned on.

Create it the same way you'd import any external repository, pointed at the
Nexus Orchestrator repo itself:

```
POST /api/projects
{
  "sourceType": "import_remote",
  "repositoryUrl": "<the orchestrator repo's git URL>",
  ...
}
```

See [`docs/guides/github-private-repository-import-and-orchestration.md`](../guides/github-private-repository-import-and-orchestration.md)
for the full import flow (GitHub PAT secret setup, `basePath` vs managed-clone
mode, orchestration start). The same flow is exposed in the web UI as
"Import Repository" on the projects list. Any project naming convention is
fine — there's no naming contract the consumer depends on, only the project
id.

Because this project's repository is the orchestrator's own source tree, the
usual merge gates (build/lint/test, quality gate, auto-merge) apply to
self-improvement work items exactly as they do to any other work item — a
filed improvement brief cannot land without passing them.

## Configure the setting

Set the Kanban setting `self_improvement_project_id` to the new project's id.
Default is empty (`""`), which disables filing entirely (events park — see
below).

Via the Kanban settings API:

```
PUT /api/kanban-settings/self_improvement_project_id
{
  "value": "<project-uuid>"
}
```

(`UpdateKanbanSettingRequestSchema` in `packages/kanban-contracts`: `value` is
the only required field.) The same setting is editable from the Kanban
settings UI, grouped under "orchestration" alongside
`orchestration_wake_policy`. Definition and default live in
`apps/kanban/src/settings/kanban-settings.constants.ts`.

## Unconfigured behavior (parking)

If `self_improvement_project_id` is unset when an `improvement.task.requested.v1`
event arrives, `CoreLifecycleStreamImprovementTaskHandler` does not silently
drop it:

1. It logs a warning: `improvement.task.requested <proposalId> parked:
self_improvement_project_id is not configured (see
docs/operations/self-improvement-project.md)`.
2. It throws, which the consumer's per-entry `try/catch` catches. The consumer
   writes a dead-letter row to `kanban_core_lifecycle_dead_letters`
   (`stream_key`, `stream_id`, `reason`, and the raw stream `payload` —
   `event_type` + the full JSON `envelope`), and logs `Dead-lettered core
lifecycle stream entry <streamId>: ...`.
3. The stream cursor still advances past the entry (`saveCursor` runs
   unconditionally after the try/catch), so a parked event does not stall
   processing of subsequent stream entries.
4. `deadLetterCount` (from `countRecent()`) is visible via
   `GET /internal/core/lifecycle-stream/health`
   (`apps/kanban/src/core/core-events.controller.ts`) — an internal-service-scoped
   endpoint (`InternalServiceAuthGuard`, scope `kanban.core-events:read`), not a
   normal admin-JWT route. For ad-hoc operator checks, query
   `kanban_core_lifecycle_dead_letters` directly (see below) instead.

**The proposal itself is not affected.** The API-side proposal already
completed as `applied` at publish time (delivery is asynchronous and the API
is Kanban-neutral by design, so it never learns whether routing succeeded).
There is nothing to re-approve on the API side for an already-applied
proposal — `approve()` only transitions proposals out of `pending`, and
`code_change` has no `rollback` support, so once a proposal is `applied` it
stays `applied` regardless of what happened downstream.

### Replaying parked events

Kanban's cursor-forward endpoint (`POST
/internal/core/lifecycle-stream/replay`,
`CoreLifecycleStreamConsumerService.replayFromCursor`) only re-reads stream
entries **after** the consumer's saved cursor — and the cursor already
advanced past a dead-lettered entry when it was parked (the consumer always
calls `saveCursor` after the try/catch, success or failure). So that endpoint
cannot re-drive an entry that is already in
`kanban_core_lifecycle_dead_letters`.

For that, use the dedicated dead-letter replay endpoint instead:

```
POST /internal/core/lifecycle-stream/dead-letters/replay
```

- **Scope:** internal-service-scoped, same as the cursor-forward endpoint
  (`InternalServiceAuthGuard`, scope `kanban.core-events:write`) — not a
  normal admin-JWT route.
- **Request body** (optional): `{ "proposalIds"?: string[] }`. An empty or
  absent body replays **every** parked dead-letter row for
  `stream:core:lifecycle`; supplying `proposalIds` scopes the replay to just
  those proposals (matched against the `proposalId` embedded in each row's
  stored envelope).
- **Response:** `{ "success": true, "data": { "replayed": number, "skipped":
number, "remaining": number } }`.
  - `replayed` — rows whose event was successfully re-published onto the
    stream.
  - `skipped` — rows not re-published this call: filtered out by
    `proposalIds`, or whose re-publish threw (left untouched, not on the
    stream; logged as a warning — one bad row never aborts the rest).
  - `remaining` — dead-letter rows **still parked after** the call. **A
    non-zero `remaining` means the backlog was not fully cleared** — re-run
    (or investigate) until it reaches zero. Expected to be non-zero when you
    passed a `proposalIds` filter (the non-matching rows are left behind) or
    when a row could not be deleted after its event was re-published (see
    below).
- **Drains in batches:** the endpoint reads parked rows in bounded batches
  (repo default page size) and loops until a batch clears nothing, so a
  single "replay all" call drains an arbitrarily large backlog rather than
  silently stopping at the first page. Each distinct row's event is published
  **at most once per call**, and the loop is guaranteed to terminate (it stops
  as soon as a batch deletes no rows). With a `proposalIds` filter, only
  matching rows found within the fetched batches are replayed; if the matching
  rows sit beyond a page full of non-matching rows, they may be left as
  `remaining` — replay again (or without the filter) to reach them.
- **Mechanics:** for each targeted row, the endpoint re-`XADD`s the row's
  stored `payload` fields (`event_id`, `event_type`, `occurred_at`,
  `envelope`, etc.) back onto `stream:core:lifecycle` verbatim, then deletes
  the dead-letter row **only after** the re-publish succeeds. Publish and
  delete are handled separately: a publish failure counts as `skipped` and
  leaves the row untouched; a publish success counts as `replayed` even if the
  subsequent row delete fails (that only logs a distinct
  `Replayed dead letter <id> but failed to clear the dead-letter row` warning
  and leaves the row as `remaining` — safe, because downstream is idempotent
  by proposal id). It never touches the forward cursor
  (`kanban_core_lifecycle_cursors`) — replay and cursor advancement are
  independent.
- **Idempotent by proposal id:** the re-emitted event flows back through the
  consumer's normal poll like any other stream entry. If
  `self_improvement_project_id` is now configured, the handler files the
  work item (id = proposal id) — redelivery after it's already filed is a
  no-op (`already filed on project ... ; skipping`). If it's still
  unconfigured, the event simply gets dead-lettered (re-parked) again with a
  fresh row — safe to call more than once.

Example, after configuring `self_improvement_project_id`, replaying every
parked row:

```bash
curl -X POST http://<kanban-host>:3012/internal/core/lifecycle-stream/dead-letters/replay \
  -H "Authorization: Bearer <internal-service-token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Or scoped to one proposal:

```bash
curl -X POST http://<kanban-host>:3012/internal/core/lifecycle-stream/dead-letters/replay \
  -H "Authorization: Bearer <internal-service-token>" \
  -H "Content-Type: application/json" \
  -d '{"proposalIds": ["<proposal-id>"]}'
```

Confirm the work item appears on the configured project's board with
`metadata.improvement.proposalId` set to the proposal id (see
[Verification](#verification)).

#### Manual fallback (redis-cli)

If the replay endpoint is unreachable (e.g. the internal-service token isn't
configured, or Kanban itself is down), fall back to replaying by hand:

1. Query the dead-letter table for the parked entry (filter on
   `reason` containing `self_improvement_project_id is not configured` and
   `payload->>'event_type' = 'improvement.task.requested.v1'`):

   ```sql
   SELECT id, stream_id, reason, payload, created_at
   FROM kanban_core_lifecycle_dead_letters
   WHERE payload->>'event_type' = 'improvement.task.requested.v1'
   ORDER BY created_at DESC;
   ```

2. Re-publish the same envelope onto `stream:core:lifecycle` so the consumer
   picks it up on its next poll. The dead-letter row's `payload` already
   contains the exact `event_id`, `event_type`, `occurred_at`, and `envelope`
   fields the stream entry originally carried — replay them verbatim via
   `redis-cli` inside the Redis container (host port `6380`, in-container
   port `6379`):

   ```bash
   docker exec -it <redis-container> redis-cli -p 6379 XADD stream:core:lifecycle '*' \
     event_id "<event_id from payload>" \
     event_type "improvement.task.requested.v1" \
     occurred_at "<occurred_at from payload>" \
     envelope '<envelope JSON string from payload, verbatim>'
   ```

   Because the resulting work item id is the proposal id, this is safe to
   run more than once — a redelivery that lands after the project is already
   filed is a no-op (the handler finds the existing work item and logs
   `already filed on project ... ; skipping`).

3. Confirm the work item appears on the configured project's board with
   `metadata.improvement.proposalId` set to the proposal id (see
   [Verification](#verification)).

Note the manual path does not delete the original dead-letter row (only the
replay endpoint does that, and only after a successful re-publish) — an
operator using `redis-cli` directly should also delete or annotate the row
to avoid confusing future audits.

## Governance posture: `propose` vs `auto_apply`

Whether a `code_change` proposal needs approval before it applies is governed
by the `improvement_governance_mode` setting
(`apps/api/src/improvement/governance/improvement-governance.settings.constants.ts`,
default `tiered`) and the pure decision function
`decideGovernanceAction` (`improvement-governance-policy.helpers.ts`):

| Mode               | `code_change` outcome                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `manual`           | always `propose` — every proposal above the drop floor queues for approval                                      |
| `tiered` (default) | always `propose` — `code_change` is not in the tiered auto-apply allowlist (only `skill_assignment` is)         |
| `autonomous`       | `auto_apply` once capped confidence clears `GOVERNANCE_PROMOTION_CONFIDENCE_FLOOR` (`0.5`); otherwise `propose` |

Evidence-class confidence caps (`struggle_backed` vs `inference`) apply in
every mode before the mode dispatch runs, and can drop a proposal (`capped <=
0`) before it ever reaches `propose`/`auto_apply`.

In practice: under the default `tiered` posture, every `code_change` proposal
needs a human to approve it in the **Improvements queue**
(`apps/web/src/pages/improvements/ImprovementsQueue.tsx`) — `POST
/api/improvement/proposals/:id/approve` — before it applies and files a work
item. Only in `autonomous` mode does a sufficiently-confident `code_change`
proposal auto-apply without a human in the loop; the code itself still has to
pass the same implement → quality-gate → auto-merge pipeline once it becomes
a work item.

## Dedup behavior

Recurring briefs for the same underlying issue bump `occurrence_count` on the
existing proposal instead of creating a new one (`CodeChangeDedupService`).
When the embedding provider is unconfigured, dedup degrades to lexical
similarity plus exact normalized-title matching — this has weaker recall than
embedding similarity, so near-duplicate wordings may slip through as separate
proposals instead of being merged.

## Verification

1. Configure `self_improvement_project_id` (see above) and approve (or
   trigger) a test `code_change` proposal from the Improvements queue.
2. Confirm the event was published:

   ```bash
   docker exec -it <redis-container> redis-cli -p 6379 \
     XREVRANGE stream:core:lifecycle + - COUNT 5
   ```

   (host port `6380` if connecting from outside the container). Look for an
   entry with `event_type improvement.task.requested.v1`.

3. Confirm the work item appears on the configured project's board with
   `metadata.improvement.proposalId` set to the proposal id.
4. If it doesn't appear within one consumer poll interval (~5s), check the
   Kanban logs for a `parked` warning (misconfigured/empty setting) or a
   `Dead-lettered core lifecycle stream entry` warning (any other handler
   error), and query `kanban_core_lifecycle_dead_letters` for the reason.

## Related docs

- [`docs/superpowers/specs/2026-07-02-self-improvement-pipeline-design.md`](../superpowers/specs/2026-07-02-self-improvement-pipeline-design.md)
  — the design spec for the full improvement-proposal pipeline (skills,
  workflow/profile changes, and code-change bridge).
- [`docs/guides/github-private-repository-import-and-orchestration.md`](../guides/github-private-repository-import-and-orchestration.md)
  — repository import flow used to create the self-improvement project.
