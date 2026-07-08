# EPIC-186: Cross-Module Coupling Decoupling

**Status:** Proposed
**Priority:** P1
**Depends On:** None
**Related Epics:** EPIC-123 (Service Decomposition), EPIC-173 (Large Service Decomposition), EPIC-182 (ToolModule Decomposition)
**Last Updated:** 2026-05-16

---

## 1. Summary

Multiple modules have heavy, direct dependencies on `auth/`, `observability/`, and `settings/`, creating coupling hotspots. `settings/auth: 11`, `automation/auth: 12`, `memory/auth: 4`, `telemetry/observability: 4`. Auth is a coupling hub — every module depends on it directly rather than through an abstraction. This makes auth changes propagate everywhere and makes testing any module that depends on auth require auth's full setup.

This epic introduces port interfaces for coupling-heavy modules, creating real seams where behavior can be altered without editing in place.

---

## 2. High-Level Context

### 2.1 Coupling Hotspots (Cross-Module Import Counts)

| Dependent → Provider | Import Count | Example Files |
|---------------------|--------------|---------------|
| `settings → auth` | 11 | `settings/` services importing auth types/guards |
| `automation → auth` | 12 | `automation-hooks.controller.ts`, `automation.module.ts`, standing order services |
| `memory → auth` | 4 | `memory/learning/learning.service.ts`, memory segment services |
| `telemetry → observability` | 4 | `telemetry-gateway-compat.helpers.ts`, telemetry services |
| `memory → observability` | 4 | Memory services importing observability |
| `users → auth` | 6 | User services importing auth types |
| `automation → settings` | 3 | Automation services importing settings |
| `chat-execution → settings` | 3 | Chat execution services |
| `war-room → settings` | 3 | War room services |
| `telemetry → settings` | 1 | Telemetry services |
| `mcp → auth` | 3 | MCP services |
| `notifications → auth` | 1 | Notification services |
| `session → security` | 1 | Session services |
| `telemetry → war-room` | 3 | Telemetry services importing war room |
| `users → memory` | 3 | User services importing memory |
| `session → chat` | 1 | Session services |
| `session → memory` | 1 | Session services |
| `acp → auth` | 3 | ACP services |
| `observability → auth` | 5 | Observability services |
| `operations → auth` | 3 | Operations services |
| `setup → auth` | 3 | Setup services |
| `chat → telemetry` | 2 | Chat services |
| `notifications → telemetry` | 1 | Notification services |
| `operations → automation` | 2 | Operations services |
| `operations → mcp` | 3 | Operations services |
| `acp → observability` | 2 | ACP services |
| `mcp → observability` | 2 | MCP services |
| `war-room → observability` | 2 | War room services |

### 2.2 Problem Patterns

**Pattern A: Direct auth dependency**
Modules import `AuthService`, `AuthGuard`, or auth types directly. Changes to auth require recompiling and retesting every dependent module.

**Pattern B: Observability as a coupling hub**
`telemetry/`, `memory/`, `mcp/`, `acp/`, `war-room/`, `observability/` all import from `observability/`. This is a similar pattern to auth — a shared concern that should have a port.

**Pattern C: Settings as a configuration dependency**
Multiple modules import `SystemSettingsService` directly. Settings changes ripple through the codebase.

### 2.3 Why This Matters

1. **Test coupling:** Testing `automation/` requires setting up `auth/` even if tests don't exercise auth logic.
2. **Change propagation:** Changing `AuthService` signature requires updating 12+ modules.
3. **Mocking complexity:** Unit tests must mock the full auth module instead of a simple interface.
4. **Swapping impossibility:** Can't swap auth strategies (JWT → OAuth → API key) without touching every dependent module.

---

## 3. Goals

1. Create port interfaces for the top 3 coupling hotspots: `auth/`, `observability/`, `settings/`.
2. Reduce direct imports from coupling hubs by 50%+.
3. Ensure every module depends on abstractions, not concrete implementations.
4. Make the deletion test pass: deleting `auth/`'s concrete implementation doesn't break dependent modules (they depend on the port).
5. Zero behavioral changes — this is a pure interface decoupling.

---

## 4. Non-Goals

1. No changes to auth logic, observability instrumentation, or settings management internals.
2. No changes to database schema or entity locations.
3. No changes to external API contracts.
4. No decoupling of low-impact dependencies (e.g., `notifications → auth: 1` is not worth the effort).

---

## 5. Implementation Phases

### Phase 1: Auth Port

- **Task E186-001: Create `IAuthenticationPort` interface**
  - Define in `shared/interfaces/authentication.port.ts`.
  - Methods based on what consumers actually need:
    ```typescript
    export interface IAuthenticationPort {
      getUserById(id: string): Promise<User | null>;
      getUserByRole(role: string): Promise<User[]>;
      hasPermission(user: User, permission: string): boolean;
      hasRole(user: User, role: string): boolean;
      getActiveSessions(userId: string): Promise<Session[]>;
      validateToken(token: string): Promise<ValidatedToken | null>;
    }
    ```
  - Define input/output types in the same file.

- **Task E186-002: Make `AuthModule` implement the port**
  - Create `AuthService` that implements `IAuthenticationPort`.
  - Register binding: `{ provide: 'IAuthenticationPort', useClass: AuthService }`.
  - **Files:** `auth/auth.module.ts`, `auth/auth.service.ts` (modify or wrap).

- **Task E186-003: Update high-impact importers**
  - Update `settings/` (11 imports), `automation/` (12 imports), `users/` (6 imports), `observability/` (5 imports) to inject `IAuthenticationPort` instead of `AuthService`.
  - **Files:** ~30 files across these modules.

- **Task E186-004: Update remaining importers**
  - Update `memory/`, `mcp/`, `acp/`, `notifications`, `session/`, `setup/`, `operations/`, `chat/`, `war-room/`, `telemetry/`.
  - **Files:** ~20 more files.

### Phase 2: Observability Port

- **Task E186-005: Create `IObservabilityPort` interface**
  - Define in `shared/interfaces/observability.port.ts`.
  - Methods:
    ```typescript
    export interface IObservabilityPort {
      recordEvent(event: ObservabilityEvent): void;
      recordMetric(metric: ObservabilityMetric): void;
      traceOperation(operation: string, fn: () => Promise<void>): Promise<void>;
      getCorrelationId(): string | undefined;
    }
    ```

- **Task E186-006: Make `ObservabilityModule` implement the port**
  - Register binding: `{ provide: 'IObservabilityPort', useClass: ObservabilityService }`.
  - Update `telemetry/`, `memory/`, `mcp/`, `acp/`, `war-room/` to inject the port.

### Phase 3: Settings Port

- **Task E186-007: Create `ISettingsPort` interface**
  - Define in `shared/interfaces/settings.port.ts`.
  - Methods:
    ```typescript
    export interface ISettingsPort {
      getSetting(key: string): Promise<string | null>;
      getSettings(keys: string[]): Promise<Record<string, string>>;
      updateSetting(key: string, value: string): Promise<void>;
      getSystemSettings(): Promise<SystemSettings>;
    }
    ```

- **Task E186-008: Make `SystemSettingsModule` implement the port**
  - Register binding: `{ provide: 'ISettingsPort', useClass: SystemSettingsService }`.
  - Update `automation/`, `chat-execution/`, `war-room/`, `telemetry/` to inject the port.

### Phase 4: Verify

- **Task E186-009: Run build and typecheck**
  - `npm run build:api`
  - Verify zero TypeScript errors.

- **Task E186-010: Run lint**
  - `npm run lint:api`
  - Fix any lint findings.

- **Task E186-011: Run tests**
  - `npm run test:api`
  - Verify all tests pass.

- **Task E186-012: Verify coupling reduction**
  - Re-run the import audit.
  - Target: 50%+ reduction in direct imports from `auth/`, `observability/`, `settings/`.

---

## 6. Expected Outcomes

| Metric | Before | After |
|--------|--------|-------|
| Direct `auth/` imports across modules | ~50 | ≤ 20 (via port) |
| Direct `observability/` imports | ~15 | ≤ 5 (via port) |
| Direct `settings/` imports | ~10 | ≤ 3 (via port) |
| Modules that can test without auth setup | ~8 | ~20 |
| Auth strategy swap cost | 12+ modules | 1 module (AuthModule) |

---

## 7. Risk and Mitigation

| Risk | Mitigation |
|------|-----------|
| Some consumers need auth methods not in the port | Add the method to the port interface — the port should be the union of all consumer needs |
| Circular dependency between port and implementation | Use string token injection; place port interfaces in `shared/interfaces/` which has no dependencies |
| Performance impact of port indirection | Negligible — port is an interface, not a middleware layer. The concrete implementation is the same class. |
| Tests that mock `AuthService` directly break | Update tests to mock `IAuthenticationPort` instead — this is the desired behavior |
