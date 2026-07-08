# Memory Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate DRY violations and naming confusion across the memory subsystem without changing any runtime behavior.

**Architecture:** Three targeted changes: (1) rename the chat `MemoryModule` class to `ChatMemoryModule` to eliminate the naming collision with the global memory module, (2) delete three thin-wrapper services (System/User/Project) that are pure pass-throughs to `MemoryListingService`, injecting that service directly into their controllers, (3) rename `DualReadMemoryBackendService` to `HonchoFallbackMemoryBackendService` with clarifying documentation so its distinct purpose is obvious.

**Tech Stack:** NestJS, TypeScript, Vitest

---

## Analysis Summary

### What is fine — do not change
- The two-tier memory system (generic `MemorySegment` vs chat `ChatSessionMemory`/`ChatProfileMemory`) is intentional and correct. They have different lifecycles and schemas.
- The Strategy pattern across three backend implementations is sound.
- The chat memory pipeline (`lifecycle → context-assembler → distillation → jobs`) is well-structured with clear SRP.
- `MemoryManagerService` as a facade over the backend is appropriate.

### What needs fixing

| Issue | File(s) | Severity |
|---|---|---|
| `MemoryModule` class collision — both global and chat modules export a class with the same name | `apps/api/src/chat/memory/memory.module.ts` | High |
| `SystemMemoryService` is a 28-line wrapper that only hardcodes `entityType = 'System'` | `apps/api/src/memory/system-memory.service.ts` | High |
| `UserMemoryService` is a 28-line wrapper that only hardcodes `entityType = 'User'` | `apps/api/src/users/user-memory.service.ts` | High |
| `ProjectMemoryService` is a 26-line wrapper that only hardcodes `entityType = 'Project'` | `apps/api/src/project/project-memory.service.ts` | High |
| `ProjectMemorySegmentsPage` is a meaningless type alias for `MemorySegmentsPage` | `apps/api/src/project/project-memory.types.ts` | Medium |
| `DualReadMemoryBackendService` purpose is unclear — it wraps `HonchoMemoryBackendService` to force-always-fallback but this isn't documented | `apps/api/src/memory/dual-read-memory-backend.service.ts` | Low |

---

## File Map

### Files to DELETE
- `apps/api/src/memory/system-memory.service.ts`
- `apps/api/src/users/user-memory.service.ts`
- `apps/api/src/users/user-memory.service.spec.ts`
- `apps/api/src/project/project-memory.service.ts`
- `apps/api/src/project/project-memory.service.spec.ts`
- `apps/api/src/project/project-memory.types.ts`

### Files to MODIFY
- `apps/api/src/chat/memory/memory.module.ts` — rename class `MemoryModule` → `ChatMemoryModule`
- `apps/api/src/chat/chat.module.ts` — update import of renamed module
- `apps/api/src/chat/chat-sessions/chat-sessions.module.ts` — update import of renamed module
- `apps/api/src/chat/chat-messages/chat-messages.module.ts` — update import of renamed module
- `apps/api/src/memory/memory.module.ts` — remove `SystemMemoryService` provider; remove import
- `apps/api/src/memory/system-memory.controller.ts` — inject `MemoryListingService` directly
- `apps/api/src/users/users.module.ts` — remove `UserMemoryService` provider; remove import
- `apps/api/src/users/user-memory.controller.ts` — inject `MemoryListingService` directly
- `apps/api/src/users/user-memory.controller.spec.ts` — mock `MemoryListingService` directly
- `apps/api/src/project/project.module.ts` — remove `ProjectMemoryService` provider; remove import
- `apps/api/src/project/project-memory.controller.ts` — inject `MemoryListingService` directly
- `apps/api/src/project/project-memory.controller.spec.ts` — mock `MemoryListingService` directly
- `apps/api/src/memory/dual-read-memory-backend.service.ts` — rename class + add clarifying comment

---

## Task 1: Rename `ChatMemoryModule` class and file

**Problem:** `apps/api/src/chat/memory/memory.module.ts` exports a class named `MemoryModule`. This is identical to the global `MemoryModule` class at `apps/api/src/memory/memory.module.ts`. Any developer reading an import of `MemoryModule` cannot tell which module they are dealing with without checking the path.

**Files:**
- Modify: `apps/api/src/chat/memory/memory.module.ts`
- Modify: `apps/api/src/chat/chat.module.ts`
- Modify: `apps/api/src/chat/chat-sessions/chat-sessions.module.ts`
- Modify: `apps/api/src/chat/chat-messages/chat-messages.module.ts`

- [ ] **Step 1: Rename the class in the chat memory module**

In `apps/api/src/chat/memory/memory.module.ts`, change the exported class name from `MemoryModule` to `ChatMemoryModule`:

```typescript
// apps/api/src/chat/memory/memory.module.ts
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ChatMemoryContextAssemblerService } from './chat-memory-context-assembler.service';
import { ChatMemoryDistillationService } from './chat-memory-distillation.service';
import { ChatMemoryEventPublisherService } from './chat-memory-event-publisher.service';
import { ChatMemoryJobService } from './chat-memory-job.service';
import { ChatMemoryLifecycleService } from './chat-memory-lifecycle.service';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';
import { ChatMemoryObservabilityController } from './chat-memory-observability.controller';
import { ChatMemorySchemaBootstrapService } from './chat-memory-schema-bootstrap.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ChatMemoryObservabilityController],
  providers: [
    ChatMemoryMetricsService,
    ChatMemoryEventPublisherService,
    ChatMemoryContextAssemblerService,
    ChatMemoryDistillationService,
    ChatMemorySchemaBootstrapService,
    ChatMemoryJobService,
    ChatMemoryLifecycleService,
  ],
  exports: [ChatMemoryLifecycleService, ChatMemoryMetricsService],
})
export class ChatMemoryModule {}
```

- [ ] **Step 2: Update `chat.module.ts`**

In `apps/api/src/chat/chat.module.ts`, find the import:
```typescript
import { MemoryModule } from './memory/memory.module';
```
Change to:
```typescript
import { ChatMemoryModule } from './memory/memory.module';
```
Also update the `imports` array in `@Module()` from `MemoryModule` to `ChatMemoryModule`.

- [ ] **Step 3: Update `chat-sessions.module.ts`**

In `apps/api/src/chat/chat-sessions/chat-sessions.module.ts`, find the import:
```typescript
import { MemoryModule } from '../memory/memory.module';
```
Change to:
```typescript
import { ChatMemoryModule } from '../memory/memory.module';
```
Also update the `imports` array in `@Module()` from `MemoryModule` to `ChatMemoryModule`.

- [ ] **Step 4: Update `chat-messages.module.ts`**

In `apps/api/src/chat/chat-messages/chat-messages.module.ts`, find the import:
```typescript
import { MemoryModule } from '../memory/memory.module';
```
Change to:
```typescript
import { ChatMemoryModule } from '../memory/memory.module';
```
Also update the `imports` array in `@Module()` from `MemoryModule` to `ChatMemoryModule`.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors related to `MemoryModule` / `ChatMemoryModule`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/chat/memory/memory.module.ts \
        apps/api/src/chat/chat.module.ts \
        apps/api/src/chat/chat-sessions/chat-sessions.module.ts \
        apps/api/src/chat/chat-messages/chat-messages.module.ts
git commit -m "refactor(memory): rename MemoryModule to ChatMemoryModule in chat domain

The chat memory module class was named identically to the global
MemoryModule, making imports ambiguous. Renaming to ChatMemoryModule
makes the ownership clear at a glance."
```

---

## Task 2: Remove `SystemMemoryService` wrapper

**Problem:** `SystemMemoryService` is a 28-line class whose entire body is:
```typescript
return this.memoryListingService.listSegments({
  entityType: 'System',
  ...params,
});
```
The controller can call `MemoryListingService` directly. `MemoryListingService` is exported by the global `MemoryModule`, so it is injectable in any provider without an additional `imports` entry.

**Files:**
- Modify: `apps/api/src/memory/system-memory.controller.ts`
- Modify: `apps/api/src/memory/memory.module.ts`
- Delete: `apps/api/src/memory/system-memory.service.ts`

- [ ] **Step 1: Update `SystemMemoryController` to use `MemoryListingService` directly**

Replace the entire contents of `apps/api/src/memory/system-memory.controller.ts`:

```typescript
import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MemoryListingService } from './memory-listing.service';
import { ListMemorySegmentsDto } from './dto/list-memory-segments.dto';
import type { MemorySegmentsPage } from './memory-listing.types';

const SYSTEM_MEMORY_ENTITY_TYPE = 'System';

interface RequestWithUser extends Request {
  user: {
    roles: string[];
  };
}

@ApiTags('memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('memory/system')
export class SystemMemoryController {
  constructor(private readonly memoryListingService: MemoryListingService) {}

  @Get('segments')
  @ApiOperation({ summary: 'List system memory segments' })
  async listSegments(
    @Query() query: ListMemorySegmentsDto,
    @Req() req: RequestWithUser,
  ): Promise<{ success: true; data: MemorySegmentsPage }> {
    ensureAdminAccess(req.user.roles);

    const data = await this.memoryListingService.listSegments({
      entityType: SYSTEM_MEMORY_ENTITY_TYPE,
      entityId: query.entity_id,
      memoryType: query.memory_type,
      query: query.query,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data };
  }
}

function ensureAdminAccess(roles: string[]): void {
  const isAdmin = roles.some((role) => role.toLowerCase() === 'admin');
  if (!isAdmin) {
    throw new ForbiddenException('Only admins can view system memory');
  }
}
```

- [ ] **Step 2: Remove `SystemMemoryService` from `memory.module.ts`**

In `apps/api/src/memory/memory.module.ts`:
- Remove `import { SystemMemoryService } from './system-memory.service';`
- Remove `SystemMemoryService` from the `providers` array

- [ ] **Step 3: Delete `system-memory.service.ts`**

```bash
rm apps/api/src/memory/system-memory.service.ts
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/system-memory.controller.ts \
        apps/api/src/memory/memory.module.ts
git rm apps/api/src/memory/system-memory.service.ts
git commit -m "refactor(memory): remove SystemMemoryService pass-through wrapper

The service added no logic beyond hardcoding entityType='System' and
delegating to MemoryListingService. The controller now injects
MemoryListingService directly, removing an unnecessary indirection layer."
```

---

## Task 3: Remove `UserMemoryService` wrapper

**Problem:** `UserMemoryService` is structurally identical to `SystemMemoryService` — it hardcodes `entityType = 'User'` and delegates to `MemoryListingService`. Its spec tests the delegation mapping, not any real logic.

**Files:**
- Modify: `apps/api/src/users/user-memory.controller.ts`
- Modify: `apps/api/src/users/user-memory.controller.spec.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Delete: `apps/api/src/users/user-memory.service.ts`
- Delete: `apps/api/src/users/user-memory.service.spec.ts`

- [ ] **Step 1: Update `user-memory.controller.spec.ts` to mock `MemoryListingService`**

The controller spec currently mocks `UserMemoryService`. Update it to mock `MemoryListingService` directly and verify the controller passes `entityType: 'User'`:

```typescript
// apps/api/src/users/user-memory.controller.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { UserMemoryController } from './user-memory.controller';
import type { MemoryListingService } from '../memory/memory-listing.service';

const USER_ENTITY_TYPE = 'User';

describe('UserMemoryController', () => {
  const listSegments = vi.fn();

  let controller: UserMemoryController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new UserMemoryController({
      listSegments,
    } as unknown as MemoryListingService);
  });

  it('lists memory segments for the requesting user', async () => {
    listSegments.mockResolvedValue({
      items: [
        {
          id: 'seg-1',
          entity_type: USER_ENTITY_TYPE,
          entity_id: 'user-1',
          content: 'Prefers dark mode',
          memory_type: 'preference',
          version: 1,
          created_at: '2026-04-27T00:00:00.000Z',
          updated_at: '2026-04-27T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });

    const req = { user: { userId: 'user-1', roles: [] } } as any;
    const result = await controller.listSegments('user-1', { memory_type: 'preference', limit: 25, offset: 0 }, req);

    expect(listSegments).toHaveBeenCalledWith({
      entityType: USER_ENTITY_TYPE,
      entityId: 'user-1',
      memoryType: 'preference',
      query: undefined,
      limit: 25,
      offset: 0,
    });
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it('allows admin to view another user memory', async () => {
    listSegments.mockResolvedValue({ items: [], total: 0, limit: 25, offset: 0 });

    const req = { user: { userId: 'admin-1', roles: ['Admin'] } } as any;
    await controller.listSegments('other-user', { limit: 25, offset: 0 }, req);

    expect(listSegments).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'other-user' }),
    );
  });

  it('throws ForbiddenException when non-admin views another users memory', async () => {
    const req = { user: { userId: 'user-1', roles: [] } } as any;

    await expect(
      controller.listSegments('user-2', { limit: 25, offset: 0 }, req),
    ).rejects.toThrow(ForbiddenException);

    expect(listSegments).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run spec to verify it fails (Red)**

```bash
npx vitest run apps/api/src/users/user-memory.controller.spec.ts
```
Expected: FAIL — controller still injects `UserMemoryService`.

- [ ] **Step 3: Update `UserMemoryController` to inject `MemoryListingService` directly**

Replace the entire contents of `apps/api/src/users/user-memory.controller.ts`:

```typescript
import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MemoryListingService } from '../memory/memory-listing.service';
import { ListMemorySegmentsDto } from '../memory/dto/list-memory-segments.dto';
import type { MemorySegmentsPage } from '../memory/memory-listing.types';

const USER_MEMORY_ENTITY_TYPE = 'User';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    roles: string[];
  };
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/:userId/memory')
export class UserMemoryController {
  constructor(private readonly memoryListingService: MemoryListingService) {}

  @Get('segments')
  @ApiOperation({ summary: 'List user memory segments' })
  async listSegments(
    @Param('userId') userId: string,
    @Query() query: ListMemorySegmentsDto,
    @Req() req: RequestWithUser,
  ): Promise<{ success: true; data: MemorySegmentsPage }> {
    const resolvedUserId = resolveAccessibleUserId(req.user, userId);

    const data = await this.memoryListingService.listSegments({
      entityType: USER_MEMORY_ENTITY_TYPE,
      entityId: resolvedUserId,
      memoryType: query.memory_type,
      query: query.query,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data };
  }
}

function resolveAccessibleUserId(
  user: RequestWithUser['user'],
  requestedUserId: string,
): string {
  if (isAdminUser(user.roles)) {
    return requestedUserId;
  }

  if (requestedUserId !== user.userId) {
    throw new ForbiddenException(
      'Non-admin users can only view their own memory',
    );
  }

  return requestedUserId;
}

function isAdminUser(roles: string[]): boolean {
  return roles.some((role) => role.toLowerCase() === 'admin');
}
```

- [ ] **Step 4: Run spec to verify it passes (Green)**

```bash
npx vitest run apps/api/src/users/user-memory.controller.spec.ts
```
Expected: PASS all 3 tests.

- [ ] **Step 5: Remove `UserMemoryService` from `users.module.ts`**

In `apps/api/src/users/users.module.ts`:
- Remove `import { UserMemoryService } from './user-memory.service';`
- Remove `UserMemoryService` from the `providers` array

The updated module:
```typescript
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PasswordValidationService } from './password-validation.service';
import { UserMemoryController } from './user-memory.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [DatabaseModule],
  controllers: [UsersController, UserMemoryController],
  providers: [UsersService, PasswordValidationService],
  exports: [UsersService],
})
export class UsersModule {
  /** User management module */
  protected readonly _moduleName = 'UsersModule';
}
```

- [ ] **Step 6: Delete `user-memory.service.ts` and `user-memory.service.spec.ts`**

```bash
rm apps/api/src/users/user-memory.service.ts
rm apps/api/src/users/user-memory.service.spec.ts
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users/user-memory.controller.ts \
        apps/api/src/users/user-memory.controller.spec.ts \
        apps/api/src/users/users.module.ts
git rm apps/api/src/users/user-memory.service.ts \
       apps/api/src/users/user-memory.service.spec.ts
git commit -m "refactor(users): remove UserMemoryService pass-through wrapper

UserMemoryService added no logic beyond hardcoding entityType='User'.
The controller now injects the global MemoryListingService directly.
Controller spec updated to mock MemoryListingService and now also covers
the admin-bypass and ForbiddenException paths."
```

---

## Task 4: Remove `ProjectMemoryService` wrapper and `project-memory.types.ts`

**Problem:** `ProjectMemoryService` is the same pass-through pattern. Additionally, `project-memory.types.ts` exports:
- `ProjectMemorySegmentsPage = MemorySegmentsPage` — a type alias that adds no information
- `ListProjectMemorySegmentsParams` — a struct that simply re-wraps params the controller already extracts from its DTO

Both can be eliminated.

**Files:**
- Modify: `apps/api/src/project/project-memory.controller.ts`
- Modify: `apps/api/src/project/project-memory.controller.spec.ts`
- Modify: `apps/api/src/project/project.module.ts`
- Delete: `apps/api/src/project/project-memory.service.ts`
- Delete: `apps/api/src/project/project-memory.service.spec.ts`
- Delete: `apps/api/src/project/project-memory.types.ts`

- [ ] **Step 1: Update `project-memory.controller.spec.ts` to mock `MemoryListingService`**

```typescript
// apps/api/src/project/project-memory.controller.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectMemoryController } from './project-memory.controller';
import type { MemoryListingService } from '../memory/memory-listing.service';

const PROJECT_ENTITY_TYPE = 'Project';

describe('ProjectMemoryController', () => {
  const listSegments = vi.fn();

  let controller: ProjectMemoryController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ProjectMemoryController({
      listSegments,
    } as unknown as MemoryListingService);
  });

  it('lists project memory segments with filters', async () => {
    listSegments.mockResolvedValue({
      items: [
        {
          id: 'segment-1',
          entity_type: PROJECT_ENTITY_TYPE,
          entity_id: 'project-1',
          memory_type: 'fact',
          content: 'Keep tests deterministic',
          version: 1,
          created_at: '2026-04-16T00:00:00.000Z',
          updated_at: '2026-04-16T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });

    const result = await controller.listSegments('project-1', {
      memory_type: 'fact',
      query: 'deterministic',
      limit: 25,
      offset: 0,
    });

    expect(listSegments).toHaveBeenCalledWith({
      entityType: PROJECT_ENTITY_TYPE,
      entityId: 'project-1',
      memoryType: 'fact',
      query: 'deterministic',
      limit: 25,
      offset: 0,
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ total: 1 }),
    });
  });
});
```

- [ ] **Step 2: Run spec to verify it fails (Red)**

```bash
npx vitest run apps/api/src/project/project-memory.controller.spec.ts
```
Expected: FAIL — controller still injects `ProjectMemoryService`.

- [ ] **Step 3: Update `ProjectMemoryController` to inject `MemoryListingService` directly**

Replace the entire contents of `apps/api/src/project/project-memory.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { MemoryListingService } from '../memory/memory-listing.service';
import { ListMemorySegmentsDto } from '../memory/dto/list-memory-segments.dto';
import type { MemorySegmentsPage } from '../memory/memory-listing.types';

const PROJECT_MEMORY_ENTITY_TYPE = 'Project';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('projects/:projectId/memory')
export class ProjectMemoryController {
  constructor(private readonly memoryListingService: MemoryListingService) {}

  @Get('segments')
  @Roles('Admin', 'Developer')
  @ApiOperation({ summary: 'List project memory segments' })
  async listSegments(
    @Param('projectId') projectId: string,
    @Query() query: ListMemorySegmentsDto,
  ): Promise<{ success: true; data: MemorySegmentsPage }> {
    const data = await this.memoryListingService.listSegments({
      entityType: PROJECT_MEMORY_ENTITY_TYPE,
      entityId: projectId,
      memoryType: query.memory_type,
      query: query.query,
      limit: query.limit,
      offset: query.offset,
    });

    return { success: true, data };
  }
}
```

- [ ] **Step 4: Run spec to verify it passes (Green)**

```bash
npx vitest run apps/api/src/project/project-memory.controller.spec.ts
```
Expected: PASS.

- [ ] **Step 5: Remove `ProjectMemoryService` from `project.module.ts`**

In `apps/api/src/project/project.module.ts`:
- Remove `import { ProjectMemoryService } from './project-memory.service';`
- Remove `ProjectMemoryService` from the `providers` array

- [ ] **Step 6: Delete service, spec, and types files**

```bash
rm apps/api/src/project/project-memory.service.ts
rm apps/api/src/project/project-memory.service.spec.ts
rm apps/api/src/project/project-memory.types.ts
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/project/project-memory.controller.ts \
        apps/api/src/project/project-memory.controller.spec.ts \
        apps/api/src/project/project.module.ts
git rm apps/api/src/project/project-memory.service.ts \
       apps/api/src/project/project-memory.service.spec.ts \
       apps/api/src/project/project-memory.types.ts
git commit -m "refactor(project): remove ProjectMemoryService and project-memory.types pass-throughs

ProjectMemoryService added no logic. ProjectMemorySegmentsPage was a
transparent alias for MemorySegmentsPage. Controller now injects
MemoryListingService directly with entity type hardcoded as a constant."
```

---

## Task 5: Rename `DualReadMemoryBackendService` to clarify purpose

**Problem:** The class name `DualReadMemoryBackendService` is misleading. Its actual behavior is: *use `HonchoMemoryBackendService` for reads, but always fall back to PostgreSQL on error regardless of the `HONCHO_FALLBACK_ON_ERROR` config flag*. This distinction from plain `honcho` mode is not obvious. The class itself is legitimate (not a DRY violation) — the two modes differ subtly: `honcho` mode respects `HONCHO_FALLBACK_ON_ERROR`, while this mode overrides it to always fall back.

This task renames the class and file to communicate the intent clearly, and adds a doc comment to make the behavioral distinction explicit.

**Files:**
- Modify: `apps/api/src/memory/dual-read-memory-backend.service.ts` — rename class and add doc comment
- Modify: `apps/api/src/memory/memory.module.ts` — update import and class name references
- Modify: `apps/api/src/memory/memory-backend.factory.ts` — update class reference

> **Note:** There is no file rename here — renaming the file would require updating all imports across the project. Renaming only the class achieves the clarity goal with minimal churn.

- [ ] **Step 1: Rename the class and add clarifying comment in `dual-read-memory-backend.service.ts`**

Replace the class declaration and add a JSDoc at the top:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IMemorySegment } from '@nexus/core';
import {
  MemoryBackend,
  MemorySegmentFilters,
  MemoryType,
} from './memory-backend.types';
import { HonchoMemoryBackendService } from './honcho-memory-backend.service';
import { PostgresMemoryBackendService } from './postgres-memory-backend.service';

/**
 * Honcho backend with unconditional PostgreSQL fallback.
 *
 * Distinct from {@link HonchoMemoryBackendService} ("honcho" mode):
 * - `honcho` mode: respects the `HONCHO_FALLBACK_ON_ERROR` env var
 * - `honcho-fallback` mode (this class): always falls back to PostgreSQL on
 *   any read error, regardless of `HONCHO_FALLBACK_ON_ERROR`
 *
 * Use this mode when you want Honcho for reads but need a guaranteed
 * safe fallback during a migration or early rollout.
 *
 * Selected via MEMORY_BACKEND=dual in the environment.
 */
@Injectable()
export class HonchoFallbackMemoryBackendService implements MemoryBackend {
  private readonly logger = new Logger(HonchoFallbackMemoryBackendService.name);

  constructor(
    private readonly honcho: HonchoMemoryBackendService,
    private readonly postgres: PostgresMemoryBackendService,
  ) {}

  async createMemorySegment(
    entityType: string,
    entityId: string,
    content: string,
    memoryType: MemoryType = 'fact',
  ): Promise<IMemorySegment> {
    return this.postgres.createMemorySegment(
      entityType,
      entityId,
      content,
      memoryType,
    );
  }

  async getMemorySegments(
    entityType: string,
    entityId: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.honcho.getMemorySegments(entityType, entityId, filters);
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for getMemorySegments(${entityType}:${entityId}): ${(error as Error).message}`,
      );
      return this.postgres.getMemorySegments(entityType, entityId, filters);
    }
  }

  async getMemorySegmentsByType(
    entityType: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.honcho.getMemorySegmentsByType(entityType, filters);
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for getMemorySegmentsByType(${entityType}): ${(error as Error).message}`,
      );
      return this.postgres.getMemorySegmentsByType(entityType, filters);
    }
  }

  async updateMemorySegment(
    id: string,
    content: string,
  ): Promise<IMemorySegment | null> {
    return this.postgres.updateMemorySegment(id, content);
  }

  async deleteMemorySegment(id: string): Promise<void> {
    await this.postgres.deleteMemorySegment(id);
  }

  async searchMemory(
    entityType: string,
    entityId: string,
    query: string,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.honcho.searchMemory(entityType, entityId, query);
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for searchMemory(${entityType}:${entityId}): ${(error as Error).message}`,
      );
      return this.postgres.searchMemory(entityType, entityId, query);
    }
  }

  async searchMemoryByType(
    entityType: string,
    query: string,
    filters?: MemorySegmentFilters,
  ): Promise<IMemorySegment[]> {
    try {
      return await this.honcho.searchMemoryByType(entityType, query, filters);
    } catch (error) {
      this.logger.warn(
        `Honcho-fallback backend falling back to postgres for searchMemoryByType(${entityType}): ${(error as Error).message}`,
      );
      return this.postgres.searchMemoryByType(entityType, query, filters);
    }
  }
}
```

- [ ] **Step 2: Update `memory.module.ts` to use new class name**

In `apps/api/src/memory/memory.module.ts`:
- Change `import { DualReadMemoryBackendService } from './dual-read-memory-backend.service';` to `import { HonchoFallbackMemoryBackendService } from './dual-read-memory-backend.service';`
- In `providers` array: replace `DualReadMemoryBackendService` with `HonchoFallbackMemoryBackendService`
- In the `MEMORY_BACKEND_TOKEN` factory: replace `DualReadMemoryBackendService` with `HonchoFallbackMemoryBackendService` in both `inject` and `useFactory` params

- [ ] **Step 3: Update `memory-backend.factory.ts` to use new class name**

In `apps/api/src/memory/memory-backend.factory.ts`:
- Update the `MemoryBackendRegistry` interface: change `dual: MemoryBackend` — no change needed here (interface is generic)
- No changes needed — the factory uses the `registry.dual` value which is still typed as `MemoryBackend`

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/memory/dual-read-memory-backend.service.ts \
        apps/api/src/memory/memory.module.ts
git commit -m "refactor(memory): rename DualReadMemoryBackendService to HonchoFallbackMemoryBackendService

The previous name did not communicate that this backend's purpose is to
unconditionally fall back to PostgreSQL on any Honcho read error, overriding
the HONCHO_FALLBACK_ON_ERROR env var. Added JSDoc explaining the distinction
from plain honcho mode. File name retained to minimize import churn."
```

---

## Final Verification

- [ ] **Run all memory-related tests**

```bash
npx vitest run apps/api/src/memory/ apps/api/src/users/user-memory apps/api/src/project/project-memory
```
Expected: All tests pass.

- [ ] **Full type-check**

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
```
Expected: No errors.

- [ ] **Push**

```bash
git push
```

---

## What Was Deliberately Not Changed

| Area | Reason |
|---|---|
| Two-tier memory system (generic `MemorySegment` vs `ChatSessionMemory`/`ChatProfileMemory`) | Different schemas, lifecycles, and access patterns. Intentionally separate. |
| Backend strategy pattern (postgres / honcho / dual) | Sound architecture. Each backend has a distinct behavior contract. |
| `LearningMemoryService` using generic `MemoryManagerService` | Writes to `Organization` entity type and represents a distinct domain. No overlap worth collapsing. |
| Chat memory pipeline (lifecycle → context assembler → distillation → jobs) | Well-structured with clear SRP throughout. No refactoring needed. |
| `DistillationConsumer` (BullMQ) inside global `MemoryModule` | Handles session-tree JSONL compression, unrelated to chat memory pipeline. Appropriate location. |
