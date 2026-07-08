# ADR: Retrospective Module-Facet Seams (Plan-Path Stub)

**Status:** Accepted
**Date:** 2026-07-03
**Work item:** ef4d6799-8468-4c4b-b8d6-20e8f0fca384
**Owner:** refactor-executor
**Module:** `apps/kanban/src/retrospectives/`
**Related docs:**
[`ADR-20260703-retrospective-module-facet-seams.md`](./ADR-20260703-retrospective-module-facet-seams.md),
[`ADR-20260702-workflow-engine-responsibility-split.md`](./ADR-20260702-workflow-engine-responsibility-split.md),
[`ADR-workflow-engine-srp-extraction.md`](./ADR-workflow-engine-srp-extraction.md),
`docs/architecture/workflow-engine.md`, `docs/guide/22-kanban-lifecycle.md`,
`docs/guide/23-kanban-orchestration.md`

> **See also:** the authoritative record of the retrospective
> module-facet seams lives at
> [`ADR-20260703-retrospective-module-facet-seams.md`](./ADR-20260703-retrospective-module-facet-seams.md).
> This file is preserved at the path the work-item plan referenced
> (`docs/architecture/decisions/ADR-retrospective-module-facet-seams.md`)
> for traceability only; it does not duplicate the content. The M4
> milestone added this stub because the M1 author landed the decision
> under a date-prefixed filename and the M1–M3 staged-state contract
> forbids renaming a file that prior milestones have already touched.

## Why this stub exists

The work-item execution plan for
`ef4d6799-8468-4c4b-b8d6-20e8f0fca384` asked for the
retrospective module-facet seams ADR to be authored at
`docs/architecture/decisions/ADR-retrospective-module-facet-seams.md`
and verified the result with
`ls docs/architecture/decisions/ | grep retrospective`. The M1
milestone landed the decision under the date-prefixed filename
`ADR-20260703-retrospective-module-facet-seams.md` instead —
following the dated convention used by recent ADRs such as
[`ADR-20260627-refinement-routing-restoration.md`](./ADR-20260627-refinement-routing-restoration.md)
and the sibling stub
[`ADR-20260702-workflow-engine-responsibility-split.md`](./ADR-20260702-workflow-engine-responsibility-split.md).

Renaming that file after the M1–M3 implementation milestones had
already staged it would have required unstaging, renaming, and
restaging, which conflicts with the staged-state contract for
the work item. The M4 milestone therefore:

1. **Keeps `ADR-20260703-retrospective-module-facet-seams.md`
   verbatim** as the authoritative record. It already satisfies
   the plan's content requirements (Title, Status: Accepted,
   Context covering the three services (528 / 438 / 571 LOC)
   and their facet responsibilities, the three duplicated
   primitives — `EmitterLike` + try/catch/emit/warn guard,
   `formatErrorMessage`, and the metadata-narrowing helper — the
   cross-module leak in
   `complete-orchestration-cycle-decision.tool.ts:emitLearningCandidateProposed`,
   the two parallel cycle-decision event shapes
   (`StoredCycleDecisionEvidence` ↔
   `CycleDecisionEventEvidence`), the follow-up note about the
   failure-threshold service still exceeding the lint cap, the
   Decision splitting the module into Runner / Evidence Collector
   / Failure-Threshold Trigger with documented dependency arrows,
   Alternatives including the collapse-to-god-service and
   facade+delegate rejections, Consequences covering the
   module-graph impact, code-shape impact, cross-module leak
   closure, and test-surface impact, a Follow-up section that
   tracks the M2–M4 extraction milestones, and full references
   to the three services plus the candidate-payload helpers by
   name and file path).
2. **Adds a Naming note at the top of the existing ADR** explaining
   the filename convention and pointing to this stub.
3. **Adds this stub at the plan's expected path** so the plan's
   `ls … | grep retrospective` verification returns at least
   one matching file. Two matches will appear
   (`…module-facet-seams.md` and
   `…-20260703-retrospective-module-facet-seams.md`); both
   point to the same authoritative record.

## Authoritative content pointer

The full Status / Context / Decision / Alternatives /
Consequences / Follow-up / References content of this ADR lives
in
[`ADR-20260703-retrospective-module-facet-seams.md`](./ADR-20260703-retrospective-module-facet-seams.md).
Refer to that file for the substantive decision. This stub
intentionally contains no duplicated content so the two files
cannot drift.

## Status

Status: Accepted. Owner: refactor-executor.

This stub was added in the M4 milestone of work item
`ef4d6799-8468-4c4b-b8d6-20e8f0fca384`. The substantive
retrospective module-facet decision itself is recorded in the
linked ADR.