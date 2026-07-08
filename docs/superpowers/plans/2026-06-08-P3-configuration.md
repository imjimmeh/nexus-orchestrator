# P3: Configuration Centralization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ~40 direct `process.env` reads in business-logic services with injected config tokens, and consolidate 3 copy-pasted WebSocket URL resolution chains into one utility.

**Architecture:** NestJS `ConfigService` already exists in the app. The approach is: (1) create a typed config token for each logical group (container URLs, WebSocket URL, ports), (2) register those tokens in the relevant NestJS modules, (3) inject them into the services that currently call `process.env` directly. The WebSocket URL resolution logic (3 controllers copy a 3-priority-chain) becomes a single `resolveWebSocketUrl(config)` helper.

**Tech Stack:** `@nestjs/config`, NestJS DI, Vitest

---

## Files

| Action | File |
|---|---|
| Create | `apps/api/src/config/container-urls.config.ts` |
| Create | `apps/api/src/config/websocket-url.config.ts` |
| Create | `apps/api/src/config/container-urls.config.spec.ts` |
| Create | `apps/api/src/config/websocket-url.config.spec.ts` |
| Modify | `apps/api/src/chat-execution/chat-execution.service.ts` |
| Modify | `apps/api/src/chat-execution/chat-execution.module.ts` |
| Modify | `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts` |
| Modify | `apps/api/src/notifications/notification-inbox.controller.ts` |
| Modify | `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts` |

---

## Task 1: Container URL config token

The 3 hardcoded Docker hostnames in `chat-execution.service.ts` (`DEFAULT_WEBSOCKET_URL = 'http://host.docker.internal:3001'`, `DEFAULT_API_BASE_URL = 'http://nexus-api:3000'`, `NEXUS_DOCKER_NETWORK` from `process.env`) become injectable config values.

**Files:**
- Create: `apps/api/src/config/container-urls.config.ts`
- Create: `apps/api/src/config/container-urls.config.spec.ts`

- [ ] **Step 1: Write a test for the config factory**

```typescript
// apps/api/src/config/container-urls.config.spec.ts
import { describe, it, expect, afterEach } from 'vitest';
import { containerUrlsConfig, CONTAINER_URLS_CONFIG } from './container-urls.config';

describe('containerUrlsConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reads values from environment variables', () => {
    process.env.WEBSOCKET_URL = 'http://ws:3001';
    process.env.API_BASE_URL = 'http://api:3000';
    process.env.NEXUS_DOCKER_NETWORK = 'my-network';

    const result = containerUrlsConfig();

    expect(result.websocketUrl).toBe('http://ws:3001');
    expect(result.apiBaseUrl).toBe('http://api:3000');
    expect(result.dockerNetwork).toBe('my-network');
  });

  it('uses defaults when env vars are absent', () => {
    delete process.env.WEBSOCKET_URL;
    delete process.env.API_BASE_URL;
    delete process.env.NEXUS_DOCKER_NETWORK;

    const result = containerUrlsConfig();

    expect(result.websocketUrl).toBe('http://host.docker.internal:3001');
    expect(result.apiBaseUrl).toBe('http://nexus-api:3000');
    expect(result.dockerNetwork).toBe('nexus-network');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/config/container-urls.config.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/config/container-urls.config.ts
import { registerAs } from '@nestjs/config';

export const CONTAINER_URLS_CONFIG = 'containerUrls';

export interface ContainerUrlsConfig {
  websocketUrl: string;
  apiBaseUrl: string;
  dockerNetwork: string;
}

export const containerUrlsConfig = registerAs(
  CONTAINER_URLS_CONFIG,
  (): ContainerUrlsConfig => ({
    websocketUrl:
      process.env.WEBSOCKET_URL?.trim() || 'http://host.docker.internal:3001',
    apiBaseUrl:
      process.env.API_BASE_URL?.trim() || 'http://nexus-api:3000',
    dockerNetwork:
      process.env.NEXUS_DOCKER_NETWORK?.trim() || 'nexus-network',
  }),
);
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run apps/api/src/config/container-urls.config.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Register config in the module that owns ChatExecutionService**

In `apps/api/src/chat-execution/chat-execution.module.ts` (or `AppModule` — check which is appropriate):

```typescript
import { ConfigModule } from '@nestjs/config';
import { containerUrlsConfig } from '../config/container-urls.config';

@Module({
  imports: [
    ConfigModule.forFeature(containerUrlsConfig),
    // ... existing imports
  ],
  // ...
})
export class ChatExecutionModule {}
```

- [ ] **Step 6: Inject config into `ChatExecutionService`**

In `apps/api/src/chat-execution/chat-execution.service.ts`:

```typescript
import { ConfigService } from '@nestjs/config';
import type { ContainerUrlsConfig } from '../config/container-urls.config';
import { CONTAINER_URLS_CONFIG } from '../config/container-urls.config';

@Injectable()
export class ChatExecutionService {
  constructor(
    // ... existing dependencies
    private readonly config: ConfigService,
  ) {}

  // Replace all direct process.env reads:
  // process.env.WEBSOCKET_URL   → this.config.get<ContainerUrlsConfig>(CONTAINER_URLS_CONFIG).websocketUrl
  // process.env.API_BASE_URL    → this.config.get<ContainerUrlsConfig>(CONTAINER_URLS_CONFIG).apiBaseUrl
  // process.env.NEXUS_DOCKER_NETWORK → this.config.get<ContainerUrlsConfig>(CONTAINER_URLS_CONFIG).dockerNetwork
}
```

Remove the module-level constants:
```typescript
// DELETE these lines from chat-execution.service.ts:
const DEFAULT_WEBSOCKET_URL = 'http://host.docker.internal:3001';
const DEFAULT_API_BASE_URL = 'http://nexus-api:3000';
```

- [ ] **Step 7: Run the API test suite**

```bash
npx vitest run apps/api/src/chat-execution/
```

Expected: All tests pass. If tests used `process.env` to configure `ChatExecutionService`, update them to mock `ConfigService` instead.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/config/container-urls.config.ts \
        apps/api/src/config/container-urls.config.spec.ts \
        apps/api/src/chat-execution/chat-execution.service.ts \
        apps/api/src/chat-execution/chat-execution.module.ts
git commit -m "refactor: inject container URL config into ChatExecutionService, remove hardcoded Docker hostnames"
```

---

## Task 2: WebSocket URL resolution utility

The 3-step priority chain `TELEMETRY_PUBLIC_WS_URL → TELEMETRY_WS_URL → WEBSOCKET_URL` is copy-pasted verbatim into 3 controllers. Extract to a config helper.

**Files:**
- Create: `apps/api/src/config/websocket-url.config.ts`
- Create: `apps/api/src/config/websocket-url.config.spec.ts`
- Modify: `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts`
- Modify: `apps/api/src/notifications/notification-inbox.controller.ts`
- Modify: `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`

- [ ] **Step 1: Write the test**

```typescript
// apps/api/src/config/websocket-url.config.spec.ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveWebSocketUrl } from './websocket-url.config';

describe('resolveWebSocketUrl', () => {
  const save = { ...process.env };
  afterEach(() => { process.env = { ...save }; });

  it('prefers TELEMETRY_PUBLIC_WS_URL', () => {
    process.env.TELEMETRY_PUBLIC_WS_URL = 'wss://public';
    process.env.TELEMETRY_WS_URL = 'ws://internal';
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('wss://public');
  });

  it('falls back to TELEMETRY_WS_URL', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    process.env.TELEMETRY_WS_URL = 'ws://internal';
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('ws://internal');
  });

  it('falls back to WEBSOCKET_URL', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    delete process.env.TELEMETRY_WS_URL;
    process.env.WEBSOCKET_URL = 'ws://fallback';
    expect(resolveWebSocketUrl()).toBe('ws://fallback');
  });

  it('returns null when no WebSocket URL is configured', () => {
    delete process.env.TELEMETRY_PUBLIC_WS_URL;
    delete process.env.TELEMETRY_WS_URL;
    delete process.env.WEBSOCKET_URL;
    expect(resolveWebSocketUrl()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/config/websocket-url.config.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 3: Implement**

```typescript
// apps/api/src/config/websocket-url.config.ts

/**
 * Resolves the WebSocket URL to advertise to clients.
 * Priority: TELEMETRY_PUBLIC_WS_URL > TELEMETRY_WS_URL > WEBSOCKET_URL
 */
export function resolveWebSocketUrl(): string | null {
  return (
    process.env.TELEMETRY_PUBLIC_WS_URL?.trim() ||
    process.env.TELEMETRY_WS_URL?.trim() ||
    process.env.WEBSOCKET_URL?.trim() ||
    null
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx vitest run apps/api/src/config/websocket-url.config.spec.ts
```

Expected: All tests pass.

- [ ] **Step 5: Replace the 3 copy-pasted blocks**

In each of the 3 controllers, find the inline block that looks like:
```typescript
const wsUrl =
  process.env.TELEMETRY_PUBLIC_WS_URL?.trim() ||
  process.env.TELEMETRY_WS_URL?.trim() ||
  process.env.WEBSOCKET_URL?.trim();
```

Replace with:
```typescript
import { resolveWebSocketUrl } from '../../config/websocket-url.config'; // adjust path
const wsUrl = resolveWebSocketUrl();
```

Files:
1. `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts:145–153`
2. `apps/api/src/notifications/notification-inbox.controller.ts:109–120`
3. `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts:58–68`

- [ ] **Step 6: Run tests**

```bash
npx vitest run apps/api/src/chat/ apps/api/src/notifications/ apps/api/src/workflow/workflow-run-operations/
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/config/ \
        apps/api/src/chat/chat-sessions/chat-sessions.controller.ts \
        apps/api/src/notifications/notification-inbox.controller.ts \
        apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts
git commit -m "refactor: consolidate WebSocket URL resolution, add container URL config token"
```

---

## Task 3: OTel endpoint and remaining high-impact process.env reads

The OpenTelemetry endpoint is hardcoded to `localhost:4318`. Service JWT roles are hardcoded magic strings in 3 files.

**Files:**
- Modify: `apps/api/src/observability/tracing.ts`
- Modify: `apps/api/src/chat/chat-actions/chat-to-core-action-http.helpers.ts`
- Modify: `apps/api/src/chat/channel-adapters/telegram/telegram-tool-approval.handler.ts`
- Modify: `apps/api/src/chat/chat-actions/chat-core-lookup.service.ts`
- Create: `apps/api/src/config/service-jwt.constants.ts`

- [ ] **Step 1: Move OTel endpoint to env var**

In `apps/api/src/observability/tracing.ts`, replace the hardcoded URL:

```typescript
// BEFORE (line ~15)
url: 'http://localhost:4318/v1/traces',

// AFTER
url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() || 'http://localhost:4318/v1/traces',
```

Add `OTEL_EXPORTER_OTLP_ENDPOINT` to the startup validation schema if one exists (check `apps/api/src/config/env.validation.ts` or similar).

- [ ] **Step 2: Create shared service JWT constants**

```typescript
// apps/api/src/config/service-jwt.constants.ts

/** Roles granted to internal service-to-service JWT tokens. */
export const SERVICE_JWT_ROLES = ['Admin', 'Developer'] as const;

/** Scopes granted to internal service-to-service JWT tokens for workflow operations. */
export const SERVICE_JWT_SCOPES = [
  'core.workflow-runs:read',
  'core.workflow-runs:write',
  'core.telegram-settings:read',
] as const;
```

- [ ] **Step 3: Replace hardcoded role/scope strings in 3 files**

```typescript
import { SERVICE_JWT_ROLES, SERVICE_JWT_SCOPES } from '../../config/service-jwt.constants';

// Replace inline arrays:
// roles: ['Admin', 'Developer'] → roles: [...SERVICE_JWT_ROLES]
// serviceScopes: ['core.workflow-runs:read', ...] → serviceScopes: [...SERVICE_JWT_SCOPES]
```

Files:
1. `apps/api/src/chat/chat-actions/chat-to-core-action-http.helpers.ts:~84`
2. `apps/api/src/chat/channel-adapters/telegram/telegram-tool-approval.handler.ts`
3. `apps/api/src/chat/chat-actions/chat-core-lookup.service.ts`

- [ ] **Step 4: Run all affected tests**

```bash
npx vitest run apps/api/src/observability/ apps/api/src/chat/
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/observability/tracing.ts \
        apps/api/src/config/service-jwt.constants.ts \
        apps/api/src/chat/
git commit -m "refactor: replace hardcoded OTel endpoint and service JWT constants with config"
```
