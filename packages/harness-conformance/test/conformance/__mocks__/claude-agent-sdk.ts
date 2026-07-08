/**
 * Vitest alias stub for @anthropic-ai/claude-agent-sdk.
 *
 * Used when the vitest config aliases the SDK package to this file so that
 * the ClaudeCodeEngine's dynamic import receives controllable stubs.
 *
 * Individual tests override `query` by reassigning the exported `queryImpl`
 * function via the `setQueryImpl` helper.
 *
 * `getLastQueryOptions` exposes the options object from the most recent `query`
 * call so that auth-seeding conformance tests can inspect env injection.
 */

import type { SdkMessage } from "../fixtures/claude-code.js";
import { makeMinimalSessionGenerator } from "../fixtures/claude-code.js";

let _queryImpl: () => AsyncIterable<SdkMessage> = makeMinimalSessionGenerator;
let _lastQueryOptions: { env?: Record<string, string> } | undefined;

export function setQueryImpl(impl: () => AsyncIterable<SdkMessage>): void {
  _queryImpl = impl;
}

export function getLastQueryOptions():
  | { env?: Record<string, string> }
  | undefined {
  return _lastQueryOptions;
}

export function query(opts: {
  prompt?: unknown;
  options?: { env?: Record<string, string> };
}): AsyncIterable<SdkMessage> {
  _lastQueryOptions = opts.options;
  return _queryImpl();
}

export function createSdkMcpServer(_opts: unknown): Record<string, unknown> {
  return { type: "stub-mcp-server" };
}

export function tool(
  name: string,
  _desc: string,
  _schema: unknown,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
): {
  name: string;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
} {
  return { name, handler };
}
