# Agent JWT TTL & Governance Auth-Failure Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop long-running workflow steps from hitting 401 on every governance-gated runtime tool once their fixed 2-hour agent JWT expires, and stop those auth failures from being silently laundered into success so the run hangs forever.

**Architecture:** The agent JWT (`AGENT_JWT`) is minted once at container start and baked into the container env; there is no refresh path. We (A) make the TTL env-configurable with a generous default across all four mint sites, (B) classify governance HTTP 401/403 responses as a distinct hard tool failure instead of a soft policy denial, and (C) extract a single shared `signAgentToken` seam so a future refresh endpoint has one source of truth.

**Tech Stack:** NestJS (apps/api), `jsonwebtoken`, Vitest, TypeScript ESM, `@nexus/harness-runtime` package.

## Global Constraints

- Strict lint policy — never suppress (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`, rule downgrades). Fix in code.
- TDD: Red → Green → Refactor. Failing test before implementation, every task.
- API/core must stay Kanban-neutral — none of these files touch the Kanban domain; keep it that way.
- TypeScript strong typing; no `any`.
- NestJS apps build with `nest build`, not `tsc`.
- `packages/core` builds first; harness-runtime is consumed as a workspace package.
- Default agent-token TTL when `AGENT_JWT_TTL` is unset: `'24h'`.
- Env var name: `AGENT_JWT_TTL`. Distinct governance auth-failure code: `governance_auth_failed`.

---

## File Structure

| File                                                                                                     | Responsibility                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `apps/api/src/config/agent-token-ttl.ts` (create)                                                        | `resolveAgentTokenTtl()` — read+validate `AGENT_JWT_TTL`, default `'24h'`.                                         |
| `apps/api/src/config/agent-token-ttl.spec.ts` (create)                                                   | Unit tests for the resolver.                                                                                       |
| `apps/api/src/auth/sign-agent-token.ts` (create)                                                         | `signAgentToken(claims, jwtSecret, ttl?)` — single mint seam; defaults TTL via resolver.                           |
| `apps/api/src/auth/sign-agent-token.spec.ts` (create)                                                    | Unit tests for the shared signer.                                                                                  |
| `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts` (modify)          | Use shared signer / configurable TTL.                                                                              |
| `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts` (modify) | Use shared signer / configurable TTL.                                                                              |
| `apps/api/src/workflow/workflow-subagents/subagent-parent-resume.service.ts` (modify)                    | Use shared signer / configurable TTL.                                                                              |
| `apps/api/src/chat-execution/agent-token.service.ts` (modify)                                            | Use shared signer / configurable TTL.                                                                              |
| `packages/harness-runtime/src/governance/check-permission-client.ts` (modify)                            | Tag HTTP 401/403 with `code: "governance_auth_failed"`.                                                            |
| `packages/harness-runtime/src/governance/check-permission-client.spec.ts` (create or extend)             | Test the auth-failure tagging.                                                                                     |
| `packages/harness-runtime/src/governance/wrap-tool.ts` (modify)                                          | Surface `governance_auth_failed` as a hard failure (`details.ok:false`, `terminate`), not a soft retryable denial. |
| `packages/harness-runtime/src/governance/wrap-tool.spec.ts` (create or extend)                           | Test hard-failure vs soft-denial branching.                                                                        |
| `apps/api/README.md` (modify)                                                                            | Document `AGENT_JWT_TTL`.                                                                                          |

---

## Task 1: Configurable agent-token TTL resolver

**Files:**

- Create: `apps/api/src/config/agent-token-ttl.ts`
- Test: `apps/api/src/config/agent-token-ttl.spec.ts`

**Interfaces:**

- Produces: `resolveAgentTokenTtl(): string` — returns `process.env.AGENT_JWT_TTL` when it is a non-empty, valid `jsonwebtoken` duration string (e.g. `"24h"`, `"90m"`, or a plain integer-seconds string); otherwise returns the default `"24h"`. Throws `Error` for a set-but-malformed value.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/config/agent-token-ttl.spec.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TOKEN_TTL,
  resolveAgentTokenTtl,
} from "./agent-token-ttl";

describe("resolveAgentTokenTtl", () => {
  const original = process.env.AGENT_JWT_TTL;

  beforeEach(() => {
    delete process.env.AGENT_JWT_TTL;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_JWT_TTL;
    else process.env.AGENT_JWT_TTL = original;
  });

  it("returns the default when unset", () => {
    expect(resolveAgentTokenTtl()).toBe(DEFAULT_AGENT_TOKEN_TTL);
    expect(DEFAULT_AGENT_TOKEN_TTL).toBe("24h");
  });

  it("returns the configured value when valid", () => {
    process.env.AGENT_JWT_TTL = "36h";
    expect(resolveAgentTokenTtl()).toBe("36h");
  });

  it("accepts a plain integer seconds string", () => {
    process.env.AGENT_JWT_TTL = "7200";
    expect(resolveAgentTokenTtl()).toBe("7200");
  });

  it("falls back to default for an empty/whitespace value", () => {
    process.env.AGENT_JWT_TTL = "   ";
    expect(resolveAgentTokenTtl()).toBe(DEFAULT_AGENT_TOKEN_TTL);
  });

  it("throws for a malformed duration", () => {
    process.env.AGENT_JWT_TTL = "banana";
    expect(() => resolveAgentTokenTtl()).toThrow(/AGENT_JWT_TTL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- agent-token-ttl`
Expected: FAIL — cannot find module `./agent-token-ttl`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/config/agent-token-ttl.ts

/** Default agent JWT lifetime when AGENT_JWT_TTL is unset. */
export const DEFAULT_AGENT_TOKEN_TTL = "24h";

// jsonwebtoken accepts either an integer number of seconds (as a numeric
// string) or a duration string understood by `ms` (e.g. "90m", "24h", "7d").
const DURATION_PATTERN = /^\d+\s*(ms|s|m|h|d|w|y)?$/i;

/**
 * Resolves the agent JWT lifetime from `AGENT_JWT_TTL`, defaulting to
 * {@link DEFAULT_AGENT_TOKEN_TTL}. A set-but-malformed value is a
 * misconfiguration and throws rather than silently using the default.
 */
export function resolveAgentTokenTtl(): string {
  const raw = process.env.AGENT_JWT_TTL;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_AGENT_TOKEN_TTL;
  }

  const value = raw.trim();
  if (!DURATION_PATTERN.test(value)) {
    throw new Error(
      `AGENT_JWT_TTL is set to an invalid duration: "${raw}". ` +
        'Use seconds (e.g. "7200") or a duration string (e.g. "24h", "90m").',
    );
  }

  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- agent-token-ttl`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/agent-token-ttl.ts apps/api/src/config/agent-token-ttl.spec.ts
git commit -m "feat(api): add configurable agent JWT TTL resolver

Long steps out-run the fixed 2h agent token. Add AGENT_JWT_TTL (default 24h)."
```

---

## Task 2: Shared agent-token signer seam

**Files:**

- Create: `apps/api/src/auth/sign-agent-token.ts`
- Test: `apps/api/src/auth/sign-agent-token.spec.ts`

**Interfaces:**

- Consumes: `resolveAgentTokenTtl` from Task 1.
- Produces: `signAgentToken(claims: Record<string, unknown>, jwtSecret: string, ttl?: string): string` — signs `claims` with `expiresIn` = `ttl ?? resolveAgentTokenTtl()`. Single source of truth for every agent-token mint site.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/auth/sign-agent-token.spec.ts
import { describe, expect, it } from "vitest";
import * as jwt from "jsonwebtoken";
import { signAgentToken } from "./sign-agent-token";

const SECRET = "test-secret";

describe("signAgentToken", () => {
  it("signs the provided claims and is verifiable with the secret", () => {
    const token = signAgentToken(
      { sub: "agent:run:job", role: "agent" },
      SECRET,
    );
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    expect(decoded.sub).toBe("agent:run:job");
    expect(decoded.role).toBe("agent");
    expect(typeof decoded.exp).toBe("number");
  });

  it("uses the default TTL (~24h) when none is supplied", () => {
    const token = signAgentToken({ sub: "s" }, SECRET);
    const decoded = jwt.verify(token, SECRET) as { iat: number; exp: number };
    // 24h = 86400s, allow a couple seconds of signing skew.
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(86_400 + 5);
  });

  it("honours an explicit ttl override", () => {
    const token = signAgentToken({ sub: "s" }, SECRET, "1h");
    const decoded = jwt.verify(token, SECRET) as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBe(3_600);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- sign-agent-token`
Expected: FAIL — cannot find module `./sign-agent-token`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/api/src/auth/sign-agent-token.ts
import * as jwt from "jsonwebtoken";
import { resolveAgentTokenTtl } from "../config/agent-token-ttl";

/**
 * Signs an agent JWT from the given claims. The lifetime defaults to
 * {@link resolveAgentTokenTtl} (env `AGENT_JWT_TTL`, default 24h) so every
 * mint site shares one configurable source of truth. This is the seam a
 * future token-refresh endpoint plugs into.
 */
export function signAgentToken(
  claims: Record<string, unknown>,
  jwtSecret: string,
  ttl: string = resolveAgentTokenTtl(),
): string {
  return jwt.sign(claims, jwtSecret, {
    expiresIn: ttl as jwt.SignOptions["expiresIn"],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- sign-agent-token`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/sign-agent-token.ts apps/api/src/auth/sign-agent-token.spec.ts
git commit -m "feat(api): add shared signAgentToken seam with configurable TTL"
```

---

## Task 3: Route the step-container mint site through the shared signer

**Files:**

- Modify: `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts:45-58`
- Test: `apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `signAgentToken` from Task 2.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.spec.ts
import { describe, expect, it } from "vitest";
import * as jwt from "jsonwebtoken";
import { ContainerTier } from "@nexus/core";
import { buildAgentContainerConfig } from "./step-agent-container-config.helpers";

describe("buildAgentContainerConfig AGENT_JWT lifetime", () => {
  const base = {
    workflowRunId: "run-1",
    jobId: "job-1",
    stepId: "step-1",
    tier: ContainerTier.LIGHT,
    hostMountPath: "/host",
    hostMountBindings: [],
    jwtSecret: "secret",
    harnessId: "pi" as const,
  };

  it("mints AGENT_JWT with the default 24h TTL", () => {
    const config = buildAgentContainerConfig(base);
    const decoded = jwt.verify(config.env.AGENT_JWT, "secret") as {
      iat: number;
      exp: number;
    };
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
  });

  it("honours AGENT_JWT_TTL", () => {
    const prev = process.env.AGENT_JWT_TTL;
    process.env.AGENT_JWT_TTL = "1h";
    try {
      const config = buildAgentContainerConfig(base);
      const decoded = jwt.verify(config.env.AGENT_JWT, "secret") as {
        iat: number;
        exp: number;
      };
      expect(decoded.exp - decoded.iat).toBe(3_600);
    } finally {
      if (prev === undefined) delete process.env.AGENT_JWT_TTL;
      else process.env.AGENT_JWT_TTL = prev;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- step-agent-container-config`
Expected: FAIL — first test expects ~86400s but token is signed with 2h (7200s).

- [ ] **Step 3: Write minimal implementation**

Replace the inline `jwt.sign(...)` (lines 45-58) with the shared signer. Remove the now-unused `import * as jwt` if nothing else in the file uses it.

```typescript
// top of file — replace `import * as jwt from 'jsonwebtoken';`
import { signAgentToken } from "../../auth/sign-agent-token";
```

```typescript
// inside buildAgentContainerConfig, replacing lines 45-58
const token = signAgentToken(
  {
    sub: `agent:${params.workflowRunId}:${params.jobId}`,
    workflowRunId: params.workflowRunId,
    role: "agent",
    stepId: params.stepId,
    jobId: params.jobId,
    agentProfileName: params.agentProfileName,
    ...(params.scopeId ? { scopeId: params.scopeId } : {}),
    roles: ["Agent"],
  },
  params.jwtSecret,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- step-agent-container-config`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.ts apps/api/src/workflow/workflow-step-execution/step-agent-container-config.helpers.spec.ts
git commit -m "fix(api): mint step-container AGENT_JWT with configurable TTL

Long steps out-lived the fixed 2h token and 401'd on every governance call."
```

---

## Task 4: Route the subagent-container mint site through the shared signer

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts:265-282`
- Test: extend the nearest existing spec for this file, or add an inline assertion in `subagent-orchestrator.container-config.operations.spec.ts` (create if absent) following the Task 3 pattern.

**Interfaces:**

- Consumes: `signAgentToken` from Task 2.

- [ ] **Step 1: Write the failing test**

Add a test that builds the subagent token via the exported builder and asserts `exp - iat >= 86400 - 5` with `AGENT_JWT_TTL` unset (mirror the Task 3 assertions; use the function/params that this module exports — confirm the exported signature before writing the call).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.container-config`
Expected: FAIL — token signed with 2h, not 24h.

- [ ] **Step 3: Write minimal implementation**

```typescript
// replace the `jwt.sign(... { expiresIn: '2h' })` block (lines 265-282)
return signAgentToken(
  {
    sub: `agent:${workflowRunId}:${subagentExecutionId}`,
    workflowRunId,
    role: "agent",
    roles: ["Agent"],
    stepId: subagentExecutionId,
    jobId: subagentExecutionId,
    agentProfileName: params.spawnParams.agent_profile,
    isSubagent: true,
    subagentExecutionId,
    allowedTools,
    ...(parentJobId ? { parent_job_id: parentJobId } : {}),
    ...(params.chatSessionId ? { chatSessionId: params.chatSessionId } : {}),
  },
  context.jwtSecret,
);
```

Add `import { signAgentToken } from '../../auth/sign-agent-token';` and drop the `jwt` import if unused elsewhere in the file (verify with a grep before removing).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- subagent-orchestrator.container-config`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-orchestrator.container-config.operations.ts apps/api/src/workflow/workflow-subagents/*.spec.ts
git commit -m "fix(api): mint subagent-container AGENT_JWT with configurable TTL"
```

---

## Task 5: Route the parent-resume and chat-agent mint sites through the shared signer

**Files:**

- Modify: `apps/api/src/workflow/workflow-subagents/subagent-parent-resume.service.ts:93-111`
- Modify: `apps/api/src/chat-execution/agent-token.service.ts:10-25`
- Test: extend `apps/api/src/chat-execution/*agent-token*.spec.ts` (create if absent) asserting the chat token default TTL is ~24h and overridable.

**Interfaces:**

- Consumes: `signAgentToken` from Task 2.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/chat-execution/agent-token.service.spec.ts
import { describe, expect, it } from "vitest";
import * as jwt from "jsonwebtoken";
import { AgentTokenService } from "./agent-token.service";

describe("AgentTokenService", () => {
  it("mints with the default 24h TTL", () => {
    process.env.JWT_SECRET = "secret";
    const token = new AgentTokenService().mintAgentToken({
      chatSessionId: "cs-1",
      agentProfileName: "senior_dev",
    });
    const decoded = jwt.verify(token, "secret") as { iat: number; exp: number };
    expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(86_400 - 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- agent-token.service`
Expected: FAIL — token signed with 2h.

- [ ] **Step 3: Write minimal implementation**

`agent-token.service.ts` — replace the `jwt.sign(... { expiresIn: '2h' })` body:

```typescript
import { Injectable } from "@nestjs/common";
import { requireJwtSecret } from "../config/jwt-runtime-config";
import { signAgentToken } from "../auth/sign-agent-token";
import type { AgentTokenPayload } from "./agent-token.service.types";

export type { AgentTokenPayload } from "./agent-token.service.types";

@Injectable()
export class AgentTokenService {
  mintAgentToken(payload: AgentTokenPayload): string {
    return signAgentToken(
      {
        sub: `agent:chat:${payload.chatSessionId}`,
        role: "agent",
        roles: ["Agent"],
        stepId: payload.chatSessionId,
        chatSessionId: payload.chatSessionId,
        agentProfileName: payload.agentProfileName,
        ...(payload.contextId && { scopeId: payload.contextId }),
      },
      requireJwtSecret(),
    );
  }
}
```

`subagent-parent-resume.service.ts` — replace the `jwt.sign(... { expiresIn: '2h' })` in `buildParentToken` with `signAgentToken({...claims}, jwtSecret)`; add the import and drop the now-unused `jwt` import if nothing else uses it (verify with grep).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- agent-token.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workflow/workflow-subagents/subagent-parent-resume.service.ts apps/api/src/chat-execution/agent-token.service.ts apps/api/src/chat-execution/agent-token.service.spec.ts
git commit -m "fix(api): mint parent-resume and chat agent tokens with configurable TTL"
```

---

## Task 6: Tag governance HTTP 401/403 as an auth failure

**Files:**

- Modify: `packages/harness-runtime/src/governance/check-permission-client.ts:62-70`
- Test: `packages/harness-runtime/src/governance/check-permission-client.spec.ts` (create if absent)

**Interfaces:**

- Produces: on HTTP 401 or 403, the returned `PermissionDecision` is `{ status: "denied", code: "governance_auth_failed", reason: "Governance check failed (HTTP <status>): <body>" }`. Other non-OK statuses keep the existing untagged denied decision.
- Add an exported constant `export const GOVERNANCE_AUTH_FAILED_CODE = "governance_auth_failed";` for the wrap-tool consumer (Task 7).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/harness-runtime/src/governance/check-permission-client.spec.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCheckPermission,
  GOVERNANCE_AUTH_FAILED_CODE,
} from "./check-permission-client.js";

const config = { apiBaseUrl: "http://api", agentJwt: "jwt" };

describe("createCheckPermission auth failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tags HTTP 401 with the auth-failed code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }),
    );
    const check = createCheckPermission(config);
    const decision = await check("step_complete", {});
    expect(decision).toEqual({
      status: "denied",
      code: GOVERNANCE_AUTH_FAILED_CODE,
      reason: expect.stringContaining("HTTP 401"),
    });
  });

  it("leaves other non-OK statuses as an untagged denial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
      }),
    );
    const decision = await createCheckPermission(config)("step_complete", {});
    expect(decision.status).toBe("denied");
    expect((decision as { code?: string }).code).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- check-permission-client`
Expected: FAIL — 401 currently returns a denial with no `code`, and `GOVERNANCE_AUTH_FAILED_CODE` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add the constant near the other top-level constants:

```typescript
export const GOVERNANCE_AUTH_FAILED_CODE = "governance_auth_failed";
```

Replace the `if (!response.ok) { ... }` block (lines 62-70):

```typescript
if (!response.ok) {
  const errorText = await response.text();
  const reason = `Governance check failed (HTTP ${response.status}): ${errorText}`;
  // 401/403 mean the agent's own credential is invalid (almost always
  // an expired token on a long step) — distinct from a policy denial,
  // so the caller can fail fast / refresh instead of letting the model
  // retry forever.
  if (response.status === 401 || response.status === 403) {
    return {
      status: "denied",
      code: GOVERNANCE_AUTH_FAILED_CODE,
      reason,
    } satisfies PermissionDecision;
  }
  return { status: "denied", reason } satisfies PermissionDecision;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- check-permission-client`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harness-runtime/src/governance/check-permission-client.ts packages/harness-runtime/src/governance/check-permission-client.spec.ts
git commit -m "feat(harness-runtime): tag governance 401/403 as governance_auth_failed"
```

---

## Task 7: Surface auth-failed governance denials as a hard tool failure

**Files:**

- Modify: `packages/harness-runtime/src/governance/wrap-tool.ts`
- Test: `packages/harness-runtime/src/governance/wrap-tool.spec.ts` (create if absent)

**Interfaces:**

- Consumes: `GOVERNANCE_AUTH_FAILED_CODE` from Task 6.
- Behavior: a `denied` decision whose `code === GOVERNANCE_AUTH_FAILED_CODE` returns a result with `details.ok:false`, `details.error: "governance_auth_failed"`, and `terminate: true` (so the engine ends the turn instead of looping). A plain policy denial keeps the existing soft behavior (no `terminate`).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/harness-runtime/src/governance/wrap-tool.spec.ts
import { describe, expect, it } from "vitest";
import { wrapToolWithGovernance } from "./wrap-tool.js";
import { GOVERNANCE_AUTH_FAILED_CODE } from "./check-permission-client.js";

const tool = {
  name: "step_complete",
  description: "",
  parameters: {},
  execute: async () => ({ content: [], details: { ok: true } }),
};

describe("wrapToolWithGovernance", () => {
  it("terminates on an auth-failed denial without calling the tool", async () => {
    let called = false;
    const wrapped = wrapToolWithGovernance(
      { ...tool, execute: async () => ((called = true), { content: [] }) },
      async () => ({
        status: "denied",
        code: GOVERNANCE_AUTH_FAILED_CODE,
        reason: "HTTP 401",
      }),
    );
    const result = (await wrapped.execute("c1", {})) as {
      details: { ok: boolean; error: string };
      terminate?: boolean;
    };
    expect(called).toBe(false);
    expect(result.details.ok).toBe(false);
    expect(result.details.error).toBe(GOVERNANCE_AUTH_FAILED_CODE);
    expect(result.terminate).toBe(true);
  });

  it("keeps a plain policy denial soft (no terminate)", async () => {
    const wrapped = wrapToolWithGovernance(tool, async () => ({
      status: "denied",
      reason: "policy",
    }));
    const result = (await wrapped.execute("c1", {})) as {
      details: { error: string };
      terminate?: boolean;
    };
    expect(result.details.error).toBe("permission_denied");
    expect(result.terminate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/harness-runtime -- wrap-tool`
Expected: FAIL — auth-failed denial currently returns the same soft `permission_denied` shape with no `terminate`.

- [ ] **Step 3: Write minimal implementation**

Replace the `if (decision.status === "denied") { ... }` block:

```typescript
import { GOVERNANCE_AUTH_FAILED_CODE } from "./check-permission-client.js";
```

```typescript
if (decision.status === "denied") {
  const isAuthFailure = decision.code === GOVERNANCE_AUTH_FAILED_CODE;
  return {
    content: [
      {
        type: "text",
        text: isAuthFailure
          ? `${decision.reason ?? "Agent credential rejected"} — this run's agent token is no longer valid; stop and let the run be retried with a fresh container.`
          : (decision.reason ?? "Denied by governance policy"),
      },
    ],
    details: {
      ok: false,
      error: isAuthFailure ? GOVERNANCE_AUTH_FAILED_CODE : "permission_denied",
      reason: decision.reason,
      code: decision.code,
    },
    ...(isAuthFailure ? { terminate: true } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/harness-runtime -- wrap-tool`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/harness-runtime/src/governance/wrap-tool.ts packages/harness-runtime/src/governance/wrap-tool.spec.ts
git commit -m "feat(harness-runtime): fail fast on governance_auth_failed instead of looping"
```

---

## Task 8: Document AGENT_JWT_TTL and verify the whole change

**Files:**

- Modify: `apps/api/README.md` (env/config section)

- [ ] **Step 1: Document the env var**

Add to the API env reference:

```markdown
| `AGENT_JWT_TTL` | Lifetime of agent JWTs minted for workflow-step, subagent, parent-resume, and chat-agent containers. Seconds (`7200`) or a duration string (`24h`, `90m`). Default `24h`. Set longer than your longest expected active step; a too-short value causes governance 401s mid-step. | `24h` |
```

- [ ] **Step 2: Build the affected packages**

Run:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/harness-runtime
```

Expected: both succeed (harness-runtime change is consumed as built output by the container image).

- [ ] **Step 3: Run the full affected test + lint gate**

Run:

```bash
npm run test --workspace=apps/api
npm run test --workspace=packages/harness-runtime
npm run lint:api
```

Expected: all green, no lint findings.

- [ ] **Step 4: Commit**

```bash
git add apps/api/README.md
git commit -m "docs(api): document AGENT_JWT_TTL"
```

---

## Post-merge / deploy notes (not code steps)

- The container TTL is baked at container start, so **rebuild `nexus-api`, `nexus-light`, and `nexus-heavy` images** and redeploy for the change to take effect.
- The currently stuck run `a990cc8e` will not self-heal (its container token is already dead) — cancel/retry it after deploy so it gets a fresh-token container.
- Live reproduction shortcut: set `AGENT_JWT_TTL=2m`, launch a step that stays active >2m, confirm tools now fail fast (turn terminates, run becomes retryable) instead of the agent looping on 401 — then confirm a normal `24h` run is unaffected.
- Follow-up (out of scope here): a real `POST /workflow-runtime/refresh-token` endpoint + in-container refresh before expiry, built on the `signAgentToken` seam from Task 2. Pairs with the long-step hardening in `project_implement_2h_http_timeout_destructive_retry`.

## Self-Review

- **Spec coverage:** Part A (configurable TTL) = Tasks 1–5 across all four mint sites; Part B (auth-failure classification) = Tasks 6–7; Part C (refresh groundwork) = Task 2 shared signer; docs/verify = Task 8. All covered.
- **Placeholder scan:** Task 4's test references "the function this module exports" — intentional, because the exported subagent-token builder signature must be confirmed at implementation time; all other steps carry concrete code.
- **Type consistency:** `signAgentToken(claims, jwtSecret, ttl?)`, `resolveAgentTokenTtl()`, `GOVERNANCE_AUTH_FAILED_CODE`, and `DEFAULT_AGENT_TOKEN_TTL` are used consistently across tasks. `PermissionDecision.denied` already carries an optional `code` — no type change required.
