# Harness-Native Contributions — Phase 2 (PI Parity & Spike) Implementation Plan

> ⚠️ **SUPERSEDED — DO NOT IMPLEMENT.** This plan's premise (the PI SDK has no
> native contribution support) was **wrong**. PI exposes a full extension system
> (`tool_call` can block, `tool_result` can modify, plus session/prompt events)
> and our engine already loads PI extension modules. Use
> [`2026-06-23-harness-native-contributions-phase2-pi-revised.md`](./2026-06-23-harness-native-contributions-phase2-pi-revised.md)
> instead. Kept for historical record of the corrected spike.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the PI native-surface spike from the design doc, lock PI's honest contribution capability flags with a regression guard, and document the finding — so the resolver correctly drops-with-diagnostics for PI rather than anyone later assuming PI supports hooks/MCP.

**Architecture:** Phase 1 set PI's `supportsHooks`/`supportsExtensions`/`supportsSettings` to `false`. This phase proves that is correct against the PI SDK (`@earendil-works/pi-coding-agent`), adds an engine-package guard test asserting `PiEngine` implements **no** materializer interface and that `applyContributions` no-ops for it, and records the spike outcome in the spec + docs.

**Tech Stack:** TypeScript (strict), Vitest. Workspace: `packages/harness-engine-pi`, plus doc edits.

**Spec:** `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` · **Depends on:** Phase 1 (foundation) merged.

## Global Constraints

- Strict lint policy: no `eslint-disable`/`@ts-ignore`/`@ts-nocheck`.
- PI capability flags remain `false`/`[]` — do not flip them without a real materializer implementation behind them.
- Test command: `npm run test --workspace=packages/harness-engine-pi -- <pattern>`.

## Spike Finding (authoritative — drives this phase)

Investigation of `@earendil-works/pi-coding-agent@0.78.0` (`node_modules/.../dist/core/extensions/types.d.ts`, `dist/index.d.ts`):

| Contribution type    | PI native support                 | Evidence                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hooks**            | **No** (for our author semantics) | Extension lifecycle events (`tool_execution_start/end`, `session_start`, `session_shutdown`, `before_agent_start`) are **observational** — they cannot block or modify tool calls. Author hook semantics (esp. `pre_tool_use` gating) cannot be honored. Running shell on observational events would require generating a PI extension module, whose exact export contract is not yet pinned. |
| **Extensions (MCP)** | **No**                            | No MCP server registration / client API in the SDK exports.                                                                                                                                                                                                                                                                                                                                   |
| **Settings**         | **No** clean mapping              | `PiEngine` uses `SettingsManager.inMemory()`. Our settings bag (`env`/`permissions`/`outputStyle`) has no faithful PI knob: `env` is already process env, `permissions` is governance-owned (`_sdk_tool_allowlist.json`), `outputStyle` has no equivalent.                                                                                                                                    |

**Conclusion:** PI declares no native contribution support in this epic. A future plan may add observational-only hooks via a generated PI extension once the extension module contract is pinned — explicitly out of scope here.

---

### Task 1: Lock PI's honest flags with a guard test

**Files:**

- Create (test): `packages/harness-engine-pi/test/pi-engine.contributions-unsupported.test.ts`

**Interfaces:**

- Consumes: `PI_CAPABILITIES`, `EMPTY_HARNESS_CONTRIBUTIONS`, `applyContributions`, `isHookMaterializer` / `isExtensionMaterializer` / `isSettingsMaterializer` (Phase 1); `PiEngine` (existing).
- Produces: a regression test asserting PI advertises and implements no contribution support.

- [ ] **Step 1: Write the failing test**

Create `packages/harness-engine-pi/test/pi-engine.contributions-unsupported.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PI_CAPABILITIES } from "@nexus/core";
import {
  applyContributions,
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "@nexus/harness-runtime";
import { PiEngine } from "../src/pi-engine.js";

describe("PI contribution support (honest no-op)", () => {
  it("declares no native contribution capabilities", () => {
    expect(PI_CAPABILITIES.supportsHooks ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportsExtensions ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportsSettings ?? false).toBe(false);
    expect(PI_CAPABILITIES.supportedHookEvents ?? []).toEqual([]);
  });

  it("does not implement any materializer interface", () => {
    const engine = new PiEngine();
    expect(isHookMaterializer(engine)).toBe(false);
    expect(isExtensionMaterializer(engine)).toBe(false);
    expect(isSettingsMaterializer(engine)).toBe(false);
  });

  it("applyContributions is a no-op for PI even with a populated bundle", async () => {
    const engine = new PiEngine();
    const ctx = {
      governedTools: [],
      toolCatalog: [],
      checkPermission: vi.fn(async () => ({ status: "allowed" as const })),
      workspacePath: "/workspace",
      agentDir: "/agent",
      extensionsPath: "/ext",
      sessionPath: "/session.jsonl",
      contributions: {
        hooks: [{ event: "session_start" as const, command: "echo hi" }],
        extensions: [{ name: "x", transport: "stdio" as const, command: "y" }],
        settings: { outputStyle: "concise" },
      },
    };
    // Must not throw and must not attempt native materialization.
    await expect(applyContributions(engine, ctx)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npm run test --workspace=packages/harness-engine-pi -- contributions-unsupported`
Expected: PASS. (This is a _characterization_ guard — it should pass against the Phase-1 state. If any assertion fails, PI's flags or engine were changed incorrectly; fix the regression, do not weaken the test.)

> TDD note: this guard's value is regression protection, not red-green discovery. If a future change flips a PI flag to `true` without adding the matching materializer, this test goes red — which is the intended alarm.

- [ ] **Step 3: Commit**

```bash
git add packages/harness-engine-pi/test/pi-engine.contributions-unsupported.test.ts
git commit -m "test(harness-engine-pi): lock honest no-contribution-support guard"
```

---

### Task 2: Record the spike outcome in the spec + docs

**Files:**

- Modify: `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md` (§4 matrix + §9 PI paragraph + §10)
- Modify: `docs/guide/41-harness-runtime.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update the design spec**

In `docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md`:

- In the §4 capability matrix, replace the "per spike" PI cells with the resolved values: `supportsHooks: false`, `supportsExtensions: false`, `supportsSettings: false`, `supportedHookEvents: []`.
- In §9, replace the PI paragraph with:

```markdown
**PI (Phase 2).** The Phase-2 spike found the PI SDK exposes only _observational_
lifecycle events (no pre/post-tool mutation), no MCP-server registration, and no
settings bag that maps to `env`/`permissions`/`outputStyle`. PI therefore declares
no native contribution support; the resolver drops PI contributions with
diagnostics. A future plan may add observational-only hooks via a generated PI
extension once that extension module contract is pinned — out of scope here.
```

- In §10, mark the "PI native surfaces" open question as **Resolved (Phase 2 spike)** with a one-line summary.

- [ ] **Step 2: Update the harness runtime guide**

In `docs/guide/41-harness-runtime.md`, add a short "Harness contributions" subsection noting: contributions (hooks/extensions/settings) are author-facing and harness-capability-gated; PI currently materializes none (capability flags `false`); Claude Code support arrives in Phase 3.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-06-23-harness-native-contributions-design.md \
        docs/guide/41-harness-runtime.md
git commit -m "docs(harness): record PI contribution spike outcome (no native support)"
```

---

## Phase 2 Completion Check

- [ ] `npm run test --workspace=packages/harness-engine-pi -- contributions-unsupported` — green
- [ ] Spec §4/§9/§10 reflect the resolved PI finding
- [ ] `docs/guide/41-harness-runtime.md` mentions contributions + PI status

PI is now provably honest: flags `false`, no materializer, resolver drops-with-diagnostics. No runtime behavior change. The substantive materialization work is Phase 3 (Claude Code).

## Out of Scope (documented future option)

- Observational-only PI hooks (`session_start`/`session_end`) via a generated PI extension module — requires pinning the `@earendil-works/pi-coding-agent` extension export contract first.
