# EPIC-210: Harness-Native Contributions (Hooks, Extensions, Settings)

Status: Proposed
Priority: P1
Created: 2026-06-23
Updated: 2026-06-23
Owner: Runtime Platform / Harness Runtime
Depends On: EPIC-196 (Pluggable Coding Harness Runtime)
Related: EPIC-188 (Third-Party Plugin Platform), `packages/harness-runtime`, `packages/harness-engine-pi`, `packages/harness-engine-claude-code`

---

## 1. Summary

EPIC-196 introduced a pluggable harness runtime (`HarnessEngine`, `HarnessCapabilities`, registry, and the `pi` / `claude-code` engines) but deliberately stopped at _execution_. Each harness ships a rich set of native extensibility points — Claude Code has hooks, MCP servers, and `settings.json`; PI has its own analogs — yet Nexus can only mount skills and governed tools. This epic adds a **harness-neutral contribution model** so operators can author **hooks**, **extensions (MCP servers)**, and **settings** once, in agent profiles / workflow steps / skill bundles, and have each concrete harness materialize them into its native format. Concrete coverage targets the two existing built-in harnesses (`pi`, `claude-code`).

## 2. Problem Statement

- **Native extensibility is unreachable.** Claude Code agents run without any generated `.claude/settings.json`, no hooks (PreToolUse/PostToolUse/SessionStart), and no MCP server registration. PI's equivalent lifecycle/extension surface is similarly unused. The harness is a "dumb container launcher" — see [the Claude Code harness architecture review](#11-references).
- **No author-facing seam.** There is no way for an operator to say "this agent profile installs these MCP servers" or "run this command on SessionStart" — the only per-agent customization is skills and tool policy.
- **Governance gap waiting to happen.** Extensions inject _new tools_ and hooks run _shell commands_. Any ad-hoc path that bypasses the existing `job ∩ profile` tool-policy gate or runs unbounded shell would be a security regression. The contribution model must route through governance by construction.
- **Capability dishonesty risk.** Harnesses differ: Claude Code supports all three contribution types natively; PI supports a subset. Without explicit capability declaration, unsupported contributions fail silently instead of being dropped with diagnostics.

## 3. Current State Review

| Concern                 | Today                                                                                                                                                                                   | Gap                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Harness selection       | `resolveRunnerHarness` with step → profile → project → platform precedence + ledger diagnostics (`apps/api/src/harness/harness-runtime-selection.ts`)                                   | Pattern exists; reuse it for contributions                                             |
| Engine contract         | `HarnessEngine` + `HarnessSessionContext` carry `governedTools`, `toolCatalog`, `checkPermission`, `agentDir`, `extensionsPath`, `sessionPath` (`packages/harness-runtime/src/engine/`) | No contribution surface; no hook/extension/settings seam                               |
| Capabilities            | `HarnessCapabilities` declares execution modes, tool model, branching, resume, `skillsContainerPath` (`packages/core/src/interfaces/harness-capabilities.ts`)                           | No `supportsHooks` / `supportsExtensions` / `supportsSettings` / `supportedHookEvents` |
| Skills / tools mounting | Skills mounted at `skillsContainerPath`; governed tools written to `extensionsPath`; tool policy enforced via `_sdk_tool_allowlist.json`                                                | No analogous flow for hooks / MCP servers / settings                                   |
| Authoring surfaces      | Agent profiles (skills, tool policy, model), workflow step `inputs` overrides, skill catalog                                                                                            | No contribution fields anywhere                                                        |

## 4. Goals

1. Define harness-neutral canonical contracts for **hooks**, **extensions (MCP servers)**, and **settings** in `@nexus/core`.
2. Add **separate per-feature materializer interfaces** to `@nexus/harness-runtime`, implemented independently by each engine, gated by explicit `HarnessCapabilities` flags.
3. Resolve and merge contributions by precedence (step → profile → skill-bundle → platform default), validate against the resolved harness's capabilities, and emit event-ledger diagnostics — mirroring `resolveRunnerHarness`.
4. **Engine-side materialization:** each engine writes its own native artifacts at session creation (Claude Code `.claude/settings.json` + hooks + MCP config; PI native equivalents), keeping harness internals behind the EPIC-196 boundary.
5. Route extension-provided tools through the existing `job ∩ profile` governance gate; validate and bound hook commands; never log secrets.
6. Author-facing surfaces: agent-profile field, `steps[].inputs.harness_contributions`, and a `contributions` block in skill manifests, plus web UI and operator docs.

## 5. Non-Goals

- **Slash / custom commands** — out of scope for this epic; tracked as a follow-up (see [Open Questions](#10-open-questions)). The contract design should not preclude adding a fourth contribution type later.
- Removing or reworking the existing skills mounting or governed-tool flow.
- A third-party marketplace for contributions (overlaps EPIC-188 plugin platform).
- Adding contribution support to custom/external (non-builtin) harnesses in the first rollout — the SPI must allow it, but only `pi` and `claude-code` are delivered here.
- Interactive/browser hook surfaces beyond what the harness natively executes.

## 6. Target Architecture

### 6.1 Canonical contracts (`@nexus/core`)

Harness-neutral, author-facing types (zod-validated, following existing `ai-config` schema conventions):

- `HarnessHookContribution` — `{ event: HookEvent; matcher?: string; command: HookCommand; timeoutMs?: number }` where `HookEvent` is a neutral enum (e.g. `session_start`, `pre_tool_use`, `post_tool_use`, `session_end`) mapped per-harness.
- `HarnessExtensionContribution` — an MCP server definition: `{ name; transport: "stdio" | "http"; command?; args?; url?; env?; headers?; toolPolicyRef? }`.
- `HarnessSettingsContribution` — a bounded settings bag (`env`, `permissions`, `outputStyle`, etc.) with an allowlisted key set — not an arbitrary passthrough.
- `HarnessContributions` — the resolved bundle `{ hooks: []; extensions: []; settings: {} }`.

### 6.2 Capabilities (`HarnessCapabilities`)

New honest flags: `supportsHooks`, `supportsExtensions`, `supportsSettings`, and `supportedHookEvents: HookEvent[]`. The resolver consults these; unsupported contributions are dropped (not silently lost) with a ledger diagnostic.

### 6.3 Per-feature materializer SPI (`@nexus/harness-runtime`)

Three optional interfaces an engine implements independently:

```ts
interface HookMaterializer {
  materializeHooks(
    hooks: HarnessHookContribution[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}
interface ExtensionMaterializer {
  materializeExtensions(
    exts: HarnessExtensionContribution[],
    ctx: HarnessSessionContext,
  ): Promise<void>;
}
interface SettingsMaterializer {
  materializeSettings(
    settings: HarnessSettingsContribution,
    ctx: HarnessSessionContext,
  ): Promise<void>;
}
```

The resolved `HarnessContributions` bundle is carried into the container and exposed on `HarnessSessionContext` (or `HarnessRuntimeConfig`). During `createSession`, the kernel invokes whichever materializers the engine implements, for the contributions the engine's capabilities admit. Engines write native artifacts using paths they already own (`agentDir`, workspace).

### 6.4 Resolution + governance (`apps/api/src/harness`)

- `HarnessContributionResolver` merges step → profile → skill-bundle → platform default, validates against resolved capabilities, emits diagnostics. Reuses the `resolveRunnerHarness` diagnostic/precedence pattern.
- Extension-provided MCP tools are registered into the same tool catalog and gated by the existing `job ∩ profile` policy — an extension cannot widen an agent's tool surface past its profile ceiling.
- Hook commands are validated against a bounded allowlist/sandbox policy; timeouts enforced; secrets never logged (OWASP).

### 6.5 Data flow

```
author (profile / step / skill manifest)
  → HarnessContributionResolver (merge + capability-validate + ledger diagnostics)
  → serialize bundle into container (env / mounted manifest / harnessOptions)
  → kernel reads bundle, passes via HarnessSessionContext
  → engine materializers write native artifacts (Claude Code settings.json/hooks/.mcp; PI equivalents)
  → native harness loads them at session start
```

## 7. Workstreams & Phased Delivery

**Phase 1 — Contracts + capabilities + resolver (no behavior change).**

- `E210-001` Canonical contribution schemas/types in `@nexus/core` (+ zod, + unit tests).
- `E210-002` Add `supportsHooks` / `supportsExtensions` / `supportsSettings` / `supportedHookEvents` to `HarnessCapabilities`; set honest values on `PI_CAPABILITIES` and `CLAUDE_CODE_CAPABILITIES`.
- `E210-003` Define the three materializer SPI interfaces in `@nexus/harness-runtime`; extend `HarnessSessionContext`/runtime config to carry the bundle.
- `E210-004` `HarnessContributionResolver` (precedence merge + capability validation + ledger diagnostics) with contract tests.

**Phase 2 — PI materializers / parity.**

- `E210-010` Implement supported materializers in `harness-engine-pi` against PI's native config/lifecycle/MCP surface.
- `E210-011` Declare PI capability flags honestly; drop-with-diagnostics for anything PI lacks natively.
- `E210-012` SPI conformance tests for PI materializers; live-stack smoke test.

**Phase 3 — Claude Code materializers.**

- `E210-020` Generate `.claude/settings.json` (hooks, permissions, env) at session creation in `harness-engine-claude-code`.
- `E210-021` Materialize `HarnessExtensionContribution` into Claude Code MCP config; register tools through governance.
- `E210-022` Materialize hooks (event mapping → Claude Code hook matchers) with bounded commands.
- `E210-023` SPI conformance tests + live-stack smoke test for Claude Code.

**Phase 4 — Authoring surfaces, UI, docs.**

- `E210-030` Agent-profile contribution field (entity + migration + seed validation).
- `E210-031` `steps[].inputs.harness_contributions` workflow override + schema + workflow-yaml-authoring docs.
- `E210-032` `contributions` block in skill manifests, surfaced through the skill catalog/mounting flow.
- `E210-033` Web UI for authoring/inspecting contributions; resolved-contribution diagnostics surfaced in run detail.
- `E210-034` Operator docs in `docs/guide` + harness capability matrix update.

## 8. Acceptance Criteria

- A canonical contribution authored on an agent profile is materialized natively by both `pi` and `claude-code` (where supported), verified on the live stack.
- Contributions unsupported by the resolved harness are dropped with an explicit event-ledger diagnostic — never silently and never as a hard failure.
- Extension-provided tools appear in the agent's tool catalog only when permitted by `job ∩ profile`; a contribution cannot widen the tool surface.
- Step-level `harness_contributions` override profile-level, which override skill-bundle, which override platform default — covered by precedence tests.
- No secrets are logged during hook/extension materialization; hook commands are bounded by timeout and validated against policy.
- All gates green: `packages/core`, `harness-runtime`, both engines, `apps/api` build/lint/unit; `docs/guide` updated.

## 9. Risks & Mitigations

| Risk                                              | Mitigation                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Extensions silently widen the tool surface        | Route all extension tools through the existing `job ∩ profile` gate; add a contract test asserting profile-ceiling enforcement.     |
| Hooks run arbitrary shell in-container            | Allowlist/bound hook commands, enforce timeouts, deny by default; document the threat model.                                        |
| PI lacks native parity for some types             | Honest capability flags + drop-with-diagnostics; never emulate silently.                                                            |
| Materialization logic drifts between engines      | Shared SPI conformance suite parameterized over both engines (extends `packages/harness-runtime/test/engine/spi-contract.test.ts`). |
| Boundary erosion (API learning harness internals) | Engine-side materialization keeps native format knowledge inside each engine; API only handles the canonical bundle.                |
| Settings bag becomes an arbitrary passthrough     | Allowlisted, schema-validated key set only.                                                                                         |

## 10. Open Questions

- **Slash / custom commands** were dropped from this epic's scope. Should they be a Phase 5 here or a separate follow-up epic? Contract design leaves room for a fourth contribution type.
- Should skill-bundle-provided contributions be opt-in per agent profile, or auto-applied whenever the skill is mounted?
- For PI, which native surfaces map cleanly to hooks vs. require a new in-runtime mechanism? Needs a short PI-side spike at the start of Phase 2.
- Auth/secret handling for extension MCP servers — reuse `secret_store` references rather than inlining credentials in contributions.

## 11. References

- `docs/epics/EPIC-196-pluggable-coding-harness-runtime.md` — the runtime this builds on.
- `packages/core/src/interfaces/harness-capabilities.ts` — `PI_CAPABILITIES` / `CLAUDE_CODE_CAPABILITIES`.
- `packages/harness-runtime/src/engine/session-context.types.ts` — `HarnessSessionContext` seam.
- `packages/harness-engine-pi/src/pi-engine.ts`, `packages/harness-engine-claude-code/src/claude-code-engine.ts` — concrete engines.
- `apps/api/src/harness/harness-runtime-selection.ts` — precedence + diagnostics pattern to mirror.
- `packages/harness-runtime/test/engine/spi-contract.test.ts` — SPI conformance suite to extend.
