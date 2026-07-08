# 12a — Creating Secrets & Configuring Providers

A practical guide to storing API keys and OAuth tokens in the `secret_store` and linking them to an `llm_providers` record.

---

## Overview

Credentials are never stored inline on a provider record. Instead:

1. You create a **secret** — the encrypted credential payload (API key map or OAuth tokens)
2. You create a **provider** — references the secret by `secret_id`

The API encrypts the credential value at rest using `SECRET_ENCRYPTION_KEY`. Decryption happens only at runtime when the workflow engine prepares a container environment.

---

## Creating a Secret

**Endpoint:** `POST /api/ai-config/secrets`

**Authorization:** Requires `secrets:create` permission (admin role).

### Request Body

```json
{
  "name": "my-openai-secret",
  "value": { "OPENAI_API_KEY": "sk-proj-..." },
  "metadata": { "source": "admin-ui" }
}
```

| Field      | Type                      | Required | Description                                  |
| ---------- | ------------------------- | -------- | -------------------------------------------- |
| `name`     | `string`                  | Yes      | Human-readable label, unique per owner scope |
| `value`    | `Record<string, unknown>` | Yes      | The credential payload (see formats below)   |
| `metadata` | `Record<string, unknown>` | No       | Arbitrary metadata (source, notes, etc.)     |

The `value` object is serialised to JSON, encrypted via AES-256-GCM, and stored in the `encrypted_value` column. It is never returned in API responses — only `id`, `name`, `metadata`, and timestamps are exposed.

### Response

```json
{
  "success": true,
  "data": {
    "id": "a1b2c3d4-...",
    "name": "my-openai-secret",
    "metadata": { "source": "admin-ui" },
    "created_at": "2026-06-09T12:00:00Z",
    "updated_at": "2026-06-09T12:00:00Z"
  }
}
```

Save the `id` — you will need it when creating the provider.

---

## Credential Value Formats

The `value` field shape depends on the provider's `auth_type`.

### API-Key Providers (`auth_type: "api_key"`)

A flat key-value map where keys are environment-variable-style names recognised by the runtime:

```json
{
  "value": {
    "OPENAI_API_KEY": "sk-proj-...",
    "OPENAI_ORG_ID": "org-..."
  }
}
```

Common key names by provider:

| Provider      | Key Name            | Example Value      |
| ------------- | ------------------- | ------------------ |
| OpenAI        | `OPENAI_API_KEY`    | `sk-proj-...`      |
| Anthropic     | `ANTHROPIC_API_KEY` | `sk-ant-...`       |
| Google/Gemini | `GEMINI_API_KEY`    | `AIza...`          |
| Chutes.ai     | `OPENAI_API_KEY`    | `cpk_...`          |
| Custom        | Any string          | Provider-dependent |

The map can hold multiple keys (e.g. API key + org ID) — all are injected into the runner container.

### OAuth Providers (`auth_type: "oauth"`)

A nested object under the `oauth` key with camelCase fields:

```json
{
  "value": {
    "oauth": {
      "accessToken": "ghu_...",
      "refreshToken": "ghr_...",
      "expiresAt": 1778947200000,
      "scope": "read,write",
      "tokenType": "bearer"
    }
  }
}
```

| Field          | Type     | Required | Description                              |
| -------------- | -------- | -------- | ---------------------------------------- |
| `accessToken`  | `string` | Yes      | OAuth access token                       |
| `refreshToken` | `string` | No       | OAuth refresh token (for rotation)       |
| `expiresAt`    | `number` | No       | Token expiry as milliseconds since epoch |
| `scope`        | `string` | No       | Space/comma-delimited scope list         |
| `tokenType`    | `string` | No       | Typically `"bearer"`                     |

OAuth secrets are typically provisioned automatically by the device-code flow (see [12 — AI Config](12-ai-config.md#oauth-device-code-flow-rfc-8628)). Manual creation is only needed for pre-existing tokens.

### OAuth Token Auto-Refresh

Subscription OAuth providers (Claude Pro/Max, Codex, Copilot) have their access tokens refreshed automatically. On every runner launch the platform refreshes any access token that is within 10 minutes of expiry — using the stored `refreshToken` — and persists the rotated credential back to `secret_store`. Concurrent launches share a single refresh per provider, so Claude's rotating refresh token is not clobbered. If the refresh token itself is revoked or expired, the launch fails with an actionable error and you must re-authenticate the provider.

See [OAuth Providers runbook](../operations/oauth-providers.md) for behavior details, constants, and incident patterns.

---

## Creating a Provider

**Endpoint:** `POST /api/ai-config/providers`

**Authorization:** Requires `providers:create` permission (admin role).

### API-Key Provider

API-key providers can be created in two ways:

#### Option 1: Inline Credential (Recommended)

Create the provider with an inline API key — the secret is created automatically with the correct field name.

```json
{
  "name": "openai",
  "auth_type": "api_key",
  "base_url": "https://api.openai.com/v1",
  "credential": {
    "api_key": "sk-proj-...",
    "extra": {
      "OPENAI_ORG_ID": "org-..."
    },
    "headers": [
      {
        "name": "X-Custom-Header",
        "value": "{{CUSTOM_VALUE}}"
      }
    ]
  },
  "owner_type": "global",
  "is_active": true
}
```

| Field                | Type                     | Required | Description                                                             |
| -------------------- | ------------------------ | -------- | ----------------------------------------------------------------------- |
| `credential.api_key` | `string`                 | Yes      | The API key (stored in a managed secret)                                |
| `credential.extra`   | `Record<string, string>` | No       | Additional secret values (e.g. org ID, team ID) for header placeholders |
| `credential.headers` | `Array<{name, value}>`   | No       | Custom HTTP headers; values may reference secret entries via `{{KEY}}`  |

**Field naming:** The API automatically derives the secret JSON key name based on the provider:

- **Known presets** (OpenAI, Anthropic, Gemini, etc.): `<PROVIDER>_API_KEY` (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)
- **Custom/unknown**: `API_KEY`

**Custom headers:** Values can reference secret entries using `{{KEY}}` placeholders (e.g. `{{OPENAI_ORG_ID}}`). These placeholders are resolved at runtime from the encrypted secret — the resolved values stay encrypted and are never logged.

**Editing:** To rotate the API key or adjust headers:

- Leave `credential.api_key` blank to keep the existing key
- To rotate, supply a new `api_key` value
- Update `credential.extra` or `credential.headers` to merge additional values or change headers; existing entries not mentioned are preserved

#### Option 2: Use Existing Secret

Reuse a pre-created secret by referencing its ID:

```json
{
  "name": "openai",
  "auth_type": "api_key",
  "secret_id": "a1b2c3d4-...",
  "base_url": "https://api.openai.com/v1",
  "owner_type": "global",
  "is_active": true
}
```

This approach is useful when you already have a secret and want to link it to a provider, or when sharing a secret across multiple providers.

### OAuth Provider

OAuth providers are setup through the UI device-code flow (see section below). OAuth client secrets remain pre-created secrets referenced via `oauth_client_secret_id` — inline OAuth credential creation is not yet supported.

```json
{
  "name": "github-copilot",
  "auth_type": "oauth",
  "secret_id": "e5f6g7h8-...",
  "oauth_authorization_url": "https://github.com/login/oauth/authorize",
  "oauth_token_url": "https://github.com/login/oauth/access_token",
  "oauth_client_id": "Iv1...",
  "oauth_client_secret_id": "i9j0k1l2-...",
  "oauth_scopes": ["read", "write"],
  "owner_type": "global",
  "is_active": true
}
```

> **OAuth client secrets** are also stored in `secret_store` and referenced via `oauth_client_secret_id` — the same secret creation flow applies (pre-create via `/ai-config/secrets` endpoint).

| Field        | Type       | Required | Description                                         |
| ------------ | ---------- | -------- | --------------------------------------------------- | --------------------- | --------------------------------------- |
| `name`       | `string`   | Yes      | Provider name (used in workflow YAML references)    |
| `auth_type`  | `"api_key" | "oauth"` | Yes\(^1\)                                           | Authentication method |
| `secret_id`  | `uuid`     | No       | References a `secret_store` record                  |
| `base_url`   | `string`   | No       | API base URL (defaults to provider's standard URL)  |
| `owner_type` | `"global"  | "user"   | "scope"`                                            | No                    | Ownership scope (`"global"` by default) |
| `owner_id`   | `string`   | No       | Required when `owner_type` is `"user"` or `"scope"` |
| `is_active`  | `boolean`  | No       | Whether the provider is enabled (`true` by default) |

\(^1\) `auth_type` may be inferred from the provider preset if omitted.

### Linking After Creation

If you already have a provider and need to attach a secret, update the provider:

```json
PATCH /api/ai-config/providers/{id}
{
  "secret_id": "a1b2c3d4-..."
}
```

---

## Full Workflow Examples

### Path A: Inline Credential (Recommended for new providers)

Create the provider with an inline API key in a single call. The secret is created automatically.

```bash
curl -X POST http://localhost:3010/api/ai-config/providers \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai",
    "auth_type": "api_key",
    "base_url": "https://api.openai.com/v1",
    "credential": {
      "api_key": "sk-proj-...",
      "extra": {
        "OPENAI_ORG_ID": "org-..."
      },
      "headers": [
        {
          "name": "X-Request-ID",
          "value": "{{OPENAI_ORG_ID}}"
        }
      ]
    },
    "is_active": true
  }'

# Response includes the provider with auto-created secret
# → { "data": { "id": "provider-id", "secret_id": "auto-created-secret-id" } }
```

### Path B: Pre-created Secret (for reusing secrets across providers)

If you have an existing secret or want to manage secrets separately:

```bash
# 1. Create the secret (skip if reusing existing)
curl -X POST http://localhost:3010/api/ai-config/secrets \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai-production",
    "value": { "OPENAI_API_KEY": "sk-proj-...", "OPENAI_ORG_ID": "org-..." }
  }'

# Response includes the secret ID
# → { "data": { "id": "a1b2c3d4-..." } }

# 2. Create the provider with the secret_id
curl -X POST http://localhost:3010/api/ai-config/providers \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "openai",
    "auth_type": "api_key",
    "secret_id": "a1b2c3d4-...",
    "is_active": true
  }'
```

### Editing a Provider

When updating a provider with inline credentials:

```bash
curl -X PATCH http://localhost:3010/api/ai-config/providers/<provider-id> \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "credential": {
      "api_key": "sk-proj-new-...",
      "extra": {
        "OPENAI_ORG_ID": "org-updated"
      }
    }
  }'
```

**Notes on editing:**

- Leave `credential.api_key` blank (or omit the credential entirely) to keep the existing key
- Provide a new `api_key` to rotate the key
- Updates to `credential.extra` and `credential.headers` are merged with existing values; only updated keys are changed

---

## Managing Secrets

| Operation     | Endpoint                             | Description                       |
| ------------- | ------------------------------------ | --------------------------------- |
| List secrets  | `GET /api/ai-config/secrets`         | Returns metadata only (no values) |
| Get secret    | `GET /api/ai-config/secrets/{id}`    | Returns metadata only             |
| Update secret | `PATCH /api/ai-config/secrets/{id}`  | Replace name, value, or metadata  |
| Delete secret | `DELETE /api/ai-config/secrets/{id}` | Removes encrypted payload         |

Updating a secret's `value` re-encrypts the new payload. Deleting a secret breaks the provider link — runtime execution will fail.

---

## Binding a Secret to a Harness (per scope)

The `harness_credential_binding` table maps a harness credential requirement (`credential_key`) to a `secret_store` secret at a `scope_node_id` (`NULL` = platform/global), with `auth_type`. Binding requires an existing secret; create it via `POST /api/secrets` first.

Bind an existing secret to a harness at a specific scope:

```sh
curl -X PUT https://localhost:3010/api/harness/claude-code/credentials/anthropic \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "secretId": "<uuid>", "scopeNodeId": "<optional-scope-id>" }'
```

Scope-walk resolution: the platform resolves the most-specific binding first (`scope_node_id` matching the run's scope), then walks up the scope tree to the platform binding (`scope_node_id = NULL`). An `optional` requirement may stay unbound without blocking launch.

See [41 — Harness Runtime § Credential Model](41-harness-runtime.md#credential-model) for the full credential model.

---

## OAuth Device-Flow Walkthrough

Use this flow when a harness declares `OAuthDeviceConfig` (e.g., Claude Code with Anthropic's device endpoint). No `/start` suffix — the device flow is initiated directly at:

**1.** Start the flow:

```sh
curl -X POST https://localhost:3010/api/harness/claude-code/credentials/anthropic/device-flow \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "scopeNodeId": "<optional-scope-id>" }'
```

Response: `{ "deviceFlowId": "...", "userCode": "XXXX-XXXX", "verificationUri": "https://...", "verificationUriComplete": "...", "intervalSeconds": 5, "expiresAt": 9999999999 }`

**2.** Display `userCode` and `verificationUri` to the user. The user visits `verificationUri` and enters `userCode` to authorize.

**3.** Poll for completion:

```sh
curl https://localhost:3010/api/harness/claude-code/credentials/anthropic/device-flow/<deviceFlowId> \
  -H "Authorization: Bearer $TOKEN"
```

Response: `{ "status": "pending" | "complete" | "expired" | "denied" }`

**4.** On `complete`: the server has minted a `secret_store` secret and upserted a `harness_credential_binding` with `auth_type = oauth_device` at the requested scope. No further action needed.

Claude Code is the first consumer (Anthropic device + token endpoints). Any harness works by declaring `OAuthDeviceConfig` — no new flow code required.

> **Note:** The endpoint has **no `/start` segment** — `POST .../device-flow` directly starts the flow.

---

## Cross-References

- [12 — AI Config](12-ai-config.md) — Provider configuration, 4-tier precedence, OAuth device-code flow
- [19 — Security](19-security.md) — Encryption at rest, secret scanning, audit logging
- [34 — Glossary](34-glossary.md) — Domain terms: Secret Vault, LLM Provider
- [32 — Seed Data](32-seed-data.md) — Bootstrapping secrets from environment variables during development
- [41 — Harness Runtime](41-harness-runtime.md) — harness credential model, device flow overview, selection precedence
- [operator-playbook.md](../specs/EPIC-196-pluggable-harness/operator-playbook.md) — registering and validating a harness, setting a scoped default

> The OAuth device-code flow in `12-ai-config.md` applies to `llm_providers` (provider-level); this section is harness-level (`harness_credential_binding`).
