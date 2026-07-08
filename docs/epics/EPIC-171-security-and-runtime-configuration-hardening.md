# EPIC-171: Security and Runtime Configuration Hardening

Status: Proposed
Priority: P0
Created: 2026-05-14
Last Updated: 2026-05-14
Owner: Platform Security + API Runtime
Depends On: EPIC-016, EPIC-094, EPIC-116, EPIC-119
Related Analysis:
- `docs/analysis/ANALYSIS-codebase-review-2026-04-25.md`
- Refactor scan performed 2026-05-14

---

## 1. Summary

This epic removes unsafe runtime defaults and fixes configuration/authorization behavior that can make the system insecure or non-deterministic even before larger architecture refactors begin. The main theme is fail-fast configuration: secrets, CORS, Redis, encryption, and database schema behavior must be explicitly configured and validated at startup rather than inferred through permissive fallbacks.

The most urgent issue is that multiple production code paths still silently fall back to the public literal JWT secret `nexus-secret-key`. If `JWT_SECRET` is missing, tokens can be forged by anyone with repository access. This is a security bug, not just technical debt.

---

## 2. Problem Statement

The codebase currently has security-sensitive values and runtime behaviors scattered across application modules. Several files read `process.env` directly and provide permissive fallbacks. Other modules rely on environment behavior that should be centralized, validated, and tested.

This creates several risks:

1. Missing secrets do not fail startup.
2. Different services may sign/verify JWTs with different assumptions.
3. Local, test, and production behavior can drift.
4. Authorization bugs are difficult to detect because policies are encoded inline.
5. TypeORM can mutate schemas outside migration control in non-production environments.

---

## 3. Evidence and Affected Files

### 3.1 Hardcoded JWT fallback still present

Search found `nexus-secret-key` in these production paths:

| File | Current issue |
| --- | --- |
| `apps/api/src/auth/auth.module.ts` | `JwtModule` secret falls back to `nexus-secret-key`. |
| `apps/api/src/chat-execution/chat-execution.service.ts` | Chat execution signs/uses JWT secret via direct env fallback. |
| `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts` | Controller-level `JWT_SECRET` constant has direct fallback. |
| `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts` | Telemetry WebSocket auth helper has direct fallback. |
| `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts` | Workflow run operations use direct fallback when building tokens/URLs. |
| `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts` | Agent container support has private `JWT_SECRET` field with fallback. |
| `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts` | Subagent coordination signs/verifies with direct fallback. |
| `apps/api/src/workflow/workflow-subagents/subagent-provisioning.service.ts` | Subagent provisioning uses direct fallback. |

Test/e2e paths also reference the fallback and need explicit test configuration instead of production-compatible defaults:

- `packages/e2e-tests/src/infra/config.ts`
- `packages/e2e-tests/src/kanban-lifecycle/kanban-lifecycle-runner.ts`
- `packages/e2e-tests/src/run-workflow.ts`
- `apps/api/src/telemetry/telemetry-gateway-connection.helpers.spec.ts`

### 3.2 Kanban internal role guard logic bug

File:

- `apps/kanban/src/common/internal-service-auth.guard.ts`

Current logic rejects any token that does not contain both roles:

```ts
if (!roles.includes("Admin") || !roles.includes("Developer")) {
  throw new UnauthorizedException(...);
}
```

If the desired policy is "Admin or Developer", the condition must be:

```ts
if (!roles.includes("Admin") && !roles.includes("Developer")) {
  throw new UnauthorizedException(...);
}
```

The policy should be made explicit in a named helper, e.g. `hasRequiredInternalRole(roles)`.

### 3.3 TypeORM synchronize still enabled outside production

File:

- `apps/api/src/database/database.module.ts`

Current behavior:

```ts
synchronize: process.env.NODE_ENV !== 'production'
```

This can allow entity definitions to mutate local/test schemas outside migrations, masking migration drift and making failures appear only in production-like environments.

### 3.4 Startup validation is underused

Prior analysis found that `apps/api/src/config/validation.schema.ts` exists but is not consistently wired into `ConfigModule.forRoot`. Required runtime variables should be validated in one place.

Important variables include:

- `JWT_SECRET`
- `SECRET_ENCRYPTION_KEY`
- `REDIS_HOST`
- `REDIS_PORT`
- `REDIS_PASSWORD` when required by deployment mode
- `CORS_ORIGIN`
- service-to-service JWT/audience/issuer settings if present

### 3.5 Kanban-to-Core service JWT construction is embedded in a broad client

File:

- `apps/kanban/src/core/core-workflow-client.service.ts`

Current behavior:

- `resolveCoreJwtToken()` reads `JWT_SECRET` directly from `process.env`.
- The same class constructs service JWT claims, selects default audience/issuer/TTL values, owns HTTP transport, and performs workflow, secret, event ledger, and domain-event calls.
- The service token includes broad scopes such as `core.events:write`, `core.domain-events:write`, `core.workflow-runs:read`, `core.workflow-runs:write`, and `core.secrets:read`.

This is not the same public fallback bug as the API-side `nexus-secret-key` references, but it is the same class of configuration/auth boundary problem. Service-to-service auth should be created by an explicit token provider backed by validated config, not hidden inside a broad Core client.

Recommended fix:

- Add `InternalServiceAuthTokenProvider` or `KanbanCoreAuthTokenProvider`.
- Validate `KANBAN_CORE_BASE_URL`, `KANBAN_CORE_BEARER_TOKEN` or JWT signing mode, `KANBAN_CORE_JWT_AUDIENCE`, `KANBAN_CORE_JWT_ISSUER`, and `KANBAN_CORE_JWT_TTL`.
- Avoid sharing raw `JWT_SECRET` reads across clients. Prefer a dedicated service-token signing config/provider.
- Keep scopes per narrow client capability, or at least centralize scope assignment so `CoreSecretClient` and `WorkflowRunClient` do not implicitly share all scopes.

---

## 4. Goals

1. Remove all production hardcoded JWT secret fallbacks.
2. Centralize secret and auth-related configuration behind typed providers.
3. Wire startup validation so missing required secrets fail application startup.
4. Fix the Kanban internal role claim predicate or make the stricter policy explicit if both roles are intentionally required.
5. Disable TypeORM `synchronize` unconditionally.
6. Add tests proving the app fails fast for missing critical secrets.
7. Replace direct `process.env` reads in security-sensitive paths with injected configuration.
8. Move Kanban-to-Core JWT signing out of `CoreWorkflowClientService` into a validated internal service auth provider.

---

## 5. Non-Goals

1. Do not redesign the entire authentication model.
2. Do not replace JWT auth with a different credential system.
3. Do not implement complete multi-tenant IAM in this epic.
4. Do not migrate all environment variable reads in the repository, only security/runtime-critical ones.
5. Do not change existing token claims except where required to fix validation bugs.

---

## 6. Proposed Design

### 6.1 Add typed runtime config services

Create or extend configuration providers such as:

- `ApiSecurityConfigService`
- `JwtRuntimeConfigService`
- `CorsRuntimeConfigService`
- `DatabaseRuntimeConfigService`
- `RedisRuntimeConfigService`

These should wrap `ConfigService` and expose typed getters that cannot return unsafe defaults for required secrets.

Example shape:

```ts
@Injectable()
export class JwtRuntimeConfigService {
  constructor(private readonly config: ConfigService) {}

  get secret(): string {
    const value = this.config.get<string>('JWT_SECRET');
    if (!value) {
      throw new Error('JWT_SECRET is required');
    }
    return value;
  }
}
```

Prefer startup Zod validation so these runtime throws are safety backstops, not normal control flow.

### 6.2 Wire Zod startup validation

`ConfigModule.forRoot` should call the environment validation function:

```ts
ConfigModule.forRoot({
  isGlobal: true,
  validate: validateEnv,
});
```

The schema should require strong secrets outside test fixtures. Tests that intentionally run without real secrets should inject explicit test values through test module config.

### 6.3 Remove direct JWT env reads

Replace patterns like:

```ts
process.env.JWT_SECRET || 'nexus-secret-key'
```

with injected config. Files that need signing/verifying should depend on one of:

- Nest `JwtService` configured once.
- `JwtRuntimeConfigService`.
- A domain-specific token service, e.g. `InternalServiceTokenService`.

For Kanban-to-Core calls, `apps/kanban/src/core/core-workflow-client.service.ts` should not sign JWTs directly. It should receive an `InternalServiceAuthTokenProvider` or static bearer-token provider through dependency injection.

### 6.4 Make internal role policy explicit

Add focused helpers and tests:

```ts
function hasAnyInternalOperatorRole(roles: string[]): boolean {
  return roles.includes('Admin') || roles.includes('Developer');
}
```

If product/security actually requires both roles, rename the helper accordingly and add tests proving both-role behavior is intentional.

### 6.5 Database migration discipline

Set:

```ts
synchronize: false
```

for all environments. Add a migration check or at minimum a documented command path for local/test schema setup.

---

## 7. Implementation Tasks

### Task 1: Inventory and remove JWT fallback usage

- Replace all production `nexus-secret-key` fallbacks.
- Keep test fixture values only in test setup files.
- Add a lint or grep-based guard to fail if production files contain `nexus-secret-key`.

Affected files:

- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/chat-execution/chat-execution.service.ts`
- `apps/api/src/chat/chat-sessions/chat-sessions.controller.ts`
- `apps/api/src/telemetry/telemetry-gateway-connection.helpers.ts`
- `apps/api/src/workflow/workflow-run-operations/workflow-runs.controller.ts`
- `apps/api/src/workflow/workflow-step-execution/step-agent-container-support.service.ts`
- `apps/api/src/workflow/workflow-subagents/subagent-coordination.service.ts`
- `apps/api/src/workflow/workflow-subagents/subagent-provisioning.service.ts`

### Task 2: Wire startup env validation

- Update `apps/api/src/config/validation.schema.ts`.
- Ensure `ConfigModule.forRoot` invokes validation.
- Add variables required for JWT, encryption, Redis, and CORS.
- Add tests for missing required values.

### Task 3: Fix internal role predicate

- Update `apps/kanban/src/common/internal-service-auth.guard.ts`.
- Add/adjust spec coverage for:
  - Admin only.
  - Developer only.
  - Both roles.
  - Neither role.
  - malformed roles claim.

### Task 4: Disable TypeORM auto-sync

- Update `apps/api/src/database/database.module.ts`.
- Add migration/startup safety check or test.
- Update local development docs if needed.

### Task 5: Normalize e2e/test secret setup

- Update e2e config helpers so tests pass explicit secrets.
- Do not let e2e utilities normalize production fallback behavior.

### Task 6: Extract Kanban-to-Core auth token provider

- Add a dedicated provider for Kanban service-token creation.
- Move `resolveCoreJwtToken()` responsibilities out of `apps/kanban/src/core/core-workflow-client.service.ts`.
- Validate Kanban Core auth settings at startup.
- Add tests for static bearer token mode and JWT signing mode.
- Ensure missing auth configuration fails clearly instead of silently returning an empty authorization header.

---

## 8. Dependencies

- EPIC-016 for authentication/authorization baseline.
- EPIC-094 for operational hardening.
- EPIC-116 for validation boundary patterns.
- EPIC-119 for workflow runtime hardening.

This epic should be completed before broad multi-service or eventing refactors so the runtime has reliable secrets/config behavior.

---

## 9. Acceptance Criteria

1. No production source file contains `process.env.JWT_SECRET || 'nexus-secret-key'` or equivalent fallback.
2. `JWT_SECRET` is mandatory in API startup validation outside explicit test fixtures.
3. `SECRET_ENCRYPTION_KEY` is mandatory and independent from `JWT_SECRET` if encryption is enabled.
4. `ConfigModule.forRoot` invokes environment validation.
5. Kanban internal role guard behavior is covered by tests and matches documented policy.
6. TypeORM `synchronize` is `false` in all environments.
7. Existing auth, telemetry, workflow run, subagent, and chat session tests pass after injecting explicit secrets.
8. A regression guard exists to prevent reintroducing public fallback secrets in production paths.
9. Kanban-to-Core service JWT creation is centralized in a validated provider and no longer embedded in the broad Core workflow client.

---

## 10. Definition of Done

- All implementation tasks are complete.
- Unit tests cover missing config, invalid config, and valid config bootstrapping.
- Security-sensitive direct `process.env` reads are removed or justified.
- Local/e2e test setup is updated to provide explicit secrets.
- Documentation explains required env vars and safe local defaults.
- CI passes for API, Kanban, and relevant e2e configuration tests.
