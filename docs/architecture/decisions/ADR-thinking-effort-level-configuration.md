# ADR: Thinking/Effort Level Configuration

**Status:** Accepted  
**Date:** 2026-06-28  
**Decision Drivers:** Extended-reasoning model support (Claude 3.5 Sonnet+), agent-profile customization, cost optimization

---

## Context

The Nexus Orchestrator runtime contracts defined a `ContainerAgentRequest.thinkingLevel` field to support models with extended reasoning capabilities (e.g., Claude with streaming thinking). However:

1. No configuration UI existed to set the thinking level at any layer.
2. The field was never populated at runtime — agents always defaulted to model built-ins.
3. Advanced agents (reasoning, research, complex debugging) had no way to request deeper reasoning.
4. Cost pressure and latency constraints demanded model-aware level selection.

---

## Decision

Implement a **3-layer precedence model** for thinking/effort level configuration, mirroring the existing AI config precedence:

### D1: 3-Layer Precedence

Thinking level resolves in this order:

1. **Step override** (`steps[].inputs.thinking_level`) — highest precedence
2. **Agent profile** (`agent_profiles.thinking_level`) — middle tier
3. **Per-model default** (`llm_models.default_thinking_level`) — lowest tier
4. **Omit** — no thinking level specified; model uses its built-in default

### D2: Explicit `default_thinking_level` Column

Add a `default_thinking_level varchar(20) null` column to `llm_models` table:

- Stores a single default per model, shared across all use cases (e.g., `claude-opus-4-8` always defaults to `medium` when not overridden).
- Supports 6 discrete levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- Nullable; `null` means "no configured default, use model built-in."

### D3: Capability-Aware Clamping

The resolved thinking level is **clamped to the model's supported range** at dispatch time:

- Query the pi SDK's `getSupportedThinkingLevels()` for the resolved model.
- If unavailable, fall back to the DB's `thinkingLevelMap` (a JSON blob on `llm_models`).
- Clamp using "round down to nearest supported level" strategy: `off` → `off`, `minimal` → `off|minimal`, etc.
- **Exception**: `off` is never clamped upward (preserve user's explicit opt-out).

### D4: Clamp Precedence

The clamping logic applies **after** all three tiers resolve. The final clamped value is what the agent sees — no runtime errors on unsupported levels.

### D5: Dispatch Integration

Two dispatch paths wire the resolved thinking level:

1. **Workflow step execution** (`StepAgentStepExecutor`) — resolves and passes to `ContainerAgentRequest.thinkingLevel`.
2. **Chat session / direct execution** (`ExecutionDispatchService`) — resolves and passes to container config.

### D6: Web UI Integration

- **Agent Profiles editor**: dropdown (6 levels + omit option) to set `agent_profiles.thinking_level`.
- **Model editor**: dropdown (6 levels + omit option) to set `llm_models.default_thinking_level`.

### D7: Capability Source

The pi SDK (`@earendil-works/pi-ai`) is the authoritative source for supported thinking levels via `getSupportedThinkingLevels()`. The DB fallback (`thinkingLevelMap`) is populated only for models not in the pi registry.

---

## Consequences

### Positive

- **Backward compatible**: Omitted thinking level → model uses built-in; no breaking changes.
- **Flexible**: Agent profiles can set defaults; individual steps can override.
- **Cost-aware**: Teams can configure cheaper models with `off` by default; researchers can use `high` as profile default.
- **Safe clamping**: Never fails; always produces a valid level for the target model.

### Negative

- **Per-model granularity only**: The default is single-value, not per-use-case. A research model defaults to the same thinking level for both exploration and verification tasks. **Mitigation**: step-level overrides are cheap; prompt/skill-guided differentiation is an option.
- **No workflow-level or scope-level defaults**: Thinking level doesn't propagate from workflow metadata. Future scope-level or workflow-level defaults would require schema extension (low priority).

### Neutral

- **DB schema migration** required: two new columns. Applies on next startup.
- **No harness rebuild** required: `ContainerAgentRequest.thinkingLevel` already exists end-to-end; only the population logic is new.

---

## Related Decisions

- **D2 (default_thinking_level)**: Aligns with existing per-model configurations (`token_limits`, `cost_per_1k_tokens`).
- **D3–4 (clamping)**: Follows the "fail gracefully, clamp, never error" philosophy of model selection.
- **D7 (pi SDK as source)**: Maintains pi SDK as the canonical registry; DB serves as fallback for custom/unlisted models.

---

## Implementation Notes

- The runtime contract is already wired; this decision **populates** the currently-unused field.
- Web UI dropdowns use the 6 fixed levels (no free-text entry).
- Migration script: set `default_thinking_level = null` for all existing rows; seed reasoning-capable models with `medium` or `high` post-merge.
- Future: add thinking level to scope/workflow metadata if teams request multi-task workflows with different reasoning budgets.
