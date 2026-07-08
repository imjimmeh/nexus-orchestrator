# P1: Security & Correctness Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three immediate correctness and security issues: unvalidated auth endpoints, a silent DB failure that causes state divergence, and a production stub that always returns zeros.

**Architecture:** Each fix is isolated to a small number of files. Auth fix adds parameter-level `ZodValidationPipe` to three endpoints — no DTO class changes needed. Approval service fix replaces `.catch(() => {})` with proper error logging. Board state fix makes `getBoardStateSummary` async and queries the work item repository by project and status.

**Tech Stack:** NestJS, Zod (`zod`), TypeORM, Vitest

---

## Files

| Action | File |
|---|---|
| Modify | `apps/api/src/auth/auth.controller.ts` |
| Modify | `apps/api/src/capability-governance/tool-call-approval-request.service.ts` |
| Modify | `apps/kanban/src/services/board-state.service.ts` |
| Modify | `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts` |
| Modify | `apps/api/src/auth/auth.controller.spec.ts` (create if absent) |
| Modify | `apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts` |
| Modify | `apps/kanban/src/services/__tests__/board-state.service.spec.ts` (create if absent) |

---

## Task 1: Auth endpoints — add Zod validation

The three auth endpoints (`/register`, `/login`, `/refresh`) accept `@Body() dto` typed as a plain TypeScript type alias. `ZodValidationPipe` only fires when the DTO metatype class has a static `.schema` property, which a type alias never has. The fix is to pass the schema directly as a parameter pipe on each `@Body()` decorator.

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`

- [ ] **Step 1: Write failing tests for oversized input rejection**

Create `apps/api/src/auth/auth.controller.spec.ts` if it doesn't exist:

```typescript
// apps/api/src/auth/auth.controller.spec.ts
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
  refreshToken: vi.fn(),
  logout: vi.fn(),
};

describe('AuthController — input validation', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  it('register — rejects missing email', async () => {
    await expect(
      controller.register({ username: 'alice', password: 'P@ssw0rd1', email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('login — rejects empty password', async () => {
    await expect(
      controller.login({ username: 'alice', password: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refresh — rejects missing refreshToken', async () => {
    await expect(
      // @ts-expect-error intentional bad input
      controller.refresh({}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run apps/api/src/auth/auth.controller.spec.ts
```

Expected: Tests fail — validation is not currently applied, so bad inputs pass through to the mocked service.

- [ ] **Step 3: Apply parameter-level pipes to each endpoint**

```typescript
// apps/api/src/auth/auth.controller.ts
import {
  Controller, Post, Get, Body, Req, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  LoginRequestSchema,
  RegisterRequestSchema,
  RefreshTokenRequestSchema,
} from '@nexus/core';
import type {
  RegisterRequest,
  LoginRequest,
  RefreshTokenRequest,
} from '@nexus/core';

interface RequestWithUser extends Request {
  user: { userId: string; email: string; roles: string[] };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Username or email already exists' })
  async register(
    @Body(new ZodValidationPipe(RegisterRequestSchema)) dto: RegisterRequest,
  ) {
    const result = await this.authService.register(dto);
    return { success: true, data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate user and return tokens' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account is disabled' })
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) dto: LoginRequest,
  ) {
    const result = await this.authService.login(dto);
    return { success: true, data: result };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(
    @Body(new ZodValidationPipe(RefreshTokenRequestSchema)) dto: RefreshTokenRequest,
  ) {
    const result = await this.authService.refreshToken(dto);
    return { success: true, data: result };
  }

  // keep logout endpoint unchanged ...
}
```

**Important:** `LoginRequestSchema`, `RegisterRequestSchema`, `RefreshTokenRequestSchema` are already exported from `packages/core/src/schemas/auth/`. Check `packages/core/src/index.ts` — if they are not re-exported, add them:

```typescript
// packages/core/src/index.ts  — add if missing
export { LoginRequestSchema } from './schemas/auth/login.schema';
export { RegisterRequestSchema } from './schemas/auth/register.schema';
export { RefreshTokenRequestSchema } from './schemas/auth/refresh-token.schema';
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run apps/api/src/auth/auth.controller.spec.ts
```

Expected: All 3 tests pass.

- [ ] **Step 5: Verify the rest of the auth spec still passes**

```bash
npx vitest run apps/api/src/auth/
```

Expected: All existing auth tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.controller.spec.ts packages/core/src/index.ts
git commit -m "fix(auth): add Zod validation to register, login, and refresh endpoints"
```

---

## Task 2: Fix silent DB failure in tool-call-approval timeout

When a tool-approval request times out, the `.catch(() => {})` silently drops a DB update failure. The in-memory state resolves as `expired` while the DB record stays in its previous state.

**Files:**
- Modify: `apps/api/src/capability-governance/tool-call-approval-request.service.ts`
- Modify: `apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts`

- [ ] **Step 1: Write a test asserting the logger is called on DB failure**

Add to `tool-call-approval-request.service.spec.ts`:

```typescript
it('logs error when DB update fails on timeout', async () => {
  // Arrange
  const requestId = 'req-timeout-err';
  const loggerErrorSpy = vi.spyOn(service['logger'], 'error');
  mockRequestRepo.update.mockRejectedValueOnce(new Error('DB connection lost'));

  // Act — start a wait with a very short timeout
  const waitPromise = service.waitForResolution(requestId, 50, 10);
  const result = await waitPromise;

  // Assert
  expect(result.status).toBe('expired');
  expect(loggerErrorSpy).toHaveBeenCalledWith(
    expect.stringContaining('req-timeout-err'),
    expect.any(String),
  );
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts --reporter=verbose
```

Expected: FAIL — `loggerErrorSpy` is never called because the error is swallowed.

- [ ] **Step 3: Fix the timeout handler**

In `apps/api/src/capability-governance/tool-call-approval-request.service.ts`, locate the `setTimeout` callback (around line 151) and replace:

```typescript
// BEFORE
const timeout = setTimeout(() => {
  clearInterval(interval);
  this.pendingWaits.delete(requestId);
  this.requestRepo
    .update(requestId, { status: 'expired' })
    .catch(() => {});
  resolve({ status: 'expired' });
}, timeoutMs);
```

```typescript
// AFTER
const timeout = setTimeout(() => {
  clearInterval(interval);
  this.pendingWaits.delete(requestId);
  this.requestRepo
    .update(requestId, { status: 'expired' })
    .catch((err: unknown) => {
      this.logger.error(
        `Failed to persist expired status for approval request ${requestId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
  resolve({ status: 'expired' });
}, timeoutMs);
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts
```

Expected: All tests pass including the new one.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/capability-governance/tool-call-approval-request.service.ts \
        apps/api/src/capability-governance/tool-call-approval-request.service.spec.ts
git commit -m "fix: log DB failure on tool-approval timeout instead of silently swallowing"
```

---

## Task 3: Implement BoardStateService.getBoardStateSummary

The method is called from production orchestration code but always returns hardcoded zeros. The `KanbanWorkItemRepository` has a `findAll()` method that returns all items; we filter by `project_id` and aggregate by `status`.

**Files:**
- Modify: `apps/kanban/src/services/board-state.service.ts`
- Modify: `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts`
- Create/Modify: `apps/kanban/src/services/__tests__/board-state.service.spec.ts`

- [ ] **Step 1: Write a failing test for the new async implementation**

```typescript
// apps/kanban/src/services/__tests__/board-state.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BoardStateService } from '../board-state.service';

const mockWorkItems = vi.fn();
const mockProjects = vi.fn();
const mockBoardStateRepo = { findLatestByProjectIdAndIdempotencyKeyPrefix: vi.fn() };

const workItemsRepo = {
  findAll: mockWorkItems,
} as any;

describe('BoardStateService.getBoardStateSummary', () => {
  let service: BoardStateService;

  beforeEach(() => {
    service = new BoardStateService(mockBoardStateRepo as any, mockProjects as any, workItemsRepo);
    vi.resetAllMocks();
  });

  it('returns counts from work item repository filtered by project', async () => {
    mockWorkItems.mockResolvedValue([
      { project_id: 'proj-1', status: 'todo' },
      { project_id: 'proj-1', status: 'in-progress' },
      { project_id: 'proj-1', status: 'in-progress' },
      { project_id: 'proj-1', status: 'done' },
      { project_id: 'proj-1', status: 'blocked' },
      { project_id: 'other', status: 'done' }, // different project — excluded
    ]);

    const result = await service.getBoardStateSummary('proj-1');

    expect(result.totalTasks).toBe(5);
    expect(result.completedTasks).toBe(1);
    expect(result.inProgressTasks).toBe(2);
    expect(result.blockedTasks).toBe(1);
    expect(result.pendingTasks).toBe(1); // todo
    expect(result.projectId).toBe('proj-1');
  });

  it('returns zeros for an empty project', async () => {
    mockWorkItems.mockResolvedValue([]);

    const result = await service.getBoardStateSummary('proj-empty');

    expect(result.totalTasks).toBe(0);
    expect(result.completedTasks).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run apps/kanban/src/services/__tests__/board-state.service.spec.ts
```

Expected: FAIL — method returns hardcoded zeros.

- [ ] **Step 3: Implement the method**

```typescript
// apps/kanban/src/services/board-state.service.ts
// Change getBoardStateSummary from sync to async:

async getBoardStateSummary(projectId: string): Promise<BoardStateSummary> {
  const allItems = await this.workItems.findAll();
  const projectItems = allItems.filter((item) => item.project_id === projectId);

  const byStatus = projectItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  const lastItem = projectItems
    .filter((item) => item.updated_at != null)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0];

  return {
    projectId,
    totalTasks: projectItems.length,
    completedTasks: byStatus['done'] ?? 0,
    blockedTasks: byStatus['blocked'] ?? 0,
    inProgressTasks: byStatus['in-progress'] ?? 0,
    pendingTasks: (byStatus['todo'] ?? 0) + (byStatus['backlog'] ?? 0),
    lastActivityAt: lastItem?.updated_at ? new Date(lastItem.updated_at) : null,
    column_counts: byStatus,
    total_items: projectItems.length,
    work_item_counts: {
      total: projectItems.length,
      byStatus,
      activeCount: (byStatus['in-progress'] ?? 0) + (byStatus['in-review'] ?? 0),
      doneCount: byStatus['done'] ?? 0,
    },
  };
}
```

- [ ] **Step 4: Update the caller to await**

In `apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts` around line 289:

```typescript
// BEFORE
const serviceBoardStateSummary = this.boardStateService.getBoardStateSummary(
  params.projectId,
);

// AFTER
const serviceBoardStateSummary = await this.boardStateService.getBoardStateSummary(
  params.projectId,
);
```

- [ ] **Step 5: Run the new tests**

```bash
npx vitest run apps/kanban/src/services/__tests__/board-state.service.spec.ts
```

Expected: All tests pass.

- [ ] **Step 6: Run the full kanban test suite to catch any signature regressions**

```bash
npx vitest run apps/kanban/
```

Expected: All tests pass. If any test mocked `getBoardStateSummary` with `mockReturnValue` (sync), update those mocks to `mockResolvedValue`.

- [ ] **Step 7: Commit**

```bash
git add apps/kanban/src/services/board-state.service.ts \
        apps/kanban/src/mcp/tools/mutation/complete-orchestration-cycle-decision.tool.ts \
        apps/kanban/src/services/__tests__/board-state.service.spec.ts
git commit -m "fix(kanban): implement getBoardStateSummary with real work item counts"
```
