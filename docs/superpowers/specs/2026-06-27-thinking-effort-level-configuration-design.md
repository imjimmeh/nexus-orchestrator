# Design: Configurable Thinking / Effort Levels for Models

- **Date:** 2026-06-27
- **Status:** Approved (design); pending spec review
- **Author:** orchestration session (debugging run 25700077 surfaced the gap)

## 1. Context & Problem

LLM models in Nexus Orchestrator can run with a provider-specific reasoning
"thinking level" (Anthropic extended thinking) / "reasoning effort"
(OpenAI-style). The runtime contract for this already exists end-to-end:

- `RunnerThinkingLevel` enum — `packages/core/src/interfaces/runner-config.types.ts:3`
  (`off | minimal | low | medium | high | xhigh`).
- `HarnessModelConfig.thinkingLevel` — `packages/core/src/interfaces/harness-runtime-config.types.ts:18`.
- `ContainerAgentRequest.thinkingLevel` — `apps/api/src/docker/container-http-client.service.types.ts:13`.
- Per-provider capability map `RunnerProviderModelConfig.thinkingLevelMap` —
  `packages/core/src/interfaces/runner-config.types.ts:68` (maps each level to a
  provider model id, or `null` when unsupported).
- **The pi coding agent SDK (`@earendil-works/pi-ai`) is the authoritative model
  catalog.** It exports `getModels(provider)` / `getModel(provider, id)`,
  `getSupportedThinkingLevels(model): ModelThinkingLevel[]`, and
  `clampThinkingLevel(model, level)` (`node_modules/@earendil-works/pi-ai/dist/models.d.ts:6-11`).
  Its `ModelThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh"`
  is identical to our `RunnerThinkingLevel`. The existing
  `GET /ai-config/models/presets` endpoint already calls `getModels` but **drops**
  the thinking-level data (`ai-config-admin.service.ts:132-159`).

**The gap:** nothing ever _populates_ `thinkingLevel`. `assembleBaseRunnerConfig`
(`apps/api/src/workflow/workflow-step-execution/step-agent-step-executor.helpers.ts:224`)
builds `model` without it, so every run dispatches with `thinkingLevel`
undefined and the harness falls back to its built-in default (observed live:
session `f519b615` ran with thinking `off`, invisible to the operator).

There is no way for a user to configure thinking level at any layer.

## 2. Goals

Let users configure thinking/effort level for agent execution, resolved through
a precedence chain, with the value safely adapted to whatever model actually
runs.

### In scope

- Per-model default thinking level (the floor).
- Agent-profile thinking level.
- Per-step thinking level (`steps[].inputs.thinking_level`).
- Runtime resolution + clamping wired into **both** agent dispatch paths
  (workflow step and chat/session).
- **Per-model supported thinking levels sourced from the pi SDK** and exposed to
  the web UI so the model picker only offers levels the model actually supports.
- Web UI controls for the per-model default and the agent-profile level.
- Telemetry for resolved / clamped / dropped decisions.

### Out of scope (explicitly dropped during brainstorming)

- Workflow-wide default layer (only per-step).
- Scope-node / project default layer (`ScopedConfigResolver`).
- Per-use-case defaults (execution / distillation / summarization / session) —
  the per-model default is a **single** value used whenever the model runs.

## 3. Key Decisions

| #   | Decision                                                                                                                                                                 | Rationale                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Precedence (highest wins): **step input → agent profile → per-model default → omit**                                                                                     | Mirrors the existing model/provider chain; "omit" preserves today's behavior (full backward compatibility).                                                                                                                                          |
| D2  | Per-model default stored as an **explicit `default_thinking_level` column on `llm_models`** (Approach A)                                                                 | Matches existing `default_for_*` / `supports_vision` column pattern; keeps _policy_ (default) separate from _capability_ (`thinkingLevelMap`); trivial to expose in the model editor.                                                                |
| D3  | Capability mismatch → **clamp to nearest supported level**                                                                                                               | A stale or model-agnostic config never hard-fails a run.                                                                                                                                                                                             |
| D4  | Clamp tie-break → **round down (more conservative)**                                                                                                                     | When a requested level is equidistant between two supported levels, prefer the lower-cost / lower-latency option.                                                                                                                                    |
| D5  | Reuse the existing 6-value `RunnerThinkingLevel` scale; treat "thinking level" and "effort level" as one unified concept                                                 | The per-provider `thinkingLevelMap` already translates the unified scale into provider-native semantics.                                                                                                                                             |
| D6  | Resolution emits a telemetry record when a value is **clamped or dropped**                                                                                               | Answers "why did my run use level X" — the visibility gap from the originating incident.                                                                                                                                                             |
| D7  | **Per-model supported levels come from the pi SDK** (`getSupportedThinkingLevels`), falling back to DB `thinkingLevelMap` non-null keys for non-catalog/custom providers | The pi SDK is the authoritative catalog and what actually runs the model; the UI picker and the runtime clamp share this single supported-set source. Clamp tie-break stays our pure core helper (D4) so behavior is deterministic across harnesses. |

## 4. Data Model & Contracts

### 4.1 `packages/core` (single source of truth)

Reuse `RunnerThinkingLevel`. Add an ordered scale + pure helpers (no IO),
co-located with the enum or in a new `thinking-level.helpers.ts`:

```ts
export const THINKING_LEVEL_ORDER: readonly RunnerThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

/** Validate an arbitrary value (template result, DB string) against the enum. */
export function parseThinkingLevel(
  value: unknown,
): RunnerThinkingLevel | undefined;

/**
 * Clamp `requested` to the nearest level in `supported` (ordinal distance,
 * ties round DOWN). `requested === "off"` always returns "off" (never clamped
 * up). Returns undefined when `supported` is empty (model has no thinking
 * support) so the caller omits the field.
 */
export function clampThinkingLevel(
  requested: RunnerThinkingLevel,
  supported: readonly RunnerThinkingLevel[],
): RunnerThinkingLevel | undefined;

/** First-defined wins. Returns undefined when no layer specifies a value. */
export function resolveThinkingLevel(layers: {
  stepInput?: RunnerThinkingLevel;
  agentProfile?: RunnerThinkingLevel;
  modelDefault?: RunnerThinkingLevel;
}): RunnerThinkingLevel | undefined;
```

**Supported-set derivation** is owned by the `ThinkingLevelCapabilityService`
(§4.4), not hardcoded at the call site. It is then intersected with
`HarnessCapabilities.supportsThinkingLevels`; if the harness does not support
thinking levels, the supported set is empty → field omitted. The pure
`clampThinkingLevel` core helper takes whatever supported set it is given.

**`off` is special:** a requested level of `off` always resolves to `off`
(disable thinking) and is never clamped _up_ to a supported level — disabling is
universally possible and clamping it up would invert the user's intent. `off` is
therefore exempt from the nearest-level search; only non-`off` requests are
clamped against the supported set.

### 4.2 Database

Two nullable columns (null = "not configured" → inherit downward). Each gets a
TypeORM entity field + a migration.

| Table            | Column                   | Type           | Entity file                                                        |
| ---------------- | ------------------------ | -------------- | ------------------------------------------------------------------ |
| `llm_models`     | `default_thinking_level` | `varchar NULL` | `apps/api/src/ai-config/database/entities/llm-model.entity.ts`     |
| `agent_profiles` | `thinking_level`         | `varchar NULL` | `apps/api/src/ai-config/database/entities/agent-profile.entity.ts` |

Stored as the enum string; validated on write (§7). Following
`adding-entity-migration` skill conventions.

### 4.3 Step input

`steps[].inputs.thinking_level` — `IJobStep.inputs` is already a generic
`Record<string, unknown>` resolved via `resolveTemplatedInputs`
(`step-support-inputs.helpers.ts`). Extraction added alongside the existing
`model` / `provider` extraction, templatable like them. Documented in the
`workflow-yaml-authoring` skill.

### 4.4 Capability source — `ThinkingLevelCapabilityService` (api)

The single owner of "which levels does this model support," used by both the
runtime resolver (§5) and the UI presets endpoint (§8). It must not throw for
unknown models.

```ts
// apps/api/src/ai-config/services/thinking-level-capability.service.ts
getSupportedLevels(input: {
  provider: string;
  modelId: string;
  thinkingLevelMap?: Partial<Record<RunnerThinkingLevel, string | null>>;
}): RunnerThinkingLevel[]
```

Resolution order (D7):

1. If `getModel(provider, modelId)` resolves in the pi SDK catalog, return
   `getSupportedThinkingLevels(model)` (cast to `RunnerThinkingLevel[]` — the
   enums are identical).
2. Else if a `thinkingLevelMap` is supplied (DB/custom provider), return its
   non-null keys.
3. Else return `[]` (unknown → caller omits `thinkingLevel`; for the pi harness,
   the SDK re-clamps defensively at session creation anyway).

pi-ai is imported dynamically (`await import('@earendil-works/pi-ai')`), matching
the existing `listModelPresets` / `synthesizeOAuthProviderConfig` usage.

## 5. Resolution & Clamp Logic

A thin `ThinkingLevelResolver` (api) composes the pure core helpers. It is the
only new domain unit; everything else is wiring.

```
resolveEffectiveThinkingLevel({
  stepInput?, agentProfileLevel?, modelDefaultLevel?,   // policy layers
  modelThinkingLevelMap?, harnessSupportsThinkingLevels, // capability
}): { level?: RunnerThinkingLevel; clampedFrom?: RunnerThinkingLevel; dropped: boolean }
```

1. `requested = resolveThinkingLevel({ stepInput, agentProfile, modelDefault })`.
   If undefined → return `{ dropped: false }` (omit; today's behavior).
2. `supported = capabilityService.getSupportedLevels({ provider, modelId, thinkingLevelMap })`
   (§4.4 — pi SDK first), then intersected with `harnessSupportsThinkingLevels`.
3. `effective = clampThinkingLevel(requested, supported)` (pure core helper, D4).
4. If `effective === undefined` → `{ dropped: true }` (model has no support).
   Else if `effective !== requested` → `{ level: effective, clampedFrom: requested }`.
   Else → `{ level: effective }`.

The return surfaces `clampedFrom` / `dropped` so callers can emit telemetry (§7)
without re-deriving intent.

## 6. Dispatch Wiring (both agent paths)

The container plumbing already exists; we set `runnerConfig.model.thinkingLevel`
at the point where model, provider config (`thinkingLevelMap`), and harness
capabilities are all resolved.

### 6.1 Workflow-step path

In `buildStepRunnerConfigPayloadCore` /​ `assembleBaseRunnerConfig`
(`step-agent-step-executor.helpers.ts`). All three layers are available here:

- step input: `params.resolvedJobInputs.thinking_level`
- agent profile: loaded via the agent-profile resolution already used for the
  profile name (extend to read `thinking_level`)
- per-model default: from the resolved `llm_models` row for `resolvedSettings.model`

`assembleBaseRunnerConfig` gains the resolved level and writes it into the
returned `model` object (currently lines 224–232, which omit it).

### 6.2 Chat/session path

In the `execution-dispatch` / `agent-profile-resolution` flow
(`apps/api/src/execution-lifecycle/execution-dispatch.service.ts:126`). Two
policy layers (no step input) + the per-model default lookup. Sets
`agentConfig.thinkingLevel` (already forwarded into `ContainerAgentRequest`).

Both paths use the same `ThinkingLevelResolver` so behavior cannot drift.

## 7. Validation & Telemetry

- **Save-time validation:** ai-config controller DTOs (Zod) for model and
  agent-profile updates reject any `thinking_level` / `default_thinking_level`
  not in `RunnerThinkingLevel`. Per D3 we do **not** reject "unsupported for the
  currently-pinned model" — runtime clamp handles that.
- **Runtime telemetry:** when the resolver returns `clampedFrom` or
  `dropped: true`, emit a warning log + a lightweight `event_ledger` note
  (`requested` vs `effective`, model id) via the `ledger` already threaded into
  `buildStepRunnerConfigPayloadCore`. No secret/PII content.

### 8.1 Presets endpoint enhancement (API)

`GET /ai-config/models/presets` (`listModelPresets`) gains a
`supportedThinkingLevels: RunnerThinkingLevel[]` field per model (and
`thinkingLevelMap`), derived via `ThinkingLevelCapabilityService` (§4.4). This is
the data the UI picker consumes — supported levels straight from the pi SDK.

### 8.2 UI controls

- **Model editor:** "Default thinking level" dropdown. Options: `Inherit / None`
  plus the levels **constrained to that model's `supportedThinkingLevels`** from
  the presets endpoint, so an impossible value can't be selected. When the list
  is empty (unknown/non-reasoning model), the control is disabled with a
  "model has no configurable thinking levels" hint.
- **Agent-profile editor:** "Thinking level" dropdown. Options: `Inherit` + all
  6 levels (not model-constrained — a profile's model can vary; runtime clamp is
  the safety net).
- API client + DTO types extended with the new fields; presentation in
  components, data-fetching/mutation in hooks (web quality gate).

## 9. Testing (TDD)

- **core (unit):** `parseThinkingLevel` (valid / invalid / non-string);
  `clampThinkingLevel` (exact match; clamp down; clamp up; tie → down;
  empty-supported → undefined; `off` handling); `resolveThinkingLevel`
  precedence (step > profile > model-default; all-undefined → undefined).
- **api:** `ThinkingLevelCapabilityService` (pi-SDK catalog hit → SDK levels; DB
  `thinkingLevelMap` fallback; unknown → `[]`); `ThinkingLevelResolver`
  integration (precedence + clamp + clampedFrom/dropped flags); both dispatch
  paths set `model.thinkingLevel` on the runner config / container request;
  `listModelPresets` includes `supportedThinkingLevels`; DTO validation rejects
  bad enum values; entity/migration smoke.
- **web:** component tests for both dropdowns (constrained options, inherit
  semantics, mutation payload).

## 10. Documentation

- Update the **AI config precedence** note in root `CLAUDE.md` and
  `docs/guide` to include the thinking-level chain.
- Update `workflow-yaml-authoring` skill (`steps[].inputs.thinking_level`).
- ADR recording D2 (explicit per-model column vs provider metadata) under
  `docs/architecture/decisions/`.

## 11. Backward Compatibility & Rollout

- All columns nullable, defaulting to null → existing models/profiles resolve to
  "omit" → identical to current behavior. No data backfill required.
- Optional: seed sensible `default_thinking_level` values for reasoning-capable
  models in a follow-up seed change (not required for correctness).
- No container/harness image change needed — the request field already exists.

## 12. Open Questions

None blocking. Seeding of per-model defaults is deferred to a follow-up.
