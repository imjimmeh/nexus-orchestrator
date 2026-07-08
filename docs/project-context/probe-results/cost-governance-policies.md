---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: cost-governance-policies
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/cost-governance/budget-policy.service.ts
  - apps/api/src/cost-governance/budget-policy.service.spec.ts
  - apps/api/src/cost-governance/budget-decision.service.ts
  - apps/api/src/cost-governance/budget-decision.service.spec.ts
  - apps/api/src/cost-governance/cost-estimator.service.ts
  - apps/api/src/cost-governance/cost-estimator.service.spec.ts
  - apps/api/src/cost-governance/cost-governance.module.ts
  - apps/api/src/cost-governance/types/cost-estimate.types.ts
  - apps/api/src/cost-governance/types/budget-decision.types.ts
  - apps/api/src/cost-governance/types/budget-scope.types.ts
  - apps/api/src/cost-governance/database/entities/budget-policy.entity.ts
source_paths:
  - apps/api/src/cost-governance/budget-policy.service.ts
  - apps/api/src/cost-governance/budget-policy.service.spec.ts
  - apps/api/src/cost-governance/budget-decision.service.ts
  - apps/api/src/cost-governance/budget-decision.service.spec.ts
  - apps/api/src/cost-governance/cost-estimator.service.ts
  - apps/api/src/cost-governance/cost-estimator.service.spec.ts
updated_at: 2026-06-15T20:30:00.000Z
---

# Probe Result: Cost Governance - Policy Layer

## Narrative Summary

The `cost-governance-policies` scope is **fully implemented**. The three
services it owns — `BudgetPolicyService`, `BudgetDecisionService`, and
`CostEstimatorService` — are real, behavior-bearing services, not stubs.
Responsibilities are cleanly split along the requested axes:

- **BudgetPolicyService** owns CRUD for `BudgetPolicy` rows. It validates the
  `enforcement_mode` against an allow-list (`observe | warn |
  approval_required | block`), parses the request DTO through a Zod schema
  (re-exported from `@nexus/core`), delegates persistence to
  `BudgetPolicyRepository`, and surfaces `NotFoundException` /
  `BadRequestException` for the standard HTTP failure modes. It exposes
  `create`, `getById`, `update`, `disable`, `delete`, `listAll`, and
  `listByScope`.
- **CostEstimatorService** owns cost calculation. It resolves a
  `LlmModelRepository` row (provider+name first, name-only fallback),
  extracts `input_token_cents_per_million` / `output_token_cents_per_million`
  rates, and computes a `Math.ceil`-rounded cent estimate. It handles all
  three token-shape inputs (split input/output, total-only, null) and returns
  `estimateSource: 'unknown'` with `estimatedCents: null` when rates or tokens
  are missing.
- **BudgetDecisionService** is the orchestrator. It loads active policies
  (filtered by scope/context/provider/model), asks the estimator for a cost,
  pulls current spend from `BudgetUsageEventRepository.getSpendInWindow`,
  walks every matching policy, and applies a `DECISION_RANK`-based "most
  restrictive wins" rule. Outcomes are then mapped from each policy's
  `enforcement_mode` (`observe → allow`, `warn → warn`,
  `approval_required → approval_required`, `block → deny`). Decisions are
  persisted via `BudgetDecisionEventRepository.recordDecision`, and the
  service also exposes `getLatestDecision(contextType, contextId)` for
  read-back.

### Dependency graph (scope-internal only)

```
BudgetDecisionService
  ├─ BudgetPolicyService      (uses .listAll)
  ├─ CostEstimatorService     (uses .estimate)
  ├─ BudgetUsageEventRepository
  └─ BudgetDecisionEventRepository

CostEstimatorService
  └─ LlmModelRepository       (../ai-config/...)

BudgetPolicyService
  └─ BudgetPolicyRepository   (./database/...)
```

The split is per-responsibility: policy is pure CRUD, estimator is pure
arithmetic against a pricing table that lives in `llm_models`, and decision is
pure composition plus the rank policy.

### Module wiring

`apps/api/src/cost-governance/cost-governance.module.ts` registers all three
services as providers and exports `BudgetDecisionService` and
`CostEstimatorService` so other modules (and the runtime half of this split)
can inject them. `BudgetPolicyService` is provider-only because the controller
in the runtime half is the only consumer.

### Stub/no-op check

No service returns hard-coded literals, has empty bodies, or short-circuits
to a constant. The estimator computes; the decision branches on token limits,
soft limits, and hard limits; the policy validates input and persists. No
`TODO` / `FIXME` / `HACK` / `XXX` markers are present in any of the six
assigned files.

## Capability Updates

- **Cost estimation against a model pricing table** — implemented in
  `CostEstimatorService` against `llm_models` (provider+name preferred, name
  fallback). Supports input/output token splits and total-token fallback.
- **Configurable budget policies with enforcement modes** — implemented in
  `BudgetPolicyService` and the `BudgetPolicy` entity. Modes are
  `observe | warn | approval_required | block`; rules are scopeable by
  scope_type, scope_id, context_type, context_id, provider_name, model_name
  with `soft_limit_cents`, `hard_limit_cents`, and `token_limit` thresholds.
- **Per-action budget decisions with most-restrictive-wins semantics** —
  implemented in `BudgetDecisionService.evaluateAction`. Decision outcomes
  are `allow | warn | approval_required | throttle | deny`; the rank table
  (`observe=0, allow=0, warn=1, approval_required=2, throttle=3, block=4,
  deny=4`) ensures multiple matching policies escalate to the strictest
  applicable outcome.
- **Time-windowed spend lookups for decisions** — `resolveWindowStart` in
  `BudgetDecisionService` handles `daily | weekly | monthly | per_run |
  rolling` reset windows and feeds `getSpendInWindow`. Decisions are
  persisted as audit events.
- **Read-back of latest decision per context** —
  `BudgetDecisionService.getLatestDecision` returns
  `LatestBudgetDecisionDto` or `null` for a given
  `(contextType, contextId)`.

## Health Findings

- **Test coverage is present and meaningful for all three services.**
  - `budget-policy.service.spec.ts`: 1 `describe`, 5 `it`. Covers
    enforcement-mode validation, delegation to repo, `getById` hit/miss,
    and `listAll`.
  - `budget-decision.service.spec.ts`: 2 `describe` (one nested for
    `getLatestDecision`), 6 `it`. Covers the no-active-policies `allow`
    path, soft-limit `warn`, hard-limit `deny`, most-restrictive-wins
    across multiple policies, and both branches of `getLatestDecision`.
  - `cost-estimator.service.spec.ts`: 1 `describe`, 8 `it`. Covers
    model-rate hit, null rates, null token estimates, provider+name
    disambiguation, name-only fallback, missing-model `modelId` null, and
    the total-tokens branch.
  - Coverage skews toward the branches the runtime actually exercises
    (soft/hard limits, most-restrictive-wins, estimator provider fallback);
    not exhaustive but adequate.
- **Code quality is high.** All three services are typed end-to-end, with
  DTOs / Zod schemas / entities pulled from the shared `@nexus/core`
  package or local `types/` modules. No `any` leakage beyond the spec
  files' `as any` casts (which are conventional for `vi.fn` mocks).
- **Churn signal is low.** The newest of the six files
  (`cost-estimator.service.{ts,spec.ts}`) was last touched 2026-06-12; the
  budget-decision files were touched 2026-06-10–11; budget-policy files
  have not been touched since 2026-06-04. No `git` inspection was
  performed in this read-only probe, but mtimes suggest a single settled
  pass with the estimator as the most recent addition.
- **No stubs, no TODOs, no HACK markers in the assigned files.**

## Open Questions

- The runtime half of this split (`cost-governance-runtime`, covering
  `turn-usage-recorder`, `usage-token-normalizer`, `budget-context.provider`,
  the controller, and the module wiring) is deliberately not assessed
  here. Whether the controller endpoints actually call into
  `BudgetDecisionService.evaluateAction` and whether
  `TurnUsageRecorderService` records against the same `BudgetDecisionEvent`
  audit trail is out of scope.
- `BudgetDecisionService.evaluateAction` always queries the `'daily'`
  window from `resolveWindowStart`, even though the input allows the
  policy's own `window` to be `weekly | monthly | rolling | per_run`. The
  `window` field on the policy entity is therefore read but not
  propagated to the spend lookup in the current code path. Whether this is
  a known limitation or a planned follow-up is not resolvable from code
  alone; the spec files do not cover the per-window branch.
- `BudgetPolicyService.listByScope` is exposed but `BudgetDecisionService`
  uses `listAll` + in-memory filtering instead. Consumers should not rely
  on the scoped list for decision-time evaluation.
