# OAuth Providers Runbook

## Scope

Operational runbook for subscription OAuth providers (Claude Pro/Max, Codex,
Copilot) and the automatic access-token refresh that keeps long-lived agent runs
authenticated. Use this when an agent run fails with an authentication error or
when verifying that token rotation is working.

## OAuth token auto-refresh

Subscription OAuth providers (Claude Pro/Max `anthropic-claude-code`, Codex
`openai-codex`, Copilot `github-copilot`) store `accessToken` + `refreshToken` +
`expiresAt` in `secret_store`. On every runner launch,
`AiConfigurationService.buildResolvedProviderConfig` calls
`ProviderOAuthService.ensureFreshOAuthCredential`, which refreshes the access
token (via `grant_type=refresh_token` against `oauth_token_url`) when it is
within `OAUTH_REFRESH_BUFFER_MS` (10 min) of expiry and persists the rotated
credential back to `secret_store`. Concurrent launches share a single refresh
per provider (per-provider single-flight lock), which matters because Claude
rotates the refresh token on every refresh.

If the refresh token itself is expired or revoked, the launch fails with an
actionable error — re-authenticate the provider from the AI Config UI.

### Refresh delegation to the pi OAuth provider

For providers configured with `runtime_env.pi_provider` (Claude Pro/Max
`anthropic-claude-code` → `anthropic`, Codex, Copilot), the refresh is delegated
to the resolved pi OAuth provider definition rather than POSTing directly to
`oauth_token_url`. The pi provider supplies the hardcoded `client_id` and the
provider-specific request shape (e.g. Anthropic posts JSON, not form-encoded).
Because of this, the DB `oauth_client_id` column may legitimately be **empty**
for these subscription providers — their client_id lives in the pi provider
definition. Providers without a usable `pi_provider` fall back to the
form-encoded `grant_type=refresh_token` POST against `oauth_token_url` using the
DB `oauth_client_id` (and optional client secret).

## Key Constants

| Constant                   | Value             | Meaning                                                           |
| -------------------------- | ----------------- | ----------------------------------------------------------------- |
| `OAUTH_REFRESH_BUFFER_MS`  | `600000` (10 min) | Refresh proactively when the access token is this close to expiry |
| `OAUTH_REFRESH_TIMEOUT_MS` | `30000` (30 s)    | Network timeout for the token-refresh request                     |

## Symptoms / What You'll See

- **Before this feature:** lapsed access tokens caused agent runs to fail with
  `HTTP 401 Invalid authentication credentials`. The stored `accessToken` had
  passed `expiresAt`, and nothing rotated it ahead of launch.
- **With auto-refresh:** an access token within 10 minutes of expiry (or already
  expired but with a valid `refreshToken`) is refreshed transparently on launch.
  The `HTTP 401` failure no longer occurs unless the refresh token itself is
  revoked or expired.
- **Refresh token revoked/expired:** the launch fails with an actionable error
  rather than a raw `401`. Re-authenticate the provider from the AI Config UI to
  mint a fresh `accessToken` + `refreshToken` pair.

## Verification

1. Confirm the provider is an OAuth provider with `oauth_token_url` set and a
   `secret_store` secret containing `refreshToken` + `expiresAt`.
2. Launch (or re-launch) a runner that uses the provider.
3. Confirm the run no longer fails with `HTTP 401 Invalid authentication
credentials`.
4. For a token near expiry, confirm the stored secret's `accessToken` /
   `expiresAt` are rotated after launch (a fresh `expiresAt` further in the
   future).

## Common Incident Patterns

1. Run fails with `HTTP 401 Invalid authentication credentials`
   - Check whether the stored `refreshToken` is present and valid.
   - If the refresh token is revoked or expired, re-authenticate from the AI
     Config UI (device-code flow) to replace the credential.

2. Repeated refreshes / refresh token "disappears" under concurrency
   - Claude rotates the `refreshToken` on every refresh. The per-provider
     single-flight lock ensures concurrent launches share one refresh so the
     rotated token is not clobbered. If this is suspected, confirm launches are
     resolving the provider through `ensureFreshOAuthCredential` rather than
     reading the secret directly.

3. Refresh times out
   - The refresh request is bounded by `OAUTH_REFRESH_TIMEOUT_MS` (30 s). A
     timeout surfaces as a launch failure; verify connectivity to
     `oauth_token_url`.

## Cross-References

- [12 — AI Config](../guide/12-ai-config.md) — provider configuration and OAuth device-code flow
- [12a — Creating Secrets & Configuring Providers](../guide/12a-secret-provider-setup.md) — secret/provider setup, OAuth credential format
