# EPIC-199: Cost Tracking and Budget Governance

**Status:** Proposed
**Priority:** P1
**Created:** 2026-06-02
**Updated:** 2026-06-02
**Owner:** Platform Governance / Workflow Runtime
**Parent:** None
**Depends on:** EPIC-109 (Provider-Specific Capabilities), EPIC-115 (MCP Tool Governance Linkage and Granular Approval UX), EPIC-159 (Unified Tool Policy and Argument Governance)
**Related:** EPIC-033 (Observability Correlation Event Sourcing), EPIC-146 (Autonomy Audit and Observability), EPIC-165 (Autonomous Human Decision Policy and Continuous Orchestration)

## Summary

Introduce budget governance for AI-driven execution across chat sessions, workflow runs, agent dispatch, and provider-backed runtime actions. The first release prioritizes budget policy, alerts, approval gates, and auditable enforcement over invoice-grade cost attribution.

The system uses current usage signals where available, including token usage and provider rate-limit metadata, then normalizes them into governance decisions: allow, warn, require approval, throttle, or deny.

## Problem Statement

Nexus can launch autonomous agents, workflows, subagents, chat sessions, provider calls, and long-running orchestration loops without a first-class budget guardrail. Existing token spend fields are useful visibility hints, but they do not provide:

- explicit budgets by global, scope, workflow, session, agent, provider, or model context
- threshold warnings before an expensive action starts
- hard limits that stop or pause execution before runaway spend
- approval gates for high-cost actions
- audit events explaining why an action was allowed, delayed, or blocked
- budget-aware context for agents before they plan work
- user-facing budget status in the web UI

Without budget governance, autonomous execution can surprise operators, exhaust provider quotas, and make it hard to distinguish intentional high-cost work from uncontrolled loops.

## Goals

- Define budget policies with soft limits, hard limits, reset windows, and enforcement actions.
- Estimate cost impact before expensive runtime actions start.
- Record budget-relevant usage events for chat sessions, workflow runs, agent dispatch, subagent activity, and provider-backed execution.
- Surface budget state to agents so planning can account for remaining allowance.
- Add approval gates for actions expected to exceed configured thresholds.
- Emit auditable budget decision events with correlation IDs.
- Provide API and web UI surfaces for budget configuration, current spend, warnings, and enforcement history.
- Preserve API/core neutrality by using generic scope and context identifiers.

## Non-Goals

- Exact billing reconciliation with provider invoices in this epic.
- Full FinOps reporting across CPU, memory, storage, and infrastructure cost.
- Automatic purchase, top-up, or payment-provider integration.
- Replacing existing tool permission governance or approval systems.
- Provider-specific billing adapters for every model provider.
- Kanban-specific budget semantics inside API/core code.

## Current-State Baseline

This epic extends existing foundations rather than starting from zero.

### Existing Signals

- Kanban work items already carry `token_spend` and expose `tokenSpend` in kanban and web views.
- Workflow and chat execution already resolve provider and model settings before launching runtime containers.
- Provider transient-failure classification already extracts usage-limit metadata from some rate-limit failures.
- Runtime and workflow event flows already carry correlation context for execution diagnostics.
- Approval UX and tool governance epics provide a path for human-in-the-loop budget escalation.

### Gaps This Epic Closes

- Token spend is visible but not governed.
- Runtime launch paths do not ask whether budget policy permits the next action.
- Provider/model cost rates are not centrally modeled for estimation.
- Budget alerts and enforcement decisions are not durable audit records.
- Agents do not receive budget summaries in planning context.
- UI does not show budget health, remaining allowance, or blocked high-cost actions.

## Architecture

### Module Location

Add a dedicated API module:

```text
apps/api/src/cost-governance/
```

The module owns generic budget policy, cost estimation, budget decisioning, and audit events. It must not depend on kanban contracts or kanban domain identifiers.

Kanban-owned views and work-item projections may display or aggregate budget data through kanban-side adapters using neutral API identifiers.

### Directory Structure

```text
cost-governance/
  cost-governance.module.ts
  cost-governance.controller.ts
  budget-policy.service.ts
  budget-decision.service.ts
  cost-estimator.service.ts
  budget-context.provider.ts
  repositories/
    budget-policy.repository.ts
    budget-usage-event.repository.ts
    budget-decision-event.repository.ts
  entities/
    budget-policy.entity.ts
    budget-usage-event.entity.ts
    budget-decision-event.entity.ts
  dto/
    budget-policy.dto.ts
    budget-query.dto.ts
    budget-decision.dto.ts
  types/
    budget-scope.types.ts
    budget-decision.types.ts
    cost-estimate.types.ts
```

Shared request/response contracts that are consumed outside the API should live in `packages/core` with neutral names only.

### Data Model

#### `budget_policies`

One row per budget rule.

| Column             | Type                 | Description                                                                               |
| ------------------ | -------------------- | ----------------------------------------------------------------------------------------- |
| `id`               | UUID PK              | Budget policy identifier                                                                  |
| `name`             | varchar(255)         | Human-readable policy name                                                                |
| `scope_type`       | varchar(64)          | `global`, `scope`, `context`, `workflow_definition`, `agent_profile`, `provider`, `model` |
| `scope_id`         | varchar nullable     | Neutral owner identifier when scoped                                                      |
| `context_type`     | varchar(64) nullable | Optional runtime context type, such as `workflow_run` or `chat_session`                   |
| `context_id`       | varchar nullable     | Optional runtime context identifier                                                       |
| `provider_name`    | varchar nullable     | Optional provider filter                                                                  |
| `model_name`       | varchar nullable     | Optional model filter                                                                     |
| `soft_limit_cents` | integer nullable     | Warning threshold for estimated spend                                                     |
| `hard_limit_cents` | integer nullable     | Blocking threshold for estimated spend                                                    |
| `token_limit`      | integer nullable     | Optional token-based budget when money estimate is unavailable                            |
| `window`           | varchar(32)          | `per_run`, `daily`, `weekly`, `monthly`, `rolling`                                        |
| `enforcement_mode` | varchar(32)          | `observe`, `warn`, `approval_required`, `block`                                           |
| `is_active`        | boolean              | Whether the policy is enforced                                                            |
| `created_at`       | timestamp            | Creation time                                                                             |
| `updated_at`       | timestamp            | Last update time                                                                          |

#### `budget_usage_events`

Append-only usage events used for budget evaluation and historical visibility.

| Column                 | Type             | Description                                         |
| ---------------------- | ---------------- | --------------------------------------------------- |
| `id`                   | UUID PK          | Usage event identifier                              |
| `correlation_id`       | varchar nullable | Trace/workflow/session correlation identifier       |
| `scope_id`             | varchar nullable | Neutral scope identifier                            |
| `context_type`         | varchar(64)      | Runtime context type                                |
| `context_id`           | varchar          | Runtime context identifier                          |
| `actor_type`           | varchar(64)      | `user`, `agent`, `workflow`, `subagent`, `system`   |
| `actor_id`             | varchar nullable | Actor identifier when known                         |
| `provider_name`        | varchar nullable | Provider used for the action                        |
| `model_name`           | varchar nullable | Model used for the action                           |
| `input_tokens`         | integer nullable | Prompt/input tokens                                 |
| `output_tokens`        | integer nullable | Completion/output tokens                            |
| `total_tokens`         | integer nullable | Total tokens                                        |
| `estimated_cost_cents` | integer nullable | Estimated cost in cents                             |
| `estimate_source`      | varchar(64)      | `model_rate`, `provider_usage`, `manual`, `unknown` |
| `metadata`             | JSONB            | Non-sensitive diagnostic details                    |
| `created_at`           | timestamp        | Event time                                          |

#### `budget_decision_events`

Append-only audit log of budget checks.

| Column                   | Type             | Description                                                                                       |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| `id`                     | UUID PK          | Decision event identifier                                                                         |
| `correlation_id`         | varchar nullable | Trace/workflow/session correlation identifier                                                     |
| `policy_id`              | UUID nullable    | Matching policy, when applicable                                                                  |
| `scope_id`               | varchar nullable | Neutral scope identifier                                                                          |
| `context_type`           | varchar(64)      | Runtime context type                                                                              |
| `context_id`             | varchar          | Runtime context identifier                                                                        |
| `action_type`            | varchar(64)      | `chat_turn`, `workflow_launch`, `step_execution`, `agent_dispatch`, `subagent_spawn`, `tool_call` |
| `decision`               | varchar(32)      | `allow`, `warn`, `approval_required`, `throttle`, `deny`                                          |
| `reason_code`            | varchar(64)      | Stable machine-readable reason                                                                    |
| `estimated_cost_cents`   | integer nullable | Cost estimate evaluated                                                                           |
| `remaining_budget_cents` | integer nullable | Remaining budget after estimate                                                                   |
| `approval_request_id`    | UUID nullable    | Linked approval request when escalation is required                                               |
| `metadata`               | JSONB            | Non-sensitive diagnostic details                                                                  |
| `created_at`             | timestamp        | Decision time                                                                                     |

### Model Rate Configuration

Add provider/model rate configuration so estimates can be made before a provider response exists.

Rates may be stored in the existing AI configuration area or in a `model_cost_rates` table owned by cost governance.

Proposed fields:

| Field                            | Description                         |
| -------------------------------- | ----------------------------------- |
| `provider_name`                  | Provider identifier                 |
| `model_name`                     | Model identifier                    |
| `input_token_cents_per_million`  | Estimated input-token price         |
| `output_token_cents_per_million` | Estimated output-token price        |
| `effective_from`                 | Start of rate validity              |
| `is_active`                      | Whether this rate is currently used |

Rates are estimates for governance, not billing truth.

## Budget Decision Flow

### Preflight

Before expensive actions, callers ask `BudgetDecisionService.evaluateAction(...)` with:

- neutral scope/context identifiers
- action type
- actor type and actor identifier
- provider/model candidate
- expected token estimate or configured default
- correlation identifier

The service resolves active policies by precedence, estimates cost, and returns:

- `allow` when under all relevant limits
- `warn` when soft thresholds are crossed but execution may continue
- `approval_required` when policy requires human confirmation
- `throttle` when execution should pause until the next budget window
- `deny` when a hard limit has been reached

### Runtime Recording

After execution completes, runtime paths record actual usage where known. If precise token data is unavailable, the event records the estimate source as `unknown` or uses the preflight estimate with metadata indicating that it was not provider-confirmed.

### Policy Precedence

Budget policy resolution is deterministic:

1. context-specific policy
2. scope-specific policy
3. workflow-definition policy
4. agent-profile policy
5. provider/model policy
6. global policy

The most restrictive applicable decision wins. `block` overrides `approval_required`, which overrides `warn`, which overrides `observe`.

## Enforcement Points

Budget preflight should be integrated at these runtime boundaries:

- chat turn execution before launching a provider-backed agent call
- workflow launch before enqueueing the first run job
- workflow step execution before launching a runtime container
- subagent spawn before allocating a child agent session
- high-risk tool calls through the existing tool governance path
- automatic retry scheduling when a retry would consume additional budget

Budget checks should fail closed only when an active policy is configured to `block`. Missing cost rates should not block by default unless the policy explicitly requires known estimates.

## Agent Context Integration

Add a budget context provider for chat and workflow planning contexts that formats:

- active budget policy names
- current window spend
- remaining allowance
- soft and hard thresholds
- current enforcement mode
- recent budget warnings or denials
- instructions for requesting approval when needed

The context block should be concise and non-sensitive. It should not expose provider secrets or raw billing credentials.

## API Surface

Proposed API endpoints on the API service:

| Method   | Path                            | Description                                            |
| -------- | ------------------------------- | ------------------------------------------------------ |
| `POST`   | `/cost-governance/policies`     | Create budget policy                                   |
| `GET`    | `/cost-governance/policies`     | List budget policies                                   |
| `GET`    | `/cost-governance/policies/:id` | Get budget policy                                      |
| `PATCH`  | `/cost-governance/policies/:id` | Update budget policy                                   |
| `DELETE` | `/cost-governance/policies/:id` | Disable or delete budget policy                        |
| `POST`   | `/cost-governance/evaluate`     | Evaluate a proposed runtime action                     |
| `GET`    | `/cost-governance/usage`        | Query usage events                                     |
| `GET`    | `/cost-governance/decisions`    | Query budget decision events                           |
| `GET`    | `/cost-governance/summary`      | Current budget summary by scope/context/provider/model |
| `POST`   | `/cost-governance/model-rates`  | Configure provider/model cost rates                    |
| `GET`    | `/cost-governance/model-rates`  | List configured provider/model cost rates              |

Controllers validate transport only. Services own policy resolution, estimation, and enforcement decisions. Repositories own persistence.

## Web UI Scope

Add budget governance UI under settings and runtime views.

### Settings

- Create, edit, disable, and list budget policies.
- Configure provider/model estimated rates.
- Show policy precedence and enforcement mode.

### Runtime Views

- Show current budget health on chat sessions and workflow run detail pages.
- Show warnings when a session, workflow, provider, or model approaches limits.
- Show why a workflow/action was blocked or requires approval.
- Link decision events to existing workflow/session timelines where correlation data exists.

### Kanban Views

- Continue displaying token spend where useful.
- Add kanban-owned budget summary projections only through neutral API budget summaries.
- Keep work-item lifecycle and status logic in the kanban service.

## Error Handling

- Missing model rate: estimate source is `unknown`; enforce only policies that allow unknown estimates or explicitly block unknown estimates.
- Budget repository failure during preflight: fail open for `observe` and `warn`, fail closed for `block` only if the policy decision can be resolved from cached data.
- Approval service unavailable: return `approval_required` with a failure reason and do not launch the action.
- Usage recording failure after execution: log an operational warning and emit a retryable persistence event; do not mark execution failed solely because cost recording failed.
- Invalid policy configuration: reject at API boundary with explicit validation errors.

## Security and Privacy

- Do not store provider credentials or raw API keys in budget metadata.
- Avoid logging prompt text, completion text, tool arguments, or user secrets in budget events.
- Restrict budget policy mutation to administrative roles.
- Treat budget decision events as operational audit data.
- Redact metadata fields that may contain provider-specific sensitive headers.

## Implementation Phases

### Phase 1: Foundation and Contracts

- Define budget scope, policy, estimate, and decision types.
- Add Zod DTO validation for budget policy and decision requests.
- Add repository interfaces and entity schemas.
- Add migrations for policy, usage event, and decision event storage.
- Add unit tests for policy validation and precedence.

### Phase 2: Estimation and Usage Ledger

- Add provider/model cost rate configuration.
- Implement token-to-cost estimation.
- Record budget usage events from chat execution and workflow step execution.
- Preserve current token spend displays while making budget usage events the governance source.
- Add tests for known, unknown, and stale model-rate scenarios.

### Phase 3: Budget Decision Service

- Implement active policy resolution.
- Implement soft limit, hard limit, reset window, and enforcement-mode behavior.
- Persist budget decision events.
- Add deterministic tests for precedence and most-restrictive decision wins.

### Phase 4: Runtime Enforcement

- Add preflight checks to chat execution, workflow launch, workflow step execution, subagent spawn, and retry scheduling.
- Integrate `approval_required` decisions with existing approval governance.
- Ensure blocked actions produce user-readable runtime notices.
- Add integration tests for allowed, warned, approval-required, throttled, and denied execution.

### Phase 5: Agent Context and Observability

- Add budget context provider for chat and workflow planning.
- Emit budget governance telemetry with correlation IDs.
- Add timeline/event rendering hooks for budget decisions.
- Add tests for context formatting and graceful degradation.

### Phase 6: Web UI

- Add budget policy administration UI.
- Add provider/model rate settings UI.
- Add budget summary panels to chat session and workflow run pages.
- Add budget decision detail views linked from runtime notices.
- Add web unit tests for summary formatting, threshold states, and blocked-action notices.

### Phase 7: Kanban Projection Integration

- Add kanban-owned budget summary projection where project/work-item views need cost context.
- Map kanban domain identifiers to neutral budget query identifiers outside API/core.
- Keep kanban token spend display compatible with budget summaries.
- Add kanban-owned tests for budget summary display and projection behavior.

## Acceptance Criteria

- Budget policies can be created, updated, listed, disabled, and queried.
- Policies support soft limits, hard limits, token limits, reset windows, enforcement modes, provider/model filters, and neutral scope/context targeting.
- Runtime budget preflight returns deterministic `allow`, `warn`, `approval_required`, `throttle`, or `deny` decisions.
- The most restrictive applicable budget policy wins according to documented precedence.
- Chat execution, workflow launch, workflow step execution, subagent spawn, and retry scheduling consult budget governance before consuming additional provider-backed budget.
- Usage events are recorded with correlation IDs and non-sensitive metadata.
- Decision events explain which policy applied, what decision was made, and why.
- Approval-required budget decisions integrate with the existing approval path.
- Agents receive a concise budget context summary during planning.
- Web UI exposes policy management, model-rate configuration, budget summaries, and blocked-action explanations.
- Existing token spend displays continue to work.
- API/core code uses neutral scope/context identifiers and does not import kanban contracts.
- Unit and integration tests cover policy validation, cost estimation, decision precedence, enforcement points, approval escalation, and UI state rendering.

## Risks and Mitigations

| Risk                                                 | Mitigation                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Estimates differ from provider invoices              | Document estimates as governance signals; defer invoice reconciliation to future work.                   |
| Missing model rates reduce enforcement confidence    | Support token limits and explicit unknown-estimate policy behavior.                                      |
| Budget checks add runtime latency                    | Keep evaluation local and cache active policy summaries safely.                                          |
| Overly strict policies block useful autonomous work  | Start with `observe` and `warn` rollout modes before enabling `block`.                                   |
| Approval gates create deadlocks for autonomous loops | Return clear budget context and runtime notices so agents know how to request approval or reduce scope.  |
| Domain coupling leaks into API/core                  | Use neutral identifiers in API/core and implement kanban-specific projections only in kanban-owned code. |

## Rollout Plan

1. Ship policy and ledger in observe-only mode.
2. Enable warnings for selected providers/models and high-cost workflows.
3. Enable approval-required policies for expensive actions.
4. Enable block policies only after operators confirm summaries and event history are reliable.
5. Add kanban projections after the neutral governance API is stable.

## Future Work

- Provider invoice reconciliation and billing export.
- Infrastructure/runtime cost attribution for containers and runner tiers.
- Per-user or team-level chargeback reporting.
- Adaptive budget recommendations based on historical usage.
- Budget-aware workflow planning heuristics.
- Scheduled budget reports and anomaly detection.
- Plugin-contributed provider/model cost-rate adapters.
