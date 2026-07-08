# ADR-0029: Fallback Models and Providers

## Status

Accepted

## Date

2026-06-29

## Context

AI provider outages and transient failures are unavoidable in production. When an LLM provider (OpenAI, Anthropic, etc.) experiences an outage, rate limits, or billing issues, a workflow step fails and the entire job halts. Users and operators need a way to:

1. Automatically retry failed requests against different providers or models without manual intervention
2. Maintain service continuity despite individual provider unavailability
3. Manage provider capacity and costs by distributing load across multiple providers
4. Route around known provider issues with operator-controlled cooldown periods

The system previously offered no fallback mechanism: a single provider failure meant job failure.

## Decision

Implement a **layered provider/model fallback chain** system with per-provider cooldown tracking and deterministic chain resolution.

### Chain Structure and Precedence

A **fallback chain** is an ordered list of `(provider, model)` tuples to try in sequence when the primary choice fails. Chains are resolved through three layers:

```
Tier 1: Step inline         →  steps[].inputs.fallback_chain
Tier 2: Agent profile       →  agent_profiles.fallback_chain
Tier 3: Global default      →  fallback_chains (enabled) → empty (disabled)
```

Within each chain entry:

- Provider is mandatory
- Model is optional; if unspecified, the provider's default model is used

### Failure Classification and Cooldown

Failures are classified into three categories:

| Category  | Trigger                                  | Cooldown | Retry? |
| --------- | ---------------------------------------- | -------- | ------ |
| Outage    | 5xx, 529, service unavailable            | 2 min    | Yes    |
| Terminal  | 401 (auth), 403 (billing), 4xx (invalid) | 30 min   | No     |
| Transient | 429 (rate limit)                         | None     | Same   |

- **Outage**: Provider is temporarily down; retry against the next chain entry.
- **Terminal**: Request is invalid or credentials are exhausted; do not advance the chain (retry the same provider later).
- **Transient** (429 rate limit): Retry immediately against the same provider without advancing the chain.

### Per-Provider System-Global Cooldown Registry

The `provider_cooldowns` table tracks the last failure time and cooldown window for each provider (system-wide):

```typescript
{
  provider_name: 'openai',
  failed_at: '2026-06-29T10:15:00Z',
  cooled_until: '2026-06-29T10:17:00Z',  // Current time + cooldown duration
  failure_reason: '500 Internal Server Error'
}
```

When a provider fails:

1. The failure is classified (outage/terminal/transient)
2. If outage or terminal, `provider_cooldowns` is inserted/updated with `cooled_until = now + cooldown_ms`
3. On the next step execution, `selectViableEntry` checks if the provider has an active cooldown
4. Cooled providers are skipped; the chain advances to the next entry
5. When `cooled_until` is reached, the entry is automatically deleted (or ignored), making the provider available again

### Chain Resolution and Requeue Flow

On step failure (outage or terminal):

1. `maybeAdvanceFallback` reads `fallback_chains.enabled` (global on/off switch)
2. Call `FallbackChainResolverService.selectViableEntry()` to find the next (provider, model) pair:
   - Read the chain in priority order (step inline → profile → global)
   - Skip entries whose provider is actively cooled
   - Return the first viable entry, or `null` if none remain
3. If viable entry found: emit a `fallback_advanced` event and requeue the job with the new provider/model
4. If no viable entry (all cooled or chain exhausted): emit `fallback_exhausted` event and terminate

### Single Source of Truth

`FallbackChainResolverService` is the sole authority for provider/model resolution. It:

- Reads chain configuration from three tiers
- Deduplicates consecutive identical (provider, model) pairs
- Checks cooldown status against `provider_cooldowns`
- Handles edge cases (empty chains, all cooled, primary prepended)

### UI and Configuration

Operators configure fallback chains via:

- **Settings > AI Configuration > Fallback Chains**: Edit the global default chain (empty by default)
- **Agent Profile Editor**: Per-profile override (optional JSONB `fallback_chain` column)
- **Workflow YAML**: Step-level override via `inputs.fallback_chain`
- **Settings > Provider Cooldowns**: Read-only panel showing active cooldowns and auto-recovery times

## Consequences

### Positive

1. **High availability**: Jobs automatically continue on provider outages; users see transient failures recovered transparently.
2. **Load distribution**: Operators can configure multiple providers for each step, spreading risk and cost.
3. **Operator control**: Cooldowns are observable and tunable; failed providers are automatically available again after the cooldown window.
4. **Deterministic termination**: Chain length and cooldown logic bound retries (no unbounded exponential backoff).
5. **Backwards compatible**: Chains are optional; existing workflows without chains use only the primary provider.

### Trade-offs / Limitations

1. **Configuration complexity**: Three-tier precedence (step inline → profile → global) requires understanding which layer wins; misconfiguration can lead to unexpected fallbacks.
2. **No semantic awareness**: The system cannot know if a provider is partially degraded (e.g., high latency but working). It classifies only on error codes, so a flaky provider may consume cooldown windows unnecessarily.
3. **Per-provider, not per-provider-model**: Cooldowns are at the provider level. If OpenAI's GPT-4 is down but GPT-3.5 works, both are cooled (though a model-level override in a chain entry allows working around this).
4. **Silent fallback**: By default, fallback events are logged but not surfaced to users. Operators must check logs or the cooldown panel to diagnose provider failures and fallback activity.
5. **Retry budget**: The system relies on cooldown-driven natural termination. If all chain entries are cooled simultaneously, the job terminates. Operators must ensure chain length and cooldown windows are balanced to avoid premature termination under high concurrency.

## Alternatives Considered

### 1. Single Failover Model (Rejected)

A single static failover (e.g., always fall back to Anthropic if OpenAI fails) was rejected because:

- Insufficient for multi-provider deployments where load distribution is desired
- Inflexible: no operator control over order or cooldown windows
- Does not scale to more than two providers

### 2. User-Defined Retry Logic (Rejected)

Embedding retry logic in workflow steps (e.g., `on_failure: retry_with_provider`) was rejected because:

- Violates the workflow-engine boundary: retry policy is a runtime concern, not workflow authoring
- Increases workflow complexity and maintenance burden
- Cannot share retry state or cooldown information across steps

### 3. Exponential Backoff without Cooldown Registry (Rejected)

Retry with exponential backoff per job (e.g., 2s, 4s, 8s) was rejected because:

- Does not respect system-wide provider state; concurrent jobs re-hammer a downed provider
- Leads to token waste and longer job times
- Provides no operator observability or control

## References

- Design spec: [`docs/SDD.md`](../SDD.md) — Fallback Models/Providers Feature
- Implementation tasks: Task 1–15 (feature branch: `feature+fallback-models-providers`)
- Service: `FallbackChainResolverService` — Chain resolution and provider selection
- Service: `ProviderFallbackService` — Failure classification and cooldown management
- Database: `provider_cooldowns` table — Per-provider cooldown registry
- Database: `fallback_chains` table — Global default chain configuration
- Database: `agent_profiles.fallback_chain` column — Per-profile chain override
- UI: Settings > AI Configuration > Fallback Chains
- UI: Settings > Provider Cooldowns (read-only)
- UI: Agent Profile Editor — fallback_chain JSONB field
