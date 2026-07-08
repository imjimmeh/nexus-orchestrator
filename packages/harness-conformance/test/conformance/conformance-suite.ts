/**
 * Cross-harness conformance suite — shared helpers.
 *
 * This module exports the shared context/config factories and the `collectEvents`
 * helper used by both conformance test files.
 *
 * Why are C1–C7 test cases duplicated in each engine's test file rather than
 * driven from a shared `runConformanceSuite` function?
 *
 * Vitest (and Jest) hoist `vi.mock(...)` calls to the top of the module at
 * compile time. This means mock registrations MUST appear at the top level of
 * the test file — they cannot be placed inside a function like
 * `runConformanceSuite`. Each engine requires different mocking strategies:
 *   - PI engine: `vi.mock("@earendil-works/pi-coding-agent", ...)` with a
 *     module-level mutable `scriptedEvents` variable that controls the fake.
 *   - Claude Code engine: a module-alias stub with a `setQueryImpl` helper.
 * Because these mock registrations cannot be encapsulated in a shared function,
 * each test file owns its full C1–C7 body. The shared helpers below eliminate
 * duplication in context/config construction and event collection.
 */

import { vi } from "vitest";
import type {
  HarnessSession,
  HarnessSessionContext,
} from "@nexus/harness-runtime";
import {
  EMPTY_HARNESS_CONTRIBUTIONS,
  type CanonicalSessionEvent,
  type RunnerProviderAuth,
} from "@nexus/core";
import type { HarnessRuntimeConfig } from "@nexus/core";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function makeMockContext(
  overrides?: Partial<HarnessSessionContext>,
): HarnessSessionContext {
  return {
    governedTools: [],
    toolCatalog: [],
    checkPermission: vi.fn(() =>
      Promise.resolve({ status: "allowed" as const }),
    ),
    workspacePath: "/tmp/test-workspace",
    agentDir: "/tmp/test-agent",
    extensionsPath: "/tmp/test-extensions",
    sessionPath: "/tmp/test-session.jsonl",
    // Engines (ClaudeCodeEngine, PiEngine) read ctx.contributions inside
    // createSession — the test mock must provide a value (the empty bundle)
    // so the helpers can be reused without each call site supplying a fixture.
    contributions: EMPTY_HARNESS_CONTRIBUTIONS,
    ...overrides,
  };
}

export function makePiConfig(): HarnessRuntimeConfig {
  return {
    harnessId: "pi",
    model: {
      provider: "anthropic",
      model: "claude-opus-4-8",
      auth: { type: "api_key", apiKey: "test-key" },
    },
    prompt: {
      systemPrompt: "You are a helpful assistant.",
      initialPrompt: "Hello",
    },
    harnessOptions: { stepId: "test-step" },
  };
}

export function makeClaudeCodeConfig(): HarnessRuntimeConfig {
  return {
    harnessId: "claude-code",
    model: {
      provider: "anthropic",
      model: "claude-opus-4-8",
      auth: { type: "api_key", apiKey: "test-key" },
    },
    prompt: {
      systemPrompt: "You are a helpful assistant.",
      initialPrompt: "Hello",
    },
    harnessOptions: { stepId: "test-step" },
  };
}

/**
 * Collect all events emitted by a session until it finishes (agent_end or
 * agent_error) or a timeout is reached, whichever comes first.
 */
export function collectEvents(
  session: HarnessSession,
  timeoutMs = 2000,
): Promise<CanonicalSessionEvent[]> {
  return new Promise((resolve) => {
    const events: CanonicalSessionEvent[] = [];
    const timer = setTimeout(() => {
      unsub();
      resolve(events);
    }, timeoutMs);

    const unsub = session.subscribe((e) => {
      events.push(e);
      if (e.type === "agent_end" || e.type === "agent_error") {
        clearTimeout(timer);
        unsub();
        resolve(events);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Auth fixtures
// ---------------------------------------------------------------------------

export const API_KEY_AUTH_FIXTURE: RunnerProviderAuth = {
  type: "api_key",
  apiKey: "conformance-api-key",
};

export const OAUTH_AUTH_FIXTURE: RunnerProviderAuth = {
  type: "oauth",
  credential: {
    type: "oauth",
    refreshToken: "refresh-xyz",
    accessToken: "access-abc",
    expiresAt: 9_999_999_999_000,
  },
};

export function makePiConfigWithAuth(
  auth: RunnerProviderAuth,
): HarnessRuntimeConfig {
  const base = makePiConfig();
  return { ...base, model: { ...base.model, auth } };
}

export function makeClaudeCodeConfigWithAuth(
  auth: RunnerProviderAuth,
): HarnessRuntimeConfig {
  const base = makeClaudeCodeConfig();
  return { ...base, model: { ...base.model, auth } };
}
