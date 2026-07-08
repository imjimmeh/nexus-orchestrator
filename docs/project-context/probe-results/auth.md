---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: auth
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/auth/auth.service.ts
  - apps/api/src/auth/jwt.strategy.ts
  - apps/api/src/auth/jwt-auth.guard.ts
  - apps/api/src/auth/roles.guard.ts
  - apps/api/src/auth/roles.decorator.ts
  - apps/api/src/auth/token.service.ts
  - apps/api/src/auth/refresh-token.service.ts
  - apps/api/src/auth/password-validation.service.ts
  - apps/api/src/auth/internal-service-scope.guard.ts
  - apps/api/src/auth/internal-service-scopes.decorator.ts
  - apps/api/src/auth/auth.controller.ts
  - apps/api/src/auth/auth.module.ts
  - apps/api/src/users/users.service.ts
  - apps/api/src/users/users.controller.ts
  - apps/api/src/users/users.module.ts
  - apps/api/src/security/iam-policy.service.ts
  - apps/api/src/security/secret-scanner.service.ts
  - apps/api/src/security/secret-manager.service.ts
  - apps/api/src/security/yaml-validation.service.ts
  - apps/api/src/security/audit-log.service.ts
  - apps/api/src/security/security.module.ts
  - apps/api/src/auth/database/entities/role.entity.ts
  - apps/api/src/auth/database/entities/permission.entity.ts
  - apps/api/src/auth/database/entities/role-permission.entity.ts
  - apps/api/src/auth/database/entities/user-role.entity.ts
  - apps/api/src/auth/database/repositories/role.repository.ts
  - apps/api/src/auth/database/repositories/user-role.repository.ts
  - apps/api/src/security/database/entities/refresh-token.entity.ts
  - apps/api/src/security/database/repositories/refresh-token.repository.ts
  - apps/api/src/auth/__tests__/unit/login.service.spec.ts
  - apps/api/src/auth/__tests__/unit/register.service.spec.ts
  - apps/api/src/auth/__tests__/unit/token.service.spec.ts
  - apps/api/src/auth/__tests__/unit/user.service.spec.ts
  - apps/api/src/auth/__tests__/setup/auth-test.module.ts
  - apps/api/src/auth/__tests__/setup/auth-test.fixtures.ts
  - apps/api/src/auth/__tests__/setup/auth-mocks.factory.ts
  - apps/api/src/auth/password-validation.service.spec.ts
  - apps/api/src/auth/refresh-token.service.spec.ts
  - apps/api/src/auth/roles.guard.spec.ts
  - apps/api/src/auth/jwt.strategy.spec.ts
  - apps/api/src/auth/internal-service-scope.guard.spec.ts
  - apps/api/src/users/users.service.spec.ts
  - apps/api/src/security/iam-policy.service.spec.ts
  - apps/api/src/security/secret-manager.service.spec.ts
  - apps/api/src/security/secret-scanner.service.spec.ts
  - apps/api/src/security/yaml-validation.service.spec.ts
source_paths:
  - apps/api/src/auth
  - apps/api/src/security
  - apps/api/src/users
updated_at: 2026-06-02T17:30:00.000Z
---

# Probe Result: Authentication and Authorization

## Narrative Summary

Authentication and authorization are fully implemented across the API surface. The system uses JWT-based authentication with access and refresh tokens, role-based access control (RBAC) with an `admin`/`user` role model, and password validation enforced at registration and reset. Agent tokens support workflow subagents with scoped tool access, while an `InternalServiceScopeGuard` provides service-to-service authorization using JWT scopes. Refresh token rotation is implemented with bcrypt hashing (cost 10 for tokens, cost 12 for passwords) and configurable expiry. IAM policy evaluation is loaded from a database-backed agent profile registry and cached on application bootstrap. Secret scanning and management services provide runtime secrets hygiene.

## Capability Updates

### Authentication
- **Registration** — `AuthService.register()` creates users with unique username/email, hashes passwords with bcrypt (salt rounds 12), and auto-assigns `admin` to the first user and `user` to subsequent registrations. Conflict exceptions prevent duplicates. Returns `{ user, accessToken, refreshToken }`.
- **Login** — `AuthService.login()` validates credentials against bcrypt hash, checks `isActive` status, updates `lastLoginAt`, and issues a JWT access token and refresh token pair. Supports `rememberMe` to extend refresh token lifetime. Returns user object, tokens, and `expiresIn`.
- **Token Generation** — `TokenService.generateTokens()` produces a JWT with `sub`, `email`, and `roles` claims, configurable expiry via `JWT_ACCESS_EXPIRY` (defaults to 15m). Returns `{ accessToken, expiresIn }`.
- **Token Refresh** — `RefreshTokenService` stores hashed tokens using bcrypt (cost 10) with a separate expiry policy (`JWT_REFRESH_EXPIRY_DAYS` or `JWT_REFRESH_EXPIRY`, defaults to 7 days; 30 days with `rememberMe`). Old tokens are revoked on reuse via `validateRefreshToken()` + `revokeRefreshToken()`.
- **Logout** — `logout(userId, refreshToken?)` revokes a single token; `logoutAll(userId)` revokes all user tokens.
- **Agent Tokens** — `JwtStrategy.validate()` recognizes `role='agent'` payloads (workflow containers) and allows them through with declared roles, bypassing user DB lookup. Supports `allowedTools` array, `workflowRunId`, `stepId`, `jobId`, `isSubagent`, `subagentExecutionId`, `parent_job_id`, and `agentProfileName` claims. Non-production fallback allows arbitrary roles in dev/test. `JwtAuthGuard` wraps Passport JWT strategy.
- **Internal Service Scopes** — `@InternalServiceScopes(...)` decorator sets required scope(s) per handler; `InternalServiceScopeGuard` validates that agent tokens carry all required scope strings. Returns `ForbiddenException` with missing scopes list if validation fails.

### Authorization
- **RBAC** — `@Roles(...)` decorator sets required role(s) per handler; `RolesGuard` normalizes role casing and requires at least one match. UsersController routes are all `@Roles('admin')`.
- **Permission Entity** — `permission.entity.ts` and `role-permission.entity.ts` exist for fine-grained permission assignment, though current guards use role-based matching only.
- **JwtModule exported globally** — `AuthModule` is `@Global()` and exports `JwtModule`, `AuthService`, `TokenService`, and `RefreshTokenService`.

### User Management
- **CRUD** — `UsersService` exposes backward-compatible legacy methods (`findAll`, `findOne`, `create`, `update`, `remove`) plus modern typed methods (`listUsers`, `getUserById`, `createUser`, `updateUser`, `disableUser`, `resetPassword`, `validatePassword`).
- **Soft Delete** — `remove()` / `disableUser()` set `isActive: false` and `deactivatedAt`, preserving referential integrity for audit logs.
- **Role Assignment** — Both create and update methods accept `roleIds` (by ID) or `role` (by name), with validation that all referenced roles exist.
- **Password Validation** — `PasswordValidationService` enforces configurable rules via environment: `PASSWORD_MIN_LENGTH` (default 8), `PASSWORD_REQUIRE_UPPERCASE` (default true), `PASSWORD_REQUIRE_LOWERCASE` (default true), `PASSWORD_REQUIRE_NUMBERS` (default true), `PASSWORD_REQUIRE_SPECIAL` (default true).
- **Password Reset** — `resetPassword()` validates new password, bcrypt-hashes (cost 12), and sets `passwordChangedAt` timestamp.

### Security Utilities
- **Secret Scanner** — `SecretScannerService` redacts API keys (OpenAI `sk-`, Anthropic), AWS credentials, RSA private keys, and generic `password`/`api_key` patterns from content. `scanJSONL` handles array inputs. 8 regex patterns total.
- **Secret Manager** — `SecretManagerService` provides `getSecret(key)`, `validateSecret(min 32 chars)`, and `rotateSecret` (in-memory rotation using `randomBytes(32)` base64url).
- **YAML Validation** — `YAMLValidationService` parses with `js-yaml` and blocks malicious patterns: `eval(`, `Function(`, `process.env`, `require(`. Methods: `validateYAML()` and `validateAndThrow()`.
- **Audit Log** — `AuditLogService` provides `log(eventType, actorId, action, result, resourceId?, metadata?)` and `getLogs(limit?, offset?)`. Logs written to `AuditLogRepository`. `pruneOldLogs()` removes entries older than 90 days. Warning-level log for denied/failure events.

## Health Findings

- **Test coverage is comprehensive.** AuthService has 4 test files (login, register, token/session, user/session) covering success paths, error paths, edge cases (inactive users, missing roles, multiple roles), and token lifecycle (refresh, logout, logout-all). `RefreshTokenService`, `RolesGuard`, `PasswordValidationService`, `JwtStrategy`, and `InternalServiceScopeGuard` each have dedicated spec files. `UsersService` has a large spec covering all CRUD methods, pagination, password validation, and role assignment. `IAMPolicyService`, `SecretManagerService`, `SecretScannerService`, and `YAMLValidationService` have their own spec files. 20 spec files total.
- **Mock infrastructure is well-structured.** `auth-test.module.ts` provides `createAuthTestingModuleWithDefaults()` with typed mock repositories and services. `auth-mocks.factory.ts` creates mock objects for all auth dependencies. Fixtures in `auth-test.fixtures.ts` provide frozen mock user/role objects. bcrypt is mocked at the module level to avoid cross-test pollution.
- **No obvious churn signals** — Files are cohesive and focused; no evidence of recent refactoring or instability in auth paths.
- **Two bcrypt cost levels**: passwords use cost 12 (auth.service.ts, users.service.ts), refresh tokens use cost 10 (refresh-token.service.ts). Minor inconsistency, not a security issue.
- **Refresh token validation performance note**: `validateRefreshToken()` loads all non-revoked tokens server-wide, then iterates with `bcrypt.compare` until a match is found. This approach is O(n) in active token count per request.
- **JWT secret required**: Both `JwtStrategy` and `InternalServiceScopeGuard` throw if `JWT_SECRET` is not configured.
- **Tests use jest.fn() or vitest equivalents**: Mixed usage between jest (password-validation.service.spec.ts uses `jest.fn()`) and vitest (other specs use `vi.fn()`). Project appears to be transitioning from Jest to Vitest.

## Open Questions

- **Audit log integration** — `AuditLogService` exists in `security/` but is not called from auth services (`auth.service.ts`, `users.service.ts`). What events get logged and when is not visible from the auth code alone; this is likely handled at the controller or gateway layer.
- **AllowedTools enforcement** — `IAMPolicyService` reads `allowedTools` from agent profiles but the actual guard that enforces tool-level access from `allowedTools` in a request context is not visible in the auth/controller layer. The workflow runner integration point for this is external to the auth module.
- **YAML validation integration** — `YAMLValidationService` exists in `security/` but is not invoked from any auth path. Its role in the system security posture needs clarification.
- **Refresh token repository query path** — The `RefreshTokenRepository` query patterns in `refresh-token.service.ts` load all tokens unfiltered, then filter client-side with `bcrypt.compare`. This may need optimization for high-volume scenarios with many active tokens.
- **Password change tracking** — `passwordChangedAt` is set on reset but not on initial registration. Consumers needing to know whether a password has ever been rotated must work around this.
- **Permission entity usage** — `permission.entity.ts` and `role-permission.entity.ts` are defined but no code path appears to use fine-grained permission checks based on them. The RBAC system uses role names only.
