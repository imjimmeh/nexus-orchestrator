# Learning Tab Redesign — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming), pending implementation plan

## Problem

The "Learning" tab on project kanban pages (`apps/web/src/pages/project-workspace/LearningTab.tsx`) shows two lists — Learning Candidates and Skill Proposals — that are hard to work with:

- Filtering is a single status dropdown; nothing else (no search, no date range, no score/type filtering).
- Sorting is fixed (candidates: score desc; proposals: created_at desc) — not user-controlled.
- No sense of recency/trend: no "new since last visit," no flag for items stuck in `pending`.
- No bulk actions — every approve/reject/promote is one row at a time.
- Timestamp and reviewer-decision fields the user wants to see (proposed date, approved/rejected date, who decided, rejection reason) already exist in the database but are never surfaced past the mapper layer.
- Learning Candidates have no manual reject/archive action at all today — only `promote`. `rejected`/`archived` statuses exist in the enum but are currently only set by automatic policy/decay processes; `archived` specifically is unused by any code path.

## Goals

1. Surface the existing-but-hidden timestamp/reviewer fields (proposals: `approved_at/by`, `rejected_at/by`, `rejection_reason`, `applied_at`; candidates: `promoted_at`, `human_approved_at`, `first_seen_at`, `last_seen_at`).
2. Give both lists real filtering (multi-status, text search, date range, candidate type, score threshold), sorting, and a sane default view (active/actionable items only).
3. Add recency/trend signals: "new since last visit" badge, "stale" flag for long-pending items, and a per-item timeline (first seen → recurrence → decision → applied).
4. Add bulk actions (reject/archive/promote for candidates; approve/reject for proposals) plus inline single-row actions.
5. Add manual reject/archive for Learning Candidates, which don't have any human-triggered terminal action today.

## Non-goals

- No changes to the automatic clustering/promotion/decay pipelines that currently drive candidate status transitions.
- No cross-device "last viewed" sync — tracked client-side only (see below).
- No re-surfacing logic for rejected candidates that keep recurring — rejection is permanent for v1 (see Decisions).

## Architecture

Reuses the existing shared `DataTable` primitive (`apps/web/src/components/ui/data-table/`), already used by Workflows, GlobalWorkItemsPage, ExecutionLogs, EventLedgerFeed, and WorkflowEventsFeed, instead of building a second bespoke list framework. The Learning-specific bespoke cards (`LearningTabCandidatesCard`, `LearningTabProposalsCard`) are replaced with thin wrappers supplying column defs, filters, and renderers to `DataTable`.

Backend list endpoints are rewritten to match the query/response convention `DataTable`'s server mode expects, using the same shared query-builder helpers (`apps/api/src/common/utils/query-helpers.ts`: `applyPagination`, `applySort`, `applySearch`, `buildPaginatedResponse`) already used elsewhere (e.g. `llm-model.repository.ts`).

### 1. Backend — list-query contract rewrite

**Schemas** (`packages/core/src/schemas/memory/learning-contracts.schema.ts`):

- `listLearningCandidatesSchema` / `listSkillImprovementProposalsSchema` replace `status` (single enum) + `offset` with:
  - `page` (default 1), `limit` (unchanged: 1–100, default 25)
  - `search` (optional string)
  - `sortBy` / `sortDir` (optional)
  - `status` becomes an array, accepted as a comma-separated query param (`?status=pending,promoted`)
- Candidates additionally accept: `candidate_type` (array), `min_score` (number), `created_from` / `created_to` (ISO date strings)
- Proposals additionally accept: `created_from` / `created_to`
- Existing `scope_type` / `scope_id` filters unchanged

**Repositories** (`learning-candidate.repository.ts`, `skill-improvement-proposal.repository.ts`):

- Replace hardcoded `.orderBy(...).offset(...).limit(...)` with `applySort`/`applySearch`/`applyPagination`, each with an explicit sort allowlist:
  - Candidates: `score`, `created_at`, `updated_at`, `first_seen_at`, `last_seen_at`, `promoted_at`
  - Proposals: `created_at`, `approved_at`, `rejected_at`, `applied_at`
- Date-range and score-threshold filters are additional `andWhere` clauses, same style as the existing scope filters.

**Response envelope**: both endpoints switch from `{items, total, limit, offset}` to `{data, meta: {pagination}}` via `buildPaginatedResponse`. Candidates' `suppressed_count` rides along as `meta.suppressedCount`.

**Migration required**: `learning_candidates` gets 6 new nullable columns mirroring `SkillImprovementProposal`'s existing audit shape: `rejected_at`, `rejected_by`, `rejection_reason`, `archived_at`, `archived_by`, `archive_reason`.

### 2. Backend — new candidate lifecycle actions

Today only `promote` exists for candidates. Add:

- `reject` (single + bulk) — requires a reason (mirrors proposals). **Permanent**: a rejected candidate that recurs again via `record-learning.service.ts`'s `reinforceExisting` still just bumps `recurrence_count`/`last_seen_at`; its status is not reconsidered. This is an explicit v1 simplification — re-surfacing on renewed recurrence is deferred.
- `archive` (single + bulk) — reason optional. Distinct from reject: "valid signal, no longer relevant/stale" vs reject's "wrong/not useful."
- Bulk variants (`bulk-reject`, `bulk-archive`, `bulk-promote`) are **transactional, all-or-nothing**: if any target ID isn't in a valid source status when the transaction runs, the whole batch is rejected with an error identifying the offending IDs.

### 3. Backend — new proposal bulk actions

`bulk-approve`, `bulk-reject` — same transactional all-or-nothing pattern, writing the existing per-row audit fields (`approved_by`/`rejected_by`/`rejected_at`/`rejection_reason`) exactly as the single-item endpoints do today.

### 4. Shared DataTable enhancements

All changes are additive/optional on existing types — the 5 existing consumers are unaffected.

- **`FilterDef.type`**: widen `"select"` → `"select" | "multiselect" | "date"`. `filterValues` stays `Record<string, string>`; multiselect values serialize as a comma-joined string (matching the backend's `?status=a,b` convention), date values as ISO strings.
- **`useDataTable`'s client-mode filter matching**: add a branch per filter type (multiselect → membership check; date → range compare against paired `*_from`/`*_to` keys). Server mode already forwards `filterValues` into the query object, so no change needed there.
- **`defaultFilterValues` prop**: new optional prop, applied when there's no URL state yet. Makes "active/actionable only" the true default (Candidates: `status=pending,promoted`; Proposals: `status=pending`).
- **Row selection + bulk-action bar**: new optional `enableSelection?: boolean` + `renderBulkActions?: (selected: T[]) => ReactNode`. DataTable owns the checkbox column and selection state; Learning owns what the bulk actions do.
- **`renderExpanded?: (item: T) => ReactNode`**: new optional per-row expand toggle (separate icon/column from `onRowClick`) revealing a full-width row — the slot the per-item timeline renders into.

### 5. Frontend — Learning tab migration

- **Mapper** (`learning.mapper.ts`) and **types** (`apps/web/src/lib/api/types.ts`): surface all previously-dropped fields listed in Goals #1, plus the 6 new candidate audit columns.
- **Hooks/API client** (`useLearningMemory.ts`, `client.projects.learning.ts`): rewritten to send the new query shape and parse `{data, meta}`; become the `fetchFn` passed directly into `DataTable mode="server"`.
- **Both bespoke cards replaced** with thin `DataTable` wrappers:
  - Columns: existing fields + newly-surfaced dates (relative format, absolute on hover)
  - Filters: status (multiselect, defaulted per above), candidate_type + min-score (candidates only), date range
  - Search: free-text across title/summary/skill-name via backend `search`
  - **New badge**: `created_at`/`updated_at` after a per-project `localStorage` "last viewed" timestamp (stamped on tab mount, client-side only — no backend change)
  - **Stale flag**: `status === 'pending'` and `created_at` older than 7 days
  - **Timeline (row expansion)**: first_seen → recurrence bumps → promoted/approved/rejected/archived/applied, each with actor + timestamp
  - **Bulk toolbar**: wired to the new bulk endpoints, with a partial-success toast if the transaction reports failures
  - **Inline row actions**: single-item approve/reject/promote/archive buttons per row

## Decisions log

| Question                                          | Decision                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Scope both cards together or sequence separately? | Both together, one spec                                                             |
| Default list view                                 | Active/actionable only, hide terminal states by default                             |
| Filter dimensions                                 | Text search, date range, scope, candidate type / score threshold — all in           |
| Trend/recency treatment                           | New-since-last-visit badge + stale flag + per-item timeline + date sort — all in    |
| Bulk action scope                                 | Bulk reject/archive, inline approve/reject, bulk promote/approve — all in           |
| "New since last visit" tracking                   | Client-side `localStorage` only, no backend tracking                                |
| Candidate reject/archive scope                    | Add now, as part of this design (not deferred)                                      |
| Rejected-candidate recurrence                     | Permanent — rejection sticks, no auto-resurface in v1                               |
| Reject vs archive for candidates                  | Two distinct actions with distinct semantics (wrong vs stale)                       |
| Bulk action execution                             | Dedicated, transactional bulk endpoints (not a frontend loop over single endpoints) |

## Testing & rollout

- TDD per project convention: repository-level tests first for query-builder behavior (sort allowlist, search columns, date-range filtering), then controller/e2e tests for the new single + bulk mutation endpoints, including bulk transactional rollback on partial-invalid input.
- `apps/web` component tests cover the new DataTable capabilities (multiselect filter, `defaultFilterValues`, selection/bulk bar, row expansion) in isolation before wiring into Learning.
- One migration: 6 new nullable audit columns on `learning_candidates`.
- Internal admin UI, single consumer — old query shape and response envelope are replaced outright, no versioning/dual-run needed.
- Update `docs/guide` wherever the learning/retrospective candidate lifecycle is documented (EPIC-212 references), noting the new manual reject/archive action and its permanent semantics.
