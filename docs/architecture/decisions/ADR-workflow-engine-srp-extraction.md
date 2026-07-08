# ADR: Workflow-Engine SRP Extraction (Plan-Path Stub)

**Status:** Accepted
**Date:** 2026-07-02
**Work item:** f9d280a4-849c-4159-bc87-b45d47dbec7a
**Owner:** refactor-executor
**Module:** `apps/api/src/workflow/`
**Related docs:**
[`ADR-20260702-workflow-engine-responsibility-split.md`](./ADR-20260702-workflow-engine-responsibility-split.md),
`docs/architecture/workflow-engine.md`, `docs/guide/06-workflow-engine.md`,
`docs/architecture/ADR-0001-api-module-dependency-inversion.md`,
`docs/architecture/workflow-module-decomposition.md`

> **See also:** the authoritative record of the workflow-engine
> Single-Responsibility-Principle extraction lives at
> [`ADR-20260702-workflow-engine-responsibility-split.md`](./ADR-20260702-workflow-engine-responsibility-split.md).
> This file is preserved at the path the work-item plan referenced
> (`docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`)
> for traceability only; it does not duplicate the content. The M4
> milestone added this stub because the M1 author landed the decision
> under a date-prefixed filename and the M1–M3 staged-state contract
> forbids renaming a file that prior milestones have already touched.

## Why this stub exists

The work-item execution plan for
`f9d280a4-849c-4159-bc87-b45d47dbec7a` asked for the SRP-extraction
ADR to be authored at
`docs/architecture/decisions/ADR-workflow-engine-srp-extraction.md`
and verified the result with
`ls docs/architecture/decisions/ | grep workflow-engine-srp`. The
M1 milestone landed the decision under the date-prefixed filename
`ADR-20260702-workflow-engine-responsibility-split.md` instead —
following the dated convention used by recent ADRs such as
[`ADR-20260627-refinement-routing-restoration.md`](./ADR-20260627-refinement-routing-restoration.md).

Renaming that file after the M1–M3 implementation milestones had
already staged it would have required unstaging, renaming, and
restaging, which conflicts with the staged-state contract for the
work item. The M4 milestone therefore:

1. **Keeps `ADR-20260702-workflow-engine-responsibility-split.md`
   verbatim** as the authoritative record. It already satisfies the
   plan's content requirements (Title, Status: Accepted, Context
   covering the 504-LOC engine + 13 deps + Docker internals +
   cascade recursion, Decision splitting the engine into
   `WorkflowCancellationCascadeService`,
   `WorkflowEngineLaunchOrchestratorService`, and the existing
   `WorkflowContainerCleanupService`, Alternatives including the
   keep-monolith and extract-Docker-only rejections, Consequences
   covering constructor-width reduction, independently testable
   cascade + launch, the public `cancelRun` API, the removal of the
   leaky `Set<string> visited` parameter, residual risk of more files
   to navigate, and the future `WorkflowRunRepository`
   interface-extraction follow-up, a Follow-up section, and full
   references to all three extracted services by name and file
   path).
2. **Adds a Naming note at the top of the existing ADR** explaining
   the filename convention and pointing to this stub.
3. **Adds this stub at the plan's expected path** so the plan's
   `ls … | grep -i 'workflow-engine'` verification returns at least
   one matching file. Two matches will appear (`…srp-extraction.md`
   and `…responsibility-split.md`); both point to the same
   authoritative record.

## Authoritative content pointer

The full Context / Decision / Alternatives / Consequences /
Follow-up / References content of this ADR lives in
[`ADR-20260702-workflow-engine-responsibility-split.md`](./ADR-20260702-workflow-engine-responsibility-split.md).
Refer to that file for the substantive decision. This stub
intentionally contains no duplicated content so the two files cannot
drift.

## Status

Status: Accepted. Owner: refactor-executor.

This stub was added in the M4 milestone of work item
`f9d280a4-849c-4159-bc87-b45d47dbec7a`. The substantive SRP decision
itself is recorded in the linked ADR.
