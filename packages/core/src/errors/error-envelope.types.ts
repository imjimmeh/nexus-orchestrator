/**
 * Canonical discriminated-union error type for the orchestration layer.
 *
 * Domain services throw (or return) an ErrorEnvelope instead of raw Error
 * objects so that callers — retry classifiers, telemetry normalizers, and
 * workflow step handlers — can make typed, policy-driven decisions rather than
 * string-matching error messages.
 *
 * Rules:
 * - No business logic here. This is a schema file only.
 * - All new error classes must be added to this union and exported from @nexus/core.
 * - Use `toErrorEnvelope` / `isErrorEnvelope` helpers in consuming modules.
 */

/** Transition status string kept as a plain alias so packages/core stays domain-neutral. */
type TransitionStatusString = string;

export type ErrorEnvelope =
  // ── Worktree errors ──────────────────────────────────────────────────────
  | {
      kind: "worktree.lock";
      /** Absolute path of the locked worktree. */
      path: string;
      /** Hint extracted from git stderr (e.g. "use --force --force"). */
      hint: string;
    }
  | {
      kind: "worktree.stale";
      /** Absolute path of the stale worktree. */
      path: string;
    }
  | {
      kind: "worktree.io";
      /** Path that triggered the I/O failure. */
      path: string;
      /** errno string from the OS (e.g. "EIO", "ENOENT"). */
      errno: string;
    }
  | {
      kind: "worktree.branch-missing";
      /** Branch name that could not be resolved. */
      branch: string;
      /** Remote name that was checked (typically "origin"). */
      remote: string;
    }
  // ── Status-transition errors ──────────────────────────────────────────────
  | {
      kind: "transition.illegal";
      /** Status the resource was in when the transition was attempted. */
      from: TransitionStatusString;
      /** Status that was requested. */
      to: TransitionStatusString;
    }
  | {
      kind: "transition.stale";
      /** Status the resource was in at the time the command was issued. */
      from: TransitionStatusString;
      /** Status that was requested by the (now-stale) command. */
      requested: TransitionStatusString;
      /** Actual current status in the database. */
      current: TransitionStatusString;
    }
  // ── Provider / AI errors ─────────────────────────────────────────────────
  | {
      kind: "provider.quota";
      /** Provider key (e.g. "openai", "anthropic"). */
      provider: string;
      /** Milliseconds until the quota window resets, if known. */
      retryAfterMs?: number;
    }
  // ── Worktree gitdir errors ─────────────────────────────────────────────────
  | {
      kind: "worktree.gitdir-invalid";
      /** Absolute path of the worktree with the invalid .git dir. */
      path: string;
      /** Raw git stderr hint. */
      hint: string;
    }
  // ── Tool-mount errors ────────────────────────────────────────────────────
  | {
      kind: "tool.io";
      /** Tool name whose wrapper file caused the failure. */
      toolName: string;
      /** errno string from the OS. */
      errno: string;
    }
  // ── Catch-all ────────────────────────────────────────────────────────────
  | {
      kind: "unknown";
      message: string;
      /** Original thrown value, preserved for debugging. */
      raw?: unknown;
    };

/** Narrow guard: returns true if `value` is an ErrorEnvelope discriminated union. */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).kind === "string"
  );
}

/** Convert any thrown value to an ErrorEnvelope. Preserves the original if it
 *  is already an envelope; wraps raw Error / unknown values in `kind: 'unknown'`. */
export function toErrorEnvelope(error: unknown): ErrorEnvelope {
  if (isErrorEnvelope(error)) {
    return error;
  }

  if (error instanceof Error) {
    return { kind: "unknown", message: error.message, raw: error };
  }

  return {
    kind: "unknown",
    message: typeof error === "string" ? error : String(error),
    raw: error,
  };
}

/** Serialize an ErrorEnvelope to a human-readable string suitable for
 *  event_ledger errorMessage fields. */
export function errorEnvelopeToString(envelope: ErrorEnvelope): string {
  switch (envelope.kind) {
    case "worktree.lock":
      return `Worktree locked at ${envelope.path}: ${envelope.hint}`;
    case "worktree.stale":
      return `Stale worktree at ${envelope.path}`;
    case "worktree.io":
      return `Worktree I/O error (${envelope.errno}) at ${envelope.path}`;
    case "worktree.branch-missing":
      return `Branch "${envelope.branch}" not found locally or on ${envelope.remote}`;
    case "transition.illegal":
      return `Illegal status transition: ${envelope.from} → ${envelope.to}`;
    case "transition.stale":
      return `Stale status transition: requested ${envelope.requested} but current status is ${envelope.current} (was ${envelope.from})`;
    case "provider.quota":
      return envelope.retryAfterMs !== undefined
        ? `Provider ${envelope.provider} quota exceeded; retry after ${envelope.retryAfterMs}ms`
        : `Provider ${envelope.provider} quota exceeded`;
    case "worktree.gitdir-invalid":
      return `Invalid worktree .git dir at ${envelope.path}: ${envelope.hint}`;
    case "tool.io":
      return `Tool I/O error (${envelope.errno}) for tool "${envelope.toolName}"`;
    case "unknown":
      return envelope.message;
  }
}
