# 37 - Cost Governance

The Cost Governance system tracks AI spend, enforces budget limits, and provides spend visibility across all AI operations (workflow steps, chat turns, subagent spawns, tool calls). It integrates directly with workflow execution and chat sessions to evaluate actions before they consume resources.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CostGovernanceModule                    │
│                                                             │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │   BudgetDecisionService  │  │   CostEstimatorService   │ │
│  │                          │  │                          │ │
│  │  evaluateAction()        │  │  estimate()              │ │
│  │  → load relevant policies│  │  → resolve rate from     │ │
│  │  → estimate cost         │  │    LlmModel entity       │ │
│  │  → check limits          │  │  → compute token cost    │ │
│  │  → record decision       │  └──────────────────────────┘ │
│  └──────────────────────────┘                               │
│                                                             │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │   BudgetPolicyService    │  │   BudgetContextProvider  │ │
│  │                          │  │                          │ │
│  │  CRUD for policies       │  │  build() → agent prompt  │ │
│  │  scope-based queries     │  │  injects budget context  │ │
│  └──────────────────────────┘  └──────────────────────────┘ │
│                                                             │
│  ┌──────────────────────────────────────────────────────────┐│
│  │                 CostGovernanceController                  ││
│  │                                                          ││
│  │  POST  /cost-governance/policies     create policy        ││
│  │  GET   /cost-governance/policies     list all active      ││
│  │  GET   /cost-governance/policies/:id  get single          ││
│  │  PATCH /cost-governance/policies/:id  update              ││
│  │  DELETE /cost-governance/policies/:id disable (soft)      ││
│  │  POST  /cost-governance/evaluate     evaluate action      ││
│  │  POST  /cost-governance/usage        record usage         ││
│  │  GET   /cost-governance/usage        query usage events   ││
│  │  GET   /cost-governance/summary      aggregated spend     ││
│  │  GET   /cost-governance/decisions    query decisions      ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

The module is consumed by:

- **Workflow step execution** — evaluates cost before each step, records usage after
- **Chat session engine** — evaluates cost before each turn, records token usage
- **Subagent provisioning** — evaluates cost before spawning subagents
- **Agent runtime context** — `BudgetContextProvider` injects budget status into agent prompts

---

## Cost Rates

Cost rates define how much each AI model costs per token.

### Source of Truth: `LlmModel` entity

Cost rates live on the `llm_models` table as two nullable integer columns (cents per million tokens):

| Column                           | Type       | Description                    |
| -------------------------------- | ---------- | ------------------------------ |
| `input_token_cents_per_million`  | `integer?` | Cost per million input tokens  |
| `output_token_cents_per_million` | `integer?` | Cost per million output tokens |

These are managed alongside the model's other properties (name, provider, token limit, default roles) via the existing **Models** page in the Web UI (`/models`). Each model form has numeric "Input Cost" and "Output Cost" fields in cents-per-million-tokens.

### CostEstimationService

```
CostEstimateInput → CostEstimatorService.estimate()
    → resolve the LlmModel row by provider + name (case-insensitive),
      falling back to name-only when no provider is supplied
    → if model has both rates: compute (tokens × centsPerMillion) / 1,000,000
    → return { estimatedCents, estimateSource: 'model_rate', rateMatched, modelId }
    → if no rate: return { estimatedCents: null, estimateSource: 'unknown', modelId }
```

Cost calculation: `Math.ceil((inputTokens × inputRate + outputTokens × outputRate) / 1,000,000)`.

**Resolution is by `(provider_name, model_name)`, not name alone.** Provider and
model strings recorded on usage events are not normalised (e.g. `deepseek` vs the
configured `DeepSeek`), so matching is case-insensitive, and including the
provider disambiguates the case where the same model name is configured under
multiple providers with different costs. The resolved `llm_models.id` is returned
as `modelId` and persisted on the usage event, so each event is auditable back to
the exact priced row regardless of later renames or re-pricing.

A model **must have both** `input_token_cents_per_million` and `output_token_cents_per_million` set (non-null) to be used for cost estimation. Partial rates are treated as "unknown" and will not generate cost estimates.

---

## Budget Policies

Policies define spending rules scoped to specific resources, providers, or models.

### Policy Entity (`budget_policies` table)

| Column             | Type           | Description                                                                 |
| ------------------ | -------------- | --------------------------------------------------------------------------- |
| `id`               | `uuid`         | Primary key                                                                 |
| `name`             | `varchar(255)` | Human-readable label                                                        |
| `scope_type`       | `varchar(64)`  | Global, scope, context, workflow_definition, agent_profile, provider, model |
| `scope_id`         | `varchar?`     | Target scope identifier (project ID, etc.)                                  |
| `context_type`     | `varchar(64)?` | Filter by `workflow_run` or `chat_session`                                  |
| `context_id`       | `varchar?`     | Filter by specific run or session ID                                        |
| `provider_name`    | `varchar?`     | Filter by LLM provider name                                                 |
| `model_name`       | `varchar?`     | Filter by LLM model name                                                    |
| `soft_limit_cents` | `integer?`     | Soft budget ceiling (enforcement mode applied)                              |
| `hard_limit_cents` | `integer?`     | Hard budget ceiling (always results in `deny`)                              |
| `token_limit`      | `integer?`     | Maximum tokens per action                                                   |
| `window`           | `varchar(32)`  | Reset window: per_run, daily, weekly, monthly, rolling                      |
| `enforcement_mode` | `varchar(32)`  | observe, warn, approval_required, block                                     |
| `is_active`        | `boolean`      | Soft delete via disable                                                     |

### Scope Matching

When evaluating an action, policies are filtered by the intersection of:

1. `scope_id` — matches the action's scope (or null = matches all)
2. `context_type` — matches the action's context type (or null = matches all)
3. `context_id` — matches the action's context ID (or null = matches all)
4. `provider_name` — matches the action's provider (or null = matches all)
5. `model_name` — matches the action's model (or null = matches all)

Only policies that match on all non-null filter fields are considered.

### Enforcement Modes

| Mode                | Behavior                                                  |
| ------------------- | --------------------------------------------------------- |
| `observe`           | Log only, never blocks. Outcome: `allow`                  |
| `warn`              | Log warning, do not block. Outcome: `warn`                |
| `approval_required` | Block until manual approval. Outcome: `approval_required` |
| `block`             | Deny the action immediately. Outcome: `deny`              |

### Limit Types

- **Token limit** — if `expectedTokens > token_limit`, the enforcement mode is applied
- **Hard limit** — if `currentSpend + estimatedCost > hard_limit_cents`, outcome is always `deny`
- **Soft limit** — if `estimatedCost > soft_limit_cents`, the enforcement mode is applied

---

## Decision Engine

### `BudgetDecisionService.evaluateAction()`

```
evaluateAction(input)
  1. Load all active policies, filter by scope/provider/model match
  2. Estimate cost via CostEstimatorService
  3. Query current spend in window via BudgetUsageEventRepository.getSpendInWindow()
  4. Evaluate each matching policy:
     a. Check token limit → enforcement mode if exceeded
     b. Check hard limit → deny if exceeded (highest priority)
     c. Check soft limit → enforcement mode if exceeded
  5. Pick the strictest outcome (ranked: allow < warn < approval_required < throttle < block/deny)
  6. Record decision event in budget_decision_events table
  7. Return { decision, reasonCode, estimatedCostCents, remainingBudgetCents, approvalRequired }
```

### Decision Ranking

```
observe = allow (rank 0) < warn (rank 1) < approval_required (rank 2) < throttle (rank 3) < deny/block (rank 4)
```

The strictest outcome across all matching policies wins.

### Window Resolution

| Window    | Start Boundary         |
| --------- | ---------------------- |
| `per_run` | Epoch (all time)       |
| `daily`   | Midnight today         |
| `weekly`  | Monday of current week |
| `monthly` | 1st of current month   |
| `rolling` | 24 hours ago           |

---

## Usage Tracking

### `budget_usage_events` table

Records every token-consuming action after completion:

| Column                 | Type          | Description                                                              |
| ---------------------- | ------------- | ------------------------------------------------------------------------ |
| `correlation_id`       | `varchar?`    | Ties evaluate→usage pairs together                                       |
| `scope_id`             | `varchar?`    | Project/workflow scope                                                   |
| `context_type`         | `varchar(64)` | workflow_run or chat_session                                             |
| `context_id`           | `varchar`     | Specific run or session ID                                               |
| `actor_type`           | `varchar(64)` | user, agent, workflow, subagent, system                                  |
| `actor_id`             | `varchar?`    | Specific actor identifier                                                |
| `provider_name`        | `varchar?`    | LLM provider used                                                        |
| `model_name`           | `varchar?`    | LLM model used                                                           |
| `model_id`             | `uuid?`       | Resolved `llm_models.id` the cost was priced from (null when unresolved) |
| `input_tokens`         | `integer?`    | Input token count                                                        |
| `output_tokens`        | `integer?`    | Output token count                                                       |
| `total_tokens`         | `integer?`    | Combined token count                                                     |
| `estimated_cost_cents` | `integer?`    | Computed cost                                                            |
| `estimate_source`      | `varchar(64)` | model_rate, provider_usage, manual, unknown                              |

> **Token capture:** both the workflow-step path and the chat-turn path normalise
> the provider's raw `usage` object (via `resolveUsageTokens`) into real input,
> output, and total token counts before recording. An event with
> `estimate_source = 'unknown'` and no tokens means the cost could not be
> resolved — it is **not** a true $0.

### `budget_decision_events` table

Records every evaluation (the decision BEFORE the action executes):

| Column                   | Type          | Description                                                                                     |
| ------------------------ | ------------- | ----------------------------------------------------------------------------------------------- |
| `correlation_id`         | `varchar?`    | Links to usage event                                                                            |
| `policy_id`              | `uuid?`       | Which policy triggered the decision                                                             |
| `decision`               | `varchar(32)` | allow, warn, approval_required, throttle, deny                                                  |
| `reason_code`            | `varchar(64)` | within_budget, token_limit_exceeded, soft_limit_exceeded, hard_limit_exceeded, no_active_policy |
| `estimated_cost_cents`   | `integer?`    | Predicted cost                                                                                  |
| `remaining_budget_cents` | `integer?`    | Budget remaining after this action                                                              |
| `approval_request_id`    | `uuid?`       | Reference if approval was requested                                                             |

---

## Spend Summary

### `GET /cost-governance/summary`

Aggregates usage events into a summary table. Query parameters:

| Parameter  | Type                               | Description                               |
| ---------- | ---------------------------------- | ----------------------------------------- |
| `scope_id` | `string?`                          | Filter by scope                           |
| `group_by` | `provider\|model\|scope\|context?` | Dimension to aggregate by                 |
| `window`   | `daily\|weekly\|monthly?`          | Time window (not currently used in query) |
| `from`     | `datetime?`                        | Start of range                            |
| `to`       | `datetime?`                        | End of range                              |

Response is an array of `BudgetSummaryRow`:

```typescript
interface BudgetSummaryRow {
  key: string; // Grouped dimension value (e.g., "openai", "gpt-4")
  total_cents: string; // Sum of estimated_cost_cents
  total_tokens: string; // Sum of total_tokens
  count: string; // Count of usage events
  unpriced_count: string; // Count of events with no resolvable cost (estimated_cost_cents IS NULL)
}
```

Rows are ordered by `total_cents` descending. Ungrouped queries return a single "total" row.

---

## Web UI

### Budget Page (`/admin/budget-policies`)

A single page (`BudgetPage`) that splits spend and policy management into two top-level tabs. **Spend is the default tab.**

#### Spend tab (`BudgetSpendTab`)

Spend analytics scoped by a shared **date-range picker**, organized into two sub-tabs:

- **Overview** (`BudgetOverviewTab`) — KPI summary and spend charts (timeline, breakdown pie)
- **Usage Events** (`BudgetEventsTab`) — searchable raw usage-event table

#### Policies tab (`BudgetPoliciesTab`)

Full CRUD for budget policies:

- **Table** — Name, Scope, Scope Type, Enforcement, Window, Soft Limit, Hard Limit, Status
- **Create/Edit dialog** — PolicyForm with all fields
- **Disable** — Soft delete with confirmation dialog

### PolicyForm

Form fields:

- **Name** — text input
- **Scope Type** — select (Global, Scope, Context, Workflow Definition, Agent Profile, Provider, Model)
- **Scope ID** — text input (shown when scope type is not Global)
- **Context Type** — select (None, Workflow Run, Chat Session)
- **Context ID** — text input
- **Provider Name** — select dropdown populated from the database (`llm_providers`)
- **Model Name** — select dropdown populated from the database (`llm_models`), filtered by selected provider
- **Soft Limit (cents)** — number input
- **Hard Limit (cents)** — number input
- **Token Limit** — number input
- **Window** — select (Per Run, Daily, Weekly, Monthly, Rolling)
- **Enforcement Mode** — select (Warn, Block)
- **Active** — toggle switch

Provider and model dropdowns are DB-backed (live data from `llm_providers` and `llm_models`). Selecting a provider resets the model selection and filters the model dropdown to only show models from that provider.

### Budget Status Banner

`BudgetStatusBanner` component renders budget decision outcomes as colored alerts in the UI, visible during workflow execution and chat sessions.

### Navigation

A single entry appears in the sidebar under the "Administration" group:

- **Budget** → `/admin/budget-policies` (Spend and Policies tabs)

---

## Integration Points

### Workflow Step Execution

Before a step runs:

1. `BudgetDecisionService.evaluateAction()` is called with the step's scope, provider, model, and expected tokens
2. If the decision is `deny` or `approval_required`, execution is blocked/paused
3. After the step completes, `BudgetUsageEventRepository.recordUsage()` logs actual token usage

### Chat Sessions

Before each agent turn:

1. Budget policy evaluation runs against the chat session context
2. The `BudgetContextProvider` injects current budget status into the agent's system prompt
3. After the turn, token usage is recorded

### Subagent Spawning

Each `subagent_spawn` action type is evaluated against policies before the subagent is provisioned.

---

## Database Tables

| Table                    | Purpose                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `llm_models`             | Source of truth for cost rates (columns: `input_token_cents_per_million`, `output_token_cents_per_million`) |
| `budget_policies`        | Spending rules with scope, provider, model, and limit configuration                                         |
| `budget_usage_events`    | Records actual token consumption and cost after each action                                                 |
| `budget_decision_events` | Records pre-action evaluations and their outcomes                                                           |

---

## API Endpoints Summary

| Method   | Path                            | Purpose                          |
| -------- | ------------------------------- | -------------------------------- |
| `POST`   | `/cost-governance/policies`     | Create budget policy             |
| `GET`    | `/cost-governance/policies`     | List all active policies         |
| `GET`    | `/cost-governance/policies/:id` | Get single policy                |
| `PATCH`  | `/cost-governance/policies/:id` | Update policy                    |
| `DELETE` | `/cost-governance/policies/:id` | Disable policy (soft delete)     |
| `POST`   | `/cost-governance/evaluate`     | Evaluate action against policies |
| `POST`   | `/cost-governance/usage`        | Record usage event               |
| `GET`    | `/cost-governance/usage`        | Query usage events by context    |
| `GET`    | `/cost-governance/summary`      | Aggregated spend by dimension    |
| `GET`    | `/cost-governance/decisions`    | Query decision events            |

---

## Module Files

```
apps/api/src/cost-governance/
├── cost-governance.module.ts          # NestJS module declaration
├── cost-governance.controller.ts      # All REST endpoints
├── budget-policy.service.ts           # Policy CRUD service
├── budget-decision.service.ts         # Core decision engine
├── cost-estimator.service.ts          # Cost estimation from LlmModel rates
├── budget-context.provider.ts         # Agent prompt budget context
├── dto/
│   ├── budget-policy.dto.ts           # Zod schemas for policies
│   ├── budget-policy.dto.types.ts     # TS types for policies
│   ├── budget-query.dto.ts            # Zod schemas for query/evaluate/usage/summary
│   ├── budget-query.dto.types.ts      # TS types including BudgetSummaryRow
│   └── index.ts
├── types/
│   ├── budget-decision.types.ts       # EvaluateActionInput/Result, Policy types
│   ├── budget-scope.types.ts          # Union types (scope, enforcement, window, etc.)
│   ├── cost-estimate.types.ts         # RateInfo, CostEstimateInput/Result
│   └── index.ts
└── database/
    ├── entities/
    │   ├── budget-policy.entity.ts
    │   ├── budget-usage-event.entity.ts
    │   ├── budget-decision-event.entity.ts
    │   └── index.ts
    └── repositories/
        ├── budget-policy.repository.ts
        ├── budget-usage-event.repository.ts
        ├── budget-decision-event.repository.ts
        └── index.ts
```

```
apps/web/src/
├── pages/admin/
│   ├── BudgetPage.tsx                 # Consolidated page: Spend + Policies tabs
│   ├── BudgetPage.spec.tsx            # Page tab-composition tests
│   └── PolicyForm.tsx                 # Create/edit policy form
├── hooks/
│   ├── useBudgetPolicies.ts           # React Query hooks for policies
│   └── useBudgetSummary.ts            # React Query hook for spend summary
├── lib/api/
│   ├── client.budget.ts              # API client methods
│   └── client.budget.types.ts        # BudgetPolicy, BudgetSummaryRow types
└── components/budget/
    ├── BudgetSpendTab.tsx             # Spend tab (Overview + Usage Events)
    ├── BudgetPoliciesTab.tsx          # Policies tab (CRUD table + dialogs)
    ├── BudgetOverviewTab.tsx          # Spend overview sub-tab (KPIs + charts)
    ├── BudgetEventsTab.tsx            # Usage-events sub-tab
    └── BudgetStatusBanner.tsx         # Decision outcome banner
```
