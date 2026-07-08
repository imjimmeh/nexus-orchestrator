# EPIC-176: Self-Improvement Reality Alignment and Learning API Restoration

**Status:** Proposed  
**Priority:** P1  
**Created:** 2026-05-16  
**Updated:** 2026-05-16  
**Owner:** Core API / Memory  
**Parent:** EPIC-175  
**Related:** EPIC-067, EPIC-084, EPIC-107, EPIC-142, EPIC-146

## Summary

Restore the missing learning and skill-proposal API seam, resolve the `LearningCandidate` schema mismatch, and align backend contracts with the web client and existing persistence scaffolding. This epic is the first required step before deeper runtime writeback, retrospectives, or feedback-to-learning automation can be safely implemented.

## Problem Statement

The repository contains learning/proposal persistence and web client expectations, but the API layer that should connect them is missing or incomplete. This creates a false sense that autonomous memory learning is implemented while the actual system cannot list candidates, run learning sweeps, preview proposals, or approve/reject skill proposals through the expected API routes.

The mismatch is especially risky because `EPIC-084-autonomous-memory-dreaming-and-skill-self-improvement.md` is marked implemented and claims these endpoints exist. Future agents may trust that epic and build on top of absent routes.

## Evidence and Affected Files

### Persistence Exists

- `apps/api/src/database/entities/learning-candidate.entity.ts`
- `apps/api/src/database/entities/skill-improvement-proposal.entity.ts`
- `apps/api/src/database/repositories/learning-candidate.repository.ts`
- `apps/api/src/database/repositories/skill-improvement-proposal.repository.ts`
- `apps/api/src/database/migrations/20260413010000-create-learning-candidates-and-skill-improvement-proposals.ts`
- `apps/api/src/database/migrations/20260428100000-add-proposal-diagnostics-json.ts`
- `apps/api/src/database/database.module.ts`

### Contract Mismatch

- `LearningCandidate` entity maps `scope_id`.
- Migration `20260413010000-create-learning-candidates-and-skill-improvement-proposals.ts` creates a legacy project-specific column.
- This must be reconciled before adding production routes that filter or mutate candidates.

### Web Client Expects Routes

- `apps/web/src/lib/api/client.projects.learning.ts`
- Expected routes include:
  - `GET /memory/learning/status`
  - `POST /memory/learning/run`
  - `GET /memory/learning/candidates`
  - `GET /skills/proposals`
  - `GET /skills/proposals/:id/preview`
  - `POST /skills/proposals/:id/approve`
  - `POST /skills/proposals/:id/reject`

### API Gap

During review, matching controllers/services were not found under current memory or skill modules. The API should expose these routes explicitly or the web client should be updated to match the chosen route shape.

## Goals

- Define the canonical learning candidate scope model.
- Add backend controllers/services for learning status, learning sweep trigger, candidate listing, proposal listing, proposal preview, proposal approval, and proposal rejection.
- Align API responses with web client expectations.
- Add validation DTOs/schemas for query filters, IDs, approval input, rejection input, and pagination.
- Emit existing autonomy event names for lifecycle transitions where appropriate.
- Add unit/controller tests that prove the API seam is real.

## Non-Goals

- Do not implement full runtime memory writeback in this epic; that belongs to EPIC-177.
- Do not replace retrospective placeholder workflow in this epic; that belongs to EPIC-178.
- Do not auto-approve skill changes.
- Do not migrate unrelated memory APIs.

## Expected Changes

### Data Model

Use the canonical neutral scope model for core learning candidates:

- Store `scope_id` plus an explicit `scope_type`, so the core learning API remains neutral across global, workflow-run, workspace, and integration-owned scopes.
- The legacy project-specific column must be migrated into the neutral `scope_type` / `scope_id` model rather than becoming the core API domain concept.

Implementation should include a migration or repair migration if required by the current database state. Tests should verify repository reads/writes use the same column names as the migration.

### API Module

Add a narrow module for self-improvement API behavior. Candidate locations:

- `apps/api/src/memory/learning/`
- `apps/api/src/autonomy/learning/`

The module should own:

- Learning status service.
- Candidate listing service.
- Learning sweep trigger service.
- Skill proposal service.
- Controllers for `/memory/learning/*` and `/skills/proposals/*`, unless route design changes are approved.

### Learning Routes

Implement:

- `GET /memory/learning/status`
  - Returns last sweep status, candidate counts by status, proposal counts by status, and whether a sweep is currently running.
- `POST /memory/learning/run`
  - Starts or requests a learning sweep. Initial implementation may be synchronous or enqueue an internal workflow/job, but must report status clearly.
- `GET /memory/learning/candidates`
  - Supports pagination, status filtering, source filtering, scope filtering, and stable ordering.

### Proposal Routes

Implement:

- `GET /skills/proposals`
  - Lists sparse proposal metadata: IDs, target skill, title, summary, status, generated run ID, and created/updated timestamps.
- `GET /skills/proposals/:id/preview`
  - Shows patch markdown, proposed/resulting markdown, validation warnings, and diagnostics for review before a lifecycle decision.
- `POST /skills/proposals/:id/approve`
  - Records an approved decision and emits an audit event; it does not apply skill patches or write memory.
- `POST /skills/proposals/:id/reject`
  - Records rejection reason and emits an audit event.

## Workstreams

### WS-1: Reality Alignment

- Audit current DB schema and entity mappings.
- Document the canonical `scope_type` / `scope_id` model and decide how the legacy project-specific migration column is repaired.
- Add migration if needed.
- Update repository tests to catch future drift.

### WS-2: Learning API Restoration

- Add learning controller/service.
- Implement status response.
- Implement candidate listing.
- Implement run trigger as a safe stub if deeper sweep execution is deferred.
- Add validation and error handling.

### WS-3: Skill Proposal API Restoration

- Add proposal controller/service.
- Implement list and preview reads.
- Implement approve/reject state transitions.
- Add state-machine guards for invalid transitions.
- Add audit/event emission.

### WS-4: Web Contract Verification

- Verify `apps/web/src/lib/api/client.projects.learning.ts` compiles against the restored API response shapes.
- Decide whether to keep global routes with scope filters or add neutral scoped routes.
- Add API contract tests that pin route behavior.

## Testing Plan

- Repository test: entity mapping matches migration columns.
- Service test: learning status aggregates candidate/proposal counts correctly.
- Controller test: `GET /memory/learning/candidates` validates filters and pagination.
- Controller test: `POST /memory/learning/run` returns a stable run/status payload.
- Service test: proposal approval rejects invalid states and records audit metadata.
- Service test: proposal rejection requires reason and preserves diagnostics.
- Event test: approval/rejection emits stable `memory.learning.*` event names.

## Acceptance Criteria

- The expected learning/proposal routes exist and are registered in the API app.
- The web client can call the restored endpoints without route-level 404s.
- `LearningCandidate` entity and migration use a consistent scope column model.
- Approval/rejection operations are state-guarded, audited, and tested.
- This epic does not allow ungoverned memory writes; it only restores the API/lifecycle seam.

## Dependencies

- Blocks EPIC-177 because writeback needs candidates/proposals to exist behind a stable API/service seam.
- Blocks EPIC-178 if retrospective runs are expected to expose status through `/memory/learning/status`.
- Enables EPIC-179 by providing a real candidate ingestion/listing target.
