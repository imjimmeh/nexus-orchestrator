---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: import-boundaries
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/architecture/import-boundary.types.ts
  - apps/api/src/architecture/import-boundary.spec.ts
  - apps/api/src/architecture/import-boundary.exceptions.ts
  - apps/api/src/architecture/import-boundary.exceptions.workflow-domain-ports.ts
  - apps/api/src/workflow/domain-ports/in-process-chat-session-domain.adapter.ts
  - apps/api/src/session/session-hydration.service.ts
source_paths:
  - apps/api/src/architecture/import-boundary.types.ts
  - apps/api/src/architecture/import-boundary.spec.ts
  - apps/api/src/architecture/import-boundary.exceptions.ts
  - apps/api/src/architecture/import-boundary.exceptions.workflow-domain-ports.ts
updated_at: 2026-06-15T00:00:00Z
---

# Probe Result: API Import Boundary Rules

## Narrative Summary

The API implements a mature, vitest-enforced import boundary guardrail system under `apps/api/src/architecture/`. Four files form a coherent, layered feature:

1. **`import-boundary.types.ts`** — Declares the domain taxonomy (`ImportBoundaryDomain`: `'control-plane' | 'chat-domain'`; `external-domain` is also recognized in the spec scanner even though it is not in the exported type union), the exception record shape (`ImportBoundaryException` with `sourceFile`, `targetFile`, `fromDomain`, `toDomain`, `reason`, `owner`, `expiresOn`), the discovered edge shape (`ImportBoundaryEdge`), and a `ImportBoundarySeedRow` tuple helper for compact table-style declaration.

2. **`import-boundary.spec.ts`** — Vitest harness with two enforcement tests: (a) "contains only unexpired temporary exceptions" — fails the suite if any entry in the allowlist has an `expiresOn` in the past; (b) "fails when cross-domain imports are not explicitly allowlisted" — walks every `.ts` source file under `apps/api/src/` (skipping `dist/`, `node_modules/`, `*.d.ts`, `*.spec.ts`, `*.e2e-spec.ts`), parses import/export specifiers, resolves relative paths to actual files, classifies each file into a domain by top-level segment (`workflow/` → `control-plane`, `project/` or `project-goals/` → `external-domain`, `session/` → `chat-domain`), and reports any cross-domain edge that is not in the allowlist. Tracked pairs include all permutations between the three domains. The scan has a 60-second timeout to remain practical in CI.

3. **`import-boundary.exceptions.ts`** — The temporary allowlist. Currently declares 9 explicit exceptions, all `control-plane → chat-domain` and all targeting `session/session-hydration.service.ts`. They are tagged with shared metadata: reason `"Legacy in-process coupling approved for phase-1 split guardrails."`, owner `EPIC-090`, expiry `2026-09-30` (still in the future as of 2026-06-15, so the suite will pass). The list spreads in `workflowDomainPortsExceptionRows` from the split file, enabling modular growth of the allowlist.

4. **`import-boundary.exceptions.workflow-domain-ports.ts`** — A split module (per its JSDoc comment: "Split from import-boundary.exceptions.ts to keep each file under the max-lines limit.") reserved for control-plane → external-domain (`project`) coupling exceptions. Currently exports an empty array, indicating the legacy in-process coupling has been resolved or no exceptions are currently needed for project-domain ports.

Cross-referencing the allowlist against actual source confirms the enforcement is meaningful: every exception entry corresponds to a real import of `SessionHydrationService` from `../../session/session-hydration.service` in the listed control-plane files (e.g., `workflow-step-execution/step-agent-step-executor.service.ts`, `workflow-await/dependency-parent-resume.service.ts`, `workflow-subagents/subagent-coordination.service.ts`, `domain-ports/in-process-chat-session-domain.adapter.ts`, `workflow-runtime/workflow-runtime-await-actions.service.ts`, `workflow-step-execution/step-required-tool-retry.service.ts`, `workflow-subagents/subagent-parent-resume.service.ts`, `workflow-subagents/subagent-orchestrator.runtime.operations.ts`, `workflow-step-execution/step-agent-step-executor.helpers.ts`).

## Capability Updates

- **API Import Boundary Guardrails** — Implemented and enforced via a vitest suite that statically scans the entire `apps/api/src/` tree for cross-domain relative imports and validates them against an explicit, expiration-dated allowlist.
- **Domain Taxonomy** — Three logical domains are recognized: `control-plane` (mapped to `workflow/`), `chat-domain` (mapped to `session/`), and `external-domain` (mapped to `project/` and `project-goals/`).
- **Temporary Exception Workflow** — Exceptions are first-class records carrying reason, owner (team/EPIC tag), and expiry date, supporting time-boxed debt with a hard fail if any exception is not refreshed before expiration.
- **Allowlist Modularity** — The exception registry is split across `import-boundary.exceptions.ts` and `import-boundary.exceptions.workflow-domain-ports.ts`, allowing per-domain growth without violating a max-lines guardrail.
- **No Automation Runner / No CLI Surface** — The guardrail is test-suite only; there is no separate CLI, script, or runtime hook. Detection happens at unit-test time.

## Health Findings

- **Test coverage** — Two tests provide full coverage of the intended behavior (expiration and unallowlisted-edge detection). The test itself is the spec, with no separate unit tests for the helpers (`toEdgeKey`, `toExceptionKey`, `resolveDomainFromPath`, `parseRelativeImportSpecifiers`, `listSourceFiles`, `resolveRelativeImportPath`, `collectCrossDomainEdges`). The helpers are pure and tested transitively by the integration test, but a refactor that broke classification logic could pass with no targeted assertions.
- **Code quality** — Code is well-commented, deterministic (sorted edge output, Set-based dedup), and uses a generous 60-second timeout suitable for large repos. Domain resolution is centralized in `resolveDomainFromPath`; tracked pair logic in `isTrackedPair`; both are easy to extend.
- **Type/Behavior Mismatch (Minor)** — `ImportBoundaryDomain` in `import-boundary.types.ts` is typed as `'control-plane' | 'chat-domain'` only, while the spec scanner and the allowlist both reference `'external-domain'`. The test casts strings into the `ImportBoundaryEdge` / `ImportBoundaryException` types without a type error only because both the field types and the literals are string-typed at the call site; if the union were ever enforced strictly (e.g., via a branded type or a stricter parameter), the spec and exceptions files would need updating. This is a latent hazard rather than an active bug.
- **Debt Aging** — All 9 active exceptions expire on the same date (2026-09-30). If the phase-1 split is not complete by then, every workflow file touching `SessionHydrationService` will simultaneously fail CI, which is operationally risky. Consider staggering expirations or coordinating with the owning EPIC.
- **Empty Split Module** — `import-boundary.exceptions.workflow-domain-ports.ts` exports an empty array. This is fine, but it means there is currently zero documented exception for the `control-plane → external-domain` direction, suggesting either (a) all such imports have been removed, or (b) the scanner has not yet been pointed at a `project/` or `project-goals/` directory. The scanner would correctly flag any such imports that are not in the allowlist, so absence is intentional if the file is present but empty.
- **Churn signal** — The split-file pattern and the EPIC-090 owner tag indicate this guardrail is actively maintained as part of a refactor program rather than a one-off.

## Open Questions

- What is the current state of the `apps/api/src/project/` and `apps/api/src/project-goals/` directories? They were referenced by the domain resolver but were not enumerated in this probe's scope. If they exist, the scanner is exercising them; if not, the `external-domain` branch is dead code that could be removed (or the directories are planned).
- Who is responsible for renewing the 9 allowlist entries before 2026-09-30? The `owner: EPIC-090` field is an EPIC tag, not an individual; escalation paths and renewal cadence are not encoded in the artifact.
- Is the import-boundary suite wired into CI (pre-merge checks) or only run on demand? The presence of a timeout in the test suggests it runs in CI, but this probe did not see the CI configuration.
- Is there a sister implementation of this guardrail in `apps/web/` or other workspaces? The scanner is rooted at `apps/api/src/..` (i.e., `apps/api/src`), so it intentionally scopes to the API only.
