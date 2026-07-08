/**
 * How a subscription OAuth credential is delivered to the Claude Code CLI:
 * - `env`  — `CLAUDE_CODE_OAUTH_TOKEN` env var (headless/programmatic auth).
 * - `file` — a native `~/.claude/.credentials.json`, the same file `claude
 *            login` writes, so the CLI authenticates exactly as an interactive
 *            session would. `CLAUDE_CODE_OAUTH_TOKEN` is intentionally omitted
 *            so the file (lowest auth precedence) is actually consulted.
 */
export type ClaudeAuthDeliveryMode = "env" | "file";

export interface ClaudeCredentialsFile {
  /** Directory exported as CLAUDE_CONFIG_DIR; the CLI reads `<dir>/.credentials.json`. */
  dir: string;
  /** Absolute path of the credentials file to write (mode 0600). */
  path: string;
  /** Credentials JSON in the native Claude Code shape. */
  contents: string;
}

export interface ClaudeAuthDelivery {
  /** Auth-related env vars to pass to the SDK `query()` `options.env`. */
  env: Record<string, string>;
  /** When set, this file must be written before the CLI starts. */
  credentialsFile?: ClaudeCredentialsFile;
}
