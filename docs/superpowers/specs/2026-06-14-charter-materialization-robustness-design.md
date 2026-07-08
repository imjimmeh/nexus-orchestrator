# Charter Materialization Robustness — Design

**Date:** 2026-06-14
**Status:** Approved (design)
**Related issues:** kanban-pcld (P1, primary), kanban-bf21 (P2, charter tool denials)

## Context

The project charter's source of truth is the kanban database
(`kanban_project_goals` + charter memories). The on-disk artifact
`docs/project-context/CHARTER.md` is a _projection_ of that data, rendered by
`CharterDocRenderService.render(projectId)` and meant to be committed into each
project's managed clone (`base_path`).

CEO/discovery/charter/roadmap prompts read the charter from disk
(e.g. `strategize.md` reads `docs/project-context/CHARTER.md` with
`missing_ok: true`). When the file is absent, those steps lose strategic
calibration context.

### Observed failure (diagnosis)

Investigated workflow runs `5ad31570` (CEO orchestration cycle, `strategize`
step — `ls docs/project-context/CHARTER.md` → `NOT FOUND`) and `f8d91287`
(`project_charter_ceo`, completed) for project `458935f0`:

- The clone at `/data/nexus-workspaces/clones/458935f0-…` has the other
  project-context docs (`ARCHITECTURE.md`, etc., written by discovery probes via
  the same git endpoint) but **no `CHARTER.md`**.
- `git log --all` on the clone has **no `docs(charter): regenerate from project
intent` commit** — the regen processor's commit message — on any branch. The
  regen → commit step has never executed for this project.
- The API `/git/files/write` handler writes the working tree _before_
  committing, so a successful call would leave the file even if push failed.
  File absent ⇒ endpoint never reached for the charter.
- The DB holds the data (15 goals); only the materialized file is missing.
- Last goal write `08:57:37`; containers recreated `09:24:56`; no goal/memory
  write since ⇒ the (now-wired) async regen had no trigger on the current
  deployment.

### Root cause

The charter file is produced only by a **fire-and-forget, eventually-consistent
async pipeline** (goal/memory write → `CharterRegenEnqueuer` → BullMQ
`charter-regen` queue → `CharterRegenProcessor` → render →
`writeRepoFile({push:true})` → commit + push). It has:

- no retry/backoff on transient failure,
- no reconciliation/backfill for projects whose DB has charter data but whose
  clone lacks the file,
- silent skips (`charter-regen skipped: no basePath` is the only log; render/git
  errors are not surfaced),
- no point-of-use generation — an agent that reads the file the moment a job is
  dropped sees nothing.

A secondary defect (kanban-bf21): `update_charter` /
`delegate_charter_refinement` are denied to the very profiles meant to author the
charter (`ceo-agent`, `product-manager`, `investigation-coordinator`). The file
render does **not** depend on `update_charter`, so this is not the cause of the
missing file, but it blocks the explicit authoring path and should be wired to
trigger regen once fixed.

## Goals

1. An agent can **always** obtain current charter content at the point it needs
   it, regardless of queue/worker/git health (no single point of failure on the
   critical path).
2. The committed `CHARTER.md` artifact converges to a correct projection of the
   DB and self-heals after transient failures or deploys that predate the
   feature.
3. No charter-specific logic leaks into API/core (core/kanban boundary).

## Non-goals

- Changing the charter's source of truth (remains the kanban DB).
- Synchronous API-prep materialization (would require API/core to reference the
  charter domain — boundary violation).
- Fixing kanban-bf21 itself (tracked separately); this design only consumes its
  outcome by enqueuing regen on `update_charter`.

## Architecture

`CharterDocRenderService.render(projectId)` remains the single deterministic
renderer. Three cooperating projection mechanisms layer over it so each covers
the others' failure modes.

### Mechanism A — `kanban.get_charter` runtime tool (hard guarantee, race-free)

A new kanban-owned MCP read tool that renders the charter from the DB on demand
and returns the markdown directly. No file, no queue, no git, no race.

- **Handler:** `apps/kanban/src/mcp/tools/read/get-charter.tool.ts`, implementing
  `IInternalToolHandler`, following the `project-state.tool.ts` /
  `project-brief.tool.ts` pattern. Name: `kanban.get_charter`. Resolves
  `projectId` from tool context (`resolveProjectIdFromToolContext`), calls
  `CharterDocRenderService.render(projectId)`.
- **Registration:** export from `apps/kanban/src/mcp/tools/read/index.ts`;
  auto-discovered via `Object.values(ReadTools)` in `kanban-mcp.module.ts`
  (no manual registration).
- **Manifest/access:** add to the kanban tool manifest and to the
  `allowed_tools` / tool policy of charter-consuming profiles
  (CEO, discovery, charter, roadmap).
- **Prompts:** update `strategize.md`, discovery, charter `refine.md`, and
  roadmap prompts to obtain the charter via `get_charter` as the primary path,
  keeping the file read as a fallback/human artifact.

This alone guarantees point-of-use availability.

### Mechanism B — just-in-time materialization at run start (file freshness, kanban-driven)

The kanban side already consumes neutral workflow lifecycle events
(`CoreLifecycleStreamConsumer`). On a "run started" event for a scope that maps
to a kanban project, kanban renders and writes `CHARTER.md` into the project's
managed clone (`base_path`) and commits/pushes (best-effort).

- Keeps the existing `read docs/project-context/CHARTER.md` contract working per
  run and gives humans/file-based tooling a fresh artifact.
- Boundary-clean: API never references the charter; kanban reacts to a neutral
  signal.
- **Not** the hard guarantee (A is). A small race remains between event handling
  and container start; in practice the agent reads the charter several seconds
  into its turn, and A backstops any miss.
- Reuses the same render + write path as Mechanism C.

### Mechanism C — hardened async regen + reconciliation (canonical artifact converges)

1. **Durable queue.** Add `attempts: 3` + exponential `backoff` (e.g. 1s base) to
   the `charter-regen` enqueue. Keep `removeOnFail: 100` for DLQ visibility.
2. **Non-silent failures.** Log render/git/write failures at `warn`/`error`; the
   `basePath`-missing skip stays a `warn`. No swallowed errors.
3. **Reconciliation sweep.** New `CharterRegenReconciliationService`
   (`OnModuleInit` + periodic interval). For each active project with a
   `base_path`: render, compute a content hash, compare against the committed
   `CHARTER.md`; on drift or absence, write + commit + push. Self-heals projects
   whose file was lost to a transient failure or a pre-feature deploy.
4. **Complete the trigger set.** Every charter-relevant mutation enqueues regen.
   Goals + memories already do; wire `update_charter` to enqueue once kanban-bf21
   unblocks it.

## Data flow

```
DB (goals + charter memories)  ── single renderer ──>  CharterDocRenderService.render()
                                                          │
        ┌─────────────────────────────────────────────── ┼ ───────────────────────────────┐
        │ A: get_charter tool          B: run-start materialize        C: regen + reconcile  │
        │ (on demand, returns md)      (lifecycle event → base_path)   (mutation/sweep →      │
        │ NO file/queue/git            commit+push best-effort)        commit+push, retried)  │
        └────────────────────────────────────────────────────────────────────────────────── ┘
                                                          │
                                          docs/project-context/CHARTER.md (committed artifact)
```

## Failure-mode coverage

| Transient failure             | A (tool)                | B (run-start)                   | C (regen+reconcile)                 |
| ----------------------------- | ----------------------- | ------------------------------- | ----------------------------------- |
| Worker/queue down             | unaffected              | unaffected                      | re-converges on next sweep/startup  |
| Git push failure              | unaffected              | working-tree file still written | retried; reconciliation re-attempts |
| Dropped/debounced job         | unaffected              | refreshes at next run           | reconciliation backfills            |
| Deploy predating feature      | unaffected              | refreshes at next run           | startup reconciliation backfills    |
| Agent reads at the bad moment | serves content directly | —                               | —                                   |

## Boundaries

- All rendering/writing logic stays in `apps/kanban`. API/core gain nothing
  charter-specific (`nexus-boundaries/no-core-kanban-residue` stays green).
- `get_charter` is a kanban MCP tool. Mechanism B reacts to a neutral lifecycle
  event; no charter identifiers enter API/core.

## Testing (TDD)

- **A:** unit test for `GetCharterTool` — resolves project from context, returns
  rendered markdown; missing/invalid project handling. Manifest/contract test
  asserting charter-consuming prompts reference `get_charter`.
- **B:** unit test that a run-start lifecycle event for a project scope triggers
  render + write to `base_path`; no-op when scope has no kanban project.
- **C:** reconciliation drift-detection unit tests (hash match → no write; hash
  mismatch → write; missing file → write; missing `base_path` → skip + warn);
  queue retry/backoff config test; failure-logging test.
- **Regression:** an integration test that, given DB charter data and an empty
  clone, the reconciliation sweep produces a committed `CHARTER.md`.

## Rollout / verification

- Verify live for project `458935f0`: after deploy, the startup reconciliation
  sweep should produce `docs/project-context/CHARTER.md` in the clone with a
  `docs(charter): regenerate from project intent` commit; `get_charter` returns
  the same content; a subsequent CEO `strategize` run finds the file.

## Open dependencies

- **kanban-bf21** must land for the `update_charter` → regen trigger (C.4) to be
  exercised. The rest of this design is independent of it.
