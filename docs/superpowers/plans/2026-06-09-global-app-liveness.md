# Global App Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale HTTP polling with WebSocket push so the sidebar session-count badge, project orchestration cards, and work-item counts update the instant something changes — and fix the broken `/kanban` work-item gateway (it has no server implementation today).

**Architecture:**
- `apps/api` gets a new `AppEventsGateway` on the `/app-events` Socket.IO namespace. It listens to existing NestJS `EventEmitter2` workflow lifecycle events and broadcasts `run:lifecycle` to all connected clients. The frontend's React Query invalidation scopes data correctly per user via the existing HTTP layer.
- Work-item realtime is bridged via Redis Pub/Sub: the kanban service publishes `wi:{projectId}` channel messages; a new `KanbanGateway` in `apps/api` subscribes when a UI client joins a project room and re-emits `work-item-updated` over Socket.IO. The kanban service has no socket.io dependency and this keeps it that way.
- The frontend mounts a single `GlobalRealtimeProvider` in `Layout.tsx` (a React Context that owns one Socket.IO connection to `/app-events` for the lifetime of the browser session). The existing notification socket is hoisted into this provider to fix the double-connect bug caused by `Sidebar` and `Notifications` both calling `useNotifications`.

**Tech Stack:** NestJS `@WebSocketGateway` (socket.io 4.x), existing `RedisPubSubService` (ioredis), `socket.io-client` (already installed in apps/web), React Context + `useReducer`, React Query `invalidateQueries`, jsonwebtoken (already used in `NotificationGateway`).

---

## Pre-Work: Read These Before Writing Any Code

These files establish patterns that EVERY task in this plan follows. Read them first:

- `apps/api/src/notifications/notification.gateway.ts` — JWT auth pattern for WebSocket gateways (copy this exactly)
- `apps/api/src/redis/redis-pubsub.service.ts` — existing Redis pub/sub service (we extend this)
- `apps/api/src/notifications/notifications.module.ts` — module wiring pattern
- `apps/api/src/workflow/workflow-events.constants.ts` — event name constants (import these, don't hardcode strings)
- `apps/api/src/workflow/workflow-events.types.ts` — `WorkflowRunEvent` interface
- `apps/web/src/hooks/useNotifications.ts` — existing socket hook to be refactored
- `apps/web/src/components/layout/Layout.tsx` — where to mount the provider

---

## File Map

### New files — `apps/api`

| File | Responsibility |
|------|---------------|
| `src/app-events/app-events.gateway.ts` | Socket.IO gateway on `/app-events`; JWT auth; broadcasts `run:lifecycle` |
| `src/app-events/app-events.module.ts` | NestJS module that wires the gateway |
| `src/app-events/app-events.gateway.spec.ts` | Integration tests for the gateway |
| `src/kanban-gateway/kanban.gateway.ts` | Socket.IO gateway on `/kanban`; manages per-project Redis subscriptions |
| `src/kanban-gateway/kanban.gateway.spec.ts` | Integration tests |
| `src/kanban-gateway/kanban-gateway.module.ts` | NestJS module |

### Modified files — `apps/api`

| File | Change |
|------|--------|
| `src/redis/redis-pubsub.service.ts` | Add `publishToChannel(channel, data)` and `subscribeToRawChannel(channel, cb)` / `unsubscribeFromRawChannel` |
| `src/redis/redis-pubsub.service.spec.ts` | Tests for the new methods (create if absent) |
| `src/app.module.ts` | Import `AppEventsModule` and `KanbanGatewayModule` |

### New files — `apps/kanban`

| File | Responsibility |
|------|---------------|
| `src/work-item/work-item-realtime.publisher.ts` | Publishes `wi:{projectId}` to Redis when a work item changes |
| `src/work-item/work-item-realtime.publisher.spec.ts` | Unit tests |

### Modified files — `apps/kanban`

| File | Change |
|------|--------|
| `src/work-item/work-item.service.ts` | Call `WorkItemRealtimePublisher.publish()` after `transitionStatus()` succeeds |
| `src/work-item/work-item.module.ts` (or app.module.ts) | Register `WorkItemRealtimePublisher` |

### New files — `apps/web`

| File | Responsibility |
|------|---------------|
| `src/context/GlobalRealtimeContext.tsx` | React Context + Provider + `useGlobalRealtime` hook; owns the `/app-events` socket |
| `src/hooks/useWorkItemRealtimeSubscription.ts` | Extracted, deduplicated work-item socket hook used by both Kanban and SessionsTab |

### Modified files — `apps/web`

| File | Change |
|------|--------|
| `src/components/layout/Layout.tsx` | Wrap children with `GlobalRealtimeProvider` |
| `src/hooks/useNotifications.ts` | Remove `useNotificationSocket` (hoisted into `GlobalRealtimeContext`); keep only the query hooks |
| `src/pages/kanban/useKanbanBoardData.ts` | Use `useWorkItemRealtimeSubscription` instead of inline socket code |
| `src/pages/project-workspace/SessionsTab.tsx` | Use `useWorkItemRealtimeSubscription` instead of inline socket code |
| `src/components/sessions/SessionConversationPane.tsx` | Pass `budgetDecision` prop (currently missing at call site) |

---

## Phase 1 — Backend: `AppEventsGateway`

### Task 1: Extend `RedisPubSubService` with generic channel methods

The existing `publishEvent` and `subscribeToChannel` hardcode the `telemetry:` prefix, so we can't reuse them for work-item channels. We add generic variants that accept a raw channel string.

**Files:**
- Modify: `apps/api/src/redis/redis-pubsub.service.ts`
- Create/Modify: `apps/api/src/redis/redis-pubsub.service.spec.ts`

- [ ] **Step 1.1: Read `redis-pubsub.service.ts` to understand current structure**

```bash
# Read the file and note the exact class name, constructor args, and channelCallbackMap type
cat apps/api/src/redis/redis-pubsub.service.ts
```

- [ ] **Step 1.2: Write failing tests for the new methods**

Open (or create) `apps/api/src/redis/redis-pubsub.service.spec.ts` and add:

```typescript
import { RedisPubSubService } from './redis-pubsub.service';

// Mock ioredis constructor
jest.mock('ioredis', () => {
  const mRedis = {
    publish: jest.fn().mockResolvedValue(1),
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    duplicate: jest.fn(),
  };
  mRedis.duplicate.mockReturnValue({ ...mRedis });
  return jest.fn(() => mRedis);
});

describe('RedisPubSubService — generic channel methods', () => {
  let service: RedisPubSubService;
  let mockPublisher: { publish: jest.Mock };
  let mockSubscriber: { subscribe: jest.Mock; unsubscribe: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    // Instantiate following the existing constructor signature.
    // Adjust args to match what you see in the real constructor.
    service = new RedisPubSubService(/* pass any required config */);
    // Access the internal publisher/subscriber clients if they are assigned to
    // named properties (check the real file). Otherwise use (service as any).publisher
    mockPublisher = (service as any).publisher;
    mockSubscriber = (service as any).subscriber;
  });

  describe('publishToChannel', () => {
    it('publishes JSON-serialised payload to the given raw channel', async () => {
      const payload = { projectId: 'proj-1', workItemId: 'wi-1', status: 'DONE' };
      await service.publishToChannel('wi:proj-1', payload);
      expect(mockPublisher.publish).toHaveBeenCalledWith(
        'wi:proj-1',
        JSON.stringify(payload),
      );
    });
  });

  describe('subscribeToRawChannel / unsubscribeFromRawChannel', () => {
    it('subscribes a callback and invokes it with parsed payload on message', () => {
      const cb = jest.fn();
      service.subscribeToRawChannel('wi:proj-1', cb);
      expect(mockSubscriber.subscribe).toHaveBeenCalledWith('wi:proj-1');

      // Simulate the subscriber emitting a message
      const messageHandler = mockSubscriber.on.mock.calls.find(
        ([event]) => event === 'message',
      )?.[1];
      expect(messageHandler).toBeDefined();
      messageHandler('wi:proj-1', JSON.stringify({ status: 'DONE' }));
      expect(cb).toHaveBeenCalledWith({ status: 'DONE' });
    });

    it('does not invoke a callback for messages on a different channel', () => {
      const cb = jest.fn();
      service.subscribeToRawChannel('wi:proj-1', cb);
      const messageHandler = mockSubscriber.on.mock.calls.find(
        ([event]) => event === 'message',
      )?.[1];
      messageHandler('wi:proj-2', JSON.stringify({ status: 'DONE' }));
      expect(cb).not.toHaveBeenCalled();
    });

    it('removes the callback on unsubscribe and calls redis UNSUBSCRIBE when no listeners remain', () => {
      const cb = jest.fn();
      service.subscribeToRawChannel('wi:proj-1', cb);
      service.unsubscribeFromRawChannel('wi:proj-1', cb);
      expect(mockSubscriber.unsubscribe).toHaveBeenCalledWith('wi:proj-1');
    });

    it('does NOT call redis UNSUBSCRIBE when other listeners remain on the same channel', () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();
      service.subscribeToRawChannel('wi:proj-1', cb1);
      service.subscribeToRawChannel('wi:proj-1', cb2);
      service.unsubscribeFromRawChannel('wi:proj-1', cb1);
      expect(mockSubscriber.unsubscribe).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 1.3: Run tests to verify they fail**

```bash
cd apps/api && npx jest --testPathPattern=redis-pubsub.service.spec --no-coverage
```

Expected: FAIL — `service.publishToChannel is not a function`, `service.subscribeToRawChannel is not a function`

- [ ] **Step 1.4: Implement the three new methods in `RedisPubSubService`**

Add these methods alongside the existing `publishEvent`/`subscribeToChannel` implementations. Follow the exact same pattern (the `channelCallbackMap` and message-routing logic the existing `subscribeToChannel` uses):

```typescript
async publishToChannel(channel: string, payload: unknown): Promise<void> {
  try {
    await this.publisher.publish(channel, JSON.stringify(payload));
  } catch (err) {
    this.logger.error(`Failed to publish to channel ${channel}`, err);
  }
}

subscribeToRawChannel(channel: string, callback: (payload: unknown) => void): void {
  if (!this.channelCallbackMap.has(channel)) {
    this.channelCallbackMap.set(channel, new Set());
    this.subscriber.subscribe(channel);
  }
  this.channelCallbackMap.get(channel)!.add(callback);
}

unsubscribeFromRawChannel(channel: string, callback: (payload: unknown) => void): void {
  const callbacks = this.channelCallbackMap.get(channel);
  if (!callbacks) return;
  callbacks.delete(callback);
  if (callbacks.size === 0) {
    this.channelCallbackMap.delete(channel);
    this.subscriber.unsubscribe(channel);
  }
}
```

**Important**: Check the existing `subscribeToChannel` implementation to see whether the `'message'` handler is registered once (in the constructor or `onModuleInit`) or per subscription. Add the routing in the existing message handler rather than adding a second `on('message', ...)` call — two message handlers would double-fire every callback.

- [ ] **Step 1.5: Run tests to verify they pass**

```bash
cd apps/api && npx jest --testPathPattern=redis-pubsub.service.spec --no-coverage
```

Expected: PASS (all 5 tests)

- [ ] **Step 1.6: Commit**

```bash
git add apps/api/src/redis/redis-pubsub.service.ts apps/api/src/redis/redis-pubsub.service.spec.ts
git commit -m "feat(api/redis): add generic publishToChannel and subscribeToRawChannel methods"
```

---

### Task 2: Create `AppEventsGateway`

A Socket.IO gateway on the `/app-events` namespace. JWT-authenticated. Listens to `workflow.run.*` NestJS EventEmitter2 events and broadcasts a `run:lifecycle` event to all connected clients. All connected clients invalidate their workflow-run React Query cache on receipt, which causes their sidebar badge to re-fetch with the correct count.

**Files:**
- Create: `apps/api/src/app-events/app-events.gateway.ts`
- Create: `apps/api/src/app-events/app-events.module.ts`
- Create: `apps/api/src/app-events/app-events.gateway.spec.ts`

- [ ] **Step 2.1: Write the failing integration test**

Create `apps/api/src/app-events/app-events.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { AppEventsGateway } from './app-events.gateway';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow/workflow-events.constants';
import { WorkflowRunEvent } from '../workflow/workflow-events.types';

const TEST_JWT_SECRET = 'test-secret';
const makeToken = () =>
  jwt.sign({ userId: 'user-1', sub: 'user-1' }, TEST_JWT_SECRET, { expiresIn: '1h' });

describe('AppEventsGateway (integration)', () => {
  let app: INestApplication;
  let eventEmitter: EventEmitter2;
  let port: number;

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [AppEventsGateway],
    }).compile();

    app = module.createNestApplication();
    await app.listen(0);
    port = app.getHttpServer().address().port;
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(() => app.close());

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(`http://localhost:${port}/app-events`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 3000);
    });
  }

  it('rejects connections without a valid JWT', (done) => {
    const s = io(`http://localhost:${port}/app-events`, {
      auth: { token: 'invalid' },
      transports: ['websocket'],
    });
    s.on('disconnect', () => { s.close(); done(); });
    s.on('connect_error', () => { s.close(); done(); });
  });

  it('accepts connections with a valid JWT', async () => {
    const client = await connect(makeToken());
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('broadcasts run:lifecycle to all clients when workflow.run.started fires', async () => {
    const client = await connect(makeToken());

    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      const event: WorkflowRunEvent = {
        workflowRunId: 'run-abc',
        workflowId: 'wf-1',
        status: 'RUNNING' as any,
        stateVariables: {},
      };
      eventEmitter.emit(WORKFLOW_RUN_STARTED_EVENT, event);
    });

    expect(received).toMatchObject({ workflowRunId: 'run-abc', status: 'RUNNING' });
    client.disconnect();
  });

  it('broadcasts run:lifecycle when workflow.run.completed fires', async () => {
    const client = await connect(makeToken());

    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      const event: WorkflowRunEvent = {
        workflowRunId: 'run-xyz',
        workflowId: 'wf-2',
        status: 'COMPLETED' as any,
        stateVariables: {},
      };
      eventEmitter.emit(WORKFLOW_RUN_COMPLETED_EVENT, event);
    });

    expect(received).toMatchObject({ workflowRunId: 'run-xyz', status: 'COMPLETED' });
    client.disconnect();
  });

  it('broadcasts run:lifecycle when workflow.run.failed fires', async () => {
    const client = await connect(makeToken());
    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      eventEmitter.emit(WORKFLOW_RUN_FAILED_EVENT, {
        workflowRunId: 'run-fail',
        workflowId: 'wf-3',
        status: 'FAILED',
        stateVariables: {},
      });
    });
    expect(received).toMatchObject({ status: 'FAILED' });
    client.disconnect();
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
cd apps/api && npx jest --testPathPattern=app-events.gateway.spec --no-coverage
```

Expected: FAIL — `Cannot find module './app-events.gateway'`

- [ ] **Step 2.3: Implement `AppEventsGateway`**

Create `apps/api/src/app-events/app-events.gateway.ts`:

```typescript
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import {
  WORKFLOW_RUN_CANCELLED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
  WORKFLOW_RUN_PAUSED_EVENT,
  WORKFLOW_RUN_RESUMED_EVENT,
  WORKFLOW_RUN_STARTED_EVENT,
} from '../workflow/workflow-events.constants';
import { WorkflowRunEvent } from '../workflow/workflow-events.types';

const TELEMETRY_GATEWAY_PORT = parseInt(process.env.WEBSOCKET_GATEWAY_PORT ?? '3001', 10);

@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  namespace: '/app-events',
  cors: { origin: true, credentials: true },
})
export class AppEventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server: Server;
  private readonly logger = new Logger(AppEventsGateway.name);

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth as Record<string, string>).token ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn(`AppEventsGateway: connection rejected — no token`);
      client.disconnect(true);
      return;
    }

    try {
      jwt.verify(token, process.env.JWT_SECRET!);
      this.logger.debug(`AppEventsGateway: client connected ${client.id}`);
    } catch {
      this.logger.warn(`AppEventsGateway: connection rejected — invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`AppEventsGateway: client disconnected ${client.id}`);
  }

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  @OnEvent(WORKFLOW_RUN_COMPLETED_EVENT)
  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  @OnEvent(WORKFLOW_RUN_CANCELLED_EVENT)
  @OnEvent(WORKFLOW_RUN_PAUSED_EVENT)
  @OnEvent(WORKFLOW_RUN_RESUMED_EVENT)
  broadcastRunLifecycle(event: WorkflowRunEvent): void {
    this.server.emit('run:lifecycle', {
      workflowRunId: event.workflowRunId,
      workflowId: event.workflowId,
      status: event.status,
    });
  }
}
```

- [ ] **Step 2.4: Create `AppEventsModule`**

Create `apps/api/src/app-events/app-events.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { AppEventsGateway } from './app-events.gateway';

@Module({
  providers: [AppEventsGateway],
})
export class AppEventsModule {}
```

- [ ] **Step 2.5: Run tests to confirm they pass**

```bash
cd apps/api && npx jest --testPathPattern=app-events.gateway.spec --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 2.6: Register `AppEventsModule` in `app.module.ts`**

Open `apps/api/src/app.module.ts`. In the `@Module` `imports` array, add `AppEventsModule` alongside the other feature modules:

```typescript
import { AppEventsModule } from './app-events/app-events.module';

// In the @Module imports array:
AppEventsModule,
```

- [ ] **Step 2.7: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 2.8: Commit**

```bash
git add apps/api/src/app-events/ apps/api/src/app.module.ts
git commit -m "feat(api): add AppEventsGateway broadcasting run:lifecycle to /app-events namespace"
```

---

## Phase 2 — Backend: `KanbanGateway` + Work-Item Redis Publishing

### Task 3: Add `WorkItemRealtimePublisher` to `apps/kanban`

When a work item status changes, the kanban service must publish a message to Redis so the `KanbanGateway` in `apps/api` can broadcast it to connected UI clients.

**Files:**
- Create: `apps/kanban/src/work-item/work-item-realtime.publisher.ts`
- Create: `apps/kanban/src/work-item/work-item-realtime.publisher.spec.ts`
- Modify: `apps/kanban/src/work-item/work-item.service.ts`
- Modify: kanban's work-item module to register the publisher (find the right module file)

- [ ] **Step 3.1: Investigate how the kanban app connects to Redis**

```bash
# Check what Redis-related packages/services are available in kanban
cat apps/kanban/package.json | grep -i redis
# Check the kanban app module for any Redis imports
cat apps/kanban/src/app.module.ts
# Check the core/ directory for shared services
ls apps/kanban/src/core/
```

The kanban app likely connects to Redis through `ioredis` or a shared package. The simplest approach: inject `ioredis` directly (same Redis instance used by apps/api). If `ioredis` is not already in `apps/kanban/package.json`, add it:

```bash
cd apps/kanban && npm install ioredis
```

- [ ] **Step 3.2: Write the failing unit test**

Create `apps/kanban/src/work-item/work-item-realtime.publisher.spec.ts`:

```typescript
import { WorkItemRealtimePublisher } from './work-item-realtime.publisher';

const mockRedis = { publish: jest.fn().mockResolvedValue(1) };

describe('WorkItemRealtimePublisher', () => {
  let publisher: WorkItemRealtimePublisher;

  beforeEach(() => {
    mockRedis.publish.mockClear();
    publisher = new WorkItemRealtimePublisher(mockRedis as any);
  });

  it('publishes a JSON payload to channel wi:{projectId}', async () => {
    const workItem = { id: 'wi-1', status: 'DONE', projectId: 'proj-1' } as any;
    await publisher.publish('proj-1', workItem);
    expect(mockRedis.publish).toHaveBeenCalledWith(
      'wi:proj-1',
      expect.stringContaining('"id":"wi-1"'),
    );
    const parsed = JSON.parse(mockRedis.publish.mock.calls[0][1]);
    expect(parsed).toMatchObject({ projectId: 'proj-1', workItem: { id: 'wi-1' } });
  });

  it('silently swallows publish errors (best-effort)', async () => {
    mockRedis.publish.mockRejectedValueOnce(new Error('Redis down'));
    await expect(publisher.publish('proj-1', {} as any)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 3.3: Run test to confirm it fails**

```bash
cd apps/kanban && npx jest --testPathPattern=work-item-realtime.publisher.spec --no-coverage
```

Expected: FAIL — `Cannot find module './work-item-realtime.publisher'`

- [ ] **Step 3.4: Implement `WorkItemRealtimePublisher`**

Create `apps/kanban/src/work-item/work-item-realtime.publisher.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export interface WorkItemRealtimePayload {
  projectId: string;
  workItem: Record<string, unknown>;
}

@Injectable()
export class WorkItemRealtimePublisher {
  private readonly logger = new Logger(WorkItemRealtimePublisher.name);

  constructor(private readonly redis: Redis) {}

  async publish(projectId: string, workItem: Record<string, unknown>): Promise<void> {
    const channel = `wi:${projectId}`;
    const payload: WorkItemRealtimePayload = { projectId, workItem };
    try {
      await this.redis.publish(channel, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(`WorkItemRealtimePublisher: failed to publish to ${channel}`, err);
    }
  }
}
```

- [ ] **Step 3.5: Run tests to confirm they pass**

```bash
cd apps/kanban && npx jest --testPathPattern=work-item-realtime.publisher.spec --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 3.6: Register `WorkItemRealtimePublisher` and wire it into `work-item.service.ts`**

Find the work-item NestJS module in `apps/kanban/src/work-item/`. Add `WorkItemRealtimePublisher` as a provider and inject `ioredis` using the same pattern the kanban app uses for other Redis connections (check what token/injection key is used for Redis in the kanban app module — look for `REDIS_CLIENT` or direct `Redis` injection).

In the work-item module (e.g., `work-item.module.ts`):

```typescript
import { Module } from '@nestjs/common';
import { WorkItemRealtimePublisher } from './work-item-realtime.publisher';
// ... existing imports

@Module({
  providers: [
    // ... existing providers
    WorkItemRealtimePublisher,
    // Provide the ioredis instance — match how other Redis clients are provided in the kanban app:
    {
      provide: WorkItemRealtimePublisher,
      useFactory: (redis: Redis) => new WorkItemRealtimePublisher(redis),
      inject: ['REDIS_CLIENT'], // ← adjust this token to match how kanban provides Redis
    },
  ],
  exports: [WorkItemRealtimePublisher],
})
export class WorkItemModule {}
```

**Note:** Check `apps/kanban/src/app.module.ts` and `apps/kanban/src/core/` to find the exact injection token for the Redis client. Adjust accordingly.

- [ ] **Step 3.7: Call `publisher.publish()` in `work-item.service.ts` after successful status transition**

Open `apps/kanban/src/work-item/work-item.service.ts`. Find the `updateStatus()` method. After the line where `transitionStatus()` succeeds and the updated `WorkItemRecord` is returned (around line 190–200 based on earlier investigation), add:

```typescript
// After status update succeeds and updatedRecord is available:
this.realtimePublisher.publish(projectId, updatedRecord as unknown as Record<string, unknown>)
  .catch((err) => this.logger.error('Failed to publish work item realtime update', err));
```

Inject `WorkItemRealtimePublisher` in the service constructor:

```typescript
constructor(
  // ... existing injections
  private readonly realtimePublisher: WorkItemRealtimePublisher,
) {}
```

- [ ] **Step 3.8: Type-check kanban**

```bash
cd apps/kanban && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3.9: Commit**

```bash
git add apps/kanban/src/work-item/
git commit -m "feat(kanban): publish work-item updates to Redis wi:{projectId} channel"
```

---

### Task 4: Create `KanbanGateway` in `apps/api`

This gateway listens on the `/kanban` Socket.IO namespace (matching what the frontend already expects). When a client emits `join-project`, the gateway subscribes to `wi:{projectId}` on Redis. When a message arrives, it broadcasts `work-item-updated` to all clients in the project room.

**Files:**
- Create: `apps/api/src/kanban-gateway/kanban.gateway.ts`
- Create: `apps/api/src/kanban-gateway/kanban.gateway.spec.ts`
- Create: `apps/api/src/kanban-gateway/kanban-gateway.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 4.1: Write the failing integration test**

Create `apps/api/src/kanban-gateway/kanban.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { KanbanGateway } from './kanban.gateway';
import { RedisPubSubService } from '../redis/redis-pubsub.service';

const TEST_JWT_SECRET = 'test-secret';
const makeToken = () =>
  jwt.sign({ userId: 'user-1', sub: 'user-1' }, TEST_JWT_SECRET, { expiresIn: '1h' });

// RedisPubSubService mock that captures subscribeToRawChannel callbacks so we can fire them
const subscribedCallbacks = new Map<string, Set<(p: unknown) => void>>();
const mockPubSub = {
  subscribeToRawChannel: jest.fn((channel: string, cb: (p: unknown) => void) => {
    if (!subscribedCallbacks.has(channel)) subscribedCallbacks.set(channel, new Set());
    subscribedCallbacks.get(channel)!.add(cb);
  }),
  unsubscribeFromRawChannel: jest.fn((channel: string, cb: (p: unknown) => void) => {
    subscribedCallbacks.get(channel)?.delete(cb);
  }),
};

function fireRedisMessage(channel: string, payload: unknown) {
  subscribedCallbacks.get(channel)?.forEach((cb) => cb(payload));
}

describe('KanbanGateway (integration)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    subscribedCallbacks.clear();

    const module = await Test.createTestingModule({
      providers: [
        KanbanGateway,
        { provide: RedisPubSubService, useValue: mockPubSub },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.listen(0);
    port = app.getHttpServer().address().port;
  });

  afterAll(() => app.close());

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(`http://localhost:${port}/kanban`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
      });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 3000);
    });
  }

  it('rejects connections without a valid JWT', (done) => {
    const s = io(`http://localhost:${port}/kanban`, {
      auth: { token: 'bad' },
      transports: ['websocket'],
    });
    s.on('disconnect', () => { s.close(); done(); });
    s.on('connect_error', () => { s.close(); done(); });
  });

  it('subscribes to wi:{projectId} on Redis when client emits join-project', async () => {
    const client = await connect(makeToken());
    client.emit('join-project', { projectId: 'proj-1' });
    // Wait for the server to process the join-project message
    await new Promise((r) => setTimeout(r, 100));
    expect(mockPubSub.subscribeToRawChannel).toHaveBeenCalledWith(
      'wi:proj-1',
      expect.any(Function),
    );
    client.disconnect();
  });

  it('emits work-item-updated to the client when Redis fires a message', async () => {
    const client = await connect(makeToken());
    client.emit('join-project', { projectId: 'proj-2' });
    await new Promise((r) => setTimeout(r, 100));

    const received = await new Promise<unknown>((resolve) => {
      client.on('work-item-updated', resolve);
      fireRedisMessage('wi:proj-2', {
        projectId: 'proj-2',
        workItem: { id: 'wi-42', status: 'DONE' },
      });
    });

    expect(received).toMatchObject({ projectId: 'proj-2', workItem: { id: 'wi-42' } });
    client.disconnect();
  });

  it('unsubscribes from Redis when a client disconnects', async () => {
    const client = await connect(makeToken());
    await new Promise<void>((resolve) => {
      client.emit('join-project', { projectId: 'proj-3' }, resolve);
    });
    client.disconnect();
    // Give NestJS a moment to process the disconnect
    await new Promise((r) => setTimeout(r, 100));
    expect(mockPubSub.unsubscribeFromRawChannel).toHaveBeenCalledWith(
      'wi:proj-3',
      expect.any(Function),
    );
  });
});
```

- [ ] **Step 4.2: Run test to confirm it fails**

```bash
cd apps/api && npx jest --testPathPattern=kanban.gateway.spec --no-coverage
```

Expected: FAIL — `Cannot find module './kanban.gateway'`

- [ ] **Step 4.3: Implement `KanbanGateway`**

Create `apps/api/src/kanban-gateway/kanban.gateway.ts`:

```typescript
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { RedisPubSubService } from '../redis/redis-pubsub.service';

const TELEMETRY_GATEWAY_PORT = parseInt(process.env.WEBSOCKET_GATEWAY_PORT ?? '3001', 10);

interface JoinProjectPayload {
  projectId: string;
}

@WebSocketGateway(TELEMETRY_GATEWAY_PORT, {
  namespace: '/kanban',
  cors: { origin: true, credentials: true },
})
export class KanbanGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private readonly server: Server;
  private readonly logger = new Logger(KanbanGateway.name);

  // Track per-client subscriptions so we can clean up on disconnect
  private readonly clientSubscriptions = new Map<
    string,
    { channel: string; callback: (payload: unknown) => void }[]
  >();

  constructor(private readonly redisPubSub: RedisPubSubService) {}

  handleConnection(client: Socket): void {
    const token =
      (client.handshake.auth as Record<string, string>).token ??
      client.handshake.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      client.disconnect(true);
      return;
    }

    try {
      jwt.verify(token, process.env.JWT_SECRET!);
      this.clientSubscriptions.set(client.id, []);
    } catch {
      this.logger.warn(`KanbanGateway: rejected client ${client.id} — invalid token`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const subs = this.clientSubscriptions.get(client.id) ?? [];
    for (const { channel, callback } of subs) {
      this.redisPubSub.unsubscribeFromRawChannel(channel, callback);
    }
    this.clientSubscriptions.delete(client.id);
    this.logger.debug(`KanbanGateway: client ${client.id} disconnected, cleaned up ${subs.length} subscriptions`);
  }

  @SubscribeMessage('join-project')
  handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinProjectPayload,
  ): void {
    const { projectId } = payload;
    if (!projectId) return;

    const room = `project-${projectId}`;
    client.join(room);

    const channel = `wi:${projectId}`;
    const callback = (data: unknown) => {
      this.server.to(room).emit('work-item-updated', data);
    };

    this.redisPubSub.subscribeToRawChannel(channel, callback);

    const subs = this.clientSubscriptions.get(client.id) ?? [];
    subs.push({ channel, callback });
    this.clientSubscriptions.set(client.id, subs);

    this.logger.debug(`KanbanGateway: client ${client.id} joined project ${projectId}`);
  }
}
```

- [ ] **Step 4.4: Create `KanbanGatewayModule`**

Create `apps/api/src/kanban-gateway/kanban-gateway.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { KanbanGateway } from './kanban.gateway';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [RedisModule],
  providers: [KanbanGateway],
})
export class KanbanGatewayModule {}
```

- [ ] **Step 4.5: Run tests to confirm they pass**

```bash
cd apps/api && npx jest --testPathPattern=kanban.gateway.spec --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 4.6: Register `KanbanGatewayModule` in `app.module.ts`**

```typescript
import { KanbanGatewayModule } from './kanban-gateway/kanban-gateway.module';

// In the @Module imports array:
KanbanGatewayModule,
```

- [ ] **Step 4.7: Type-check**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 4.8: Commit**

```bash
git add apps/api/src/kanban-gateway/ apps/api/src/app.module.ts
git commit -m "feat(api): add KanbanGateway on /kanban namespace bridging Redis wi:{projectId} to socket clients"
```

---

## Phase 3 — Frontend: `GlobalRealtimeProvider` + Fixes

### Task 5: Create `GlobalRealtimeContext`

A React Context that owns a single persistent socket.io connection to `/app-events` and to the `/notifications` namespace. Components do not call `io()` directly — they use `useGlobalRealtime()`. This fixes the double-notification-socket bug and gives every component a stable connection handle.

**Files:**
- Create: `apps/web/src/context/GlobalRealtimeContext.tsx`

- [ ] **Step 5.1: Read the current `useNotifications.ts` to understand what the notification socket hook currently does**

```bash
cat apps/web/src/hooks/useNotifications.ts
```

Note the full `useNotificationSocket` implementation — you will inline this into `GlobalRealtimeContext`.

- [ ] **Step 5.2: Read the API client to find how it fetches the notification WS config**

```bash
cat apps/web/src/lib/api/client.notifications.ts
```

Note the method name (e.g., `getNotificationsWebsocketConfig`) and the shape of what it returns (`{ wsUrl, namespace }`).

- [ ] **Step 5.3: Read how the app-events WS URL should be constructed**

The `/app-events` gateway lives on the same WebSocket server as `/notifications`. Derive the URL the same way the notification hook does (using `wsUrl` from the notification config endpoint, since both namespaces share the same port/host).

- [ ] **Step 5.4: Implement `GlobalRealtimeContext.tsx`**

Create `apps/web/src/context/GlobalRealtimeContext.tsx`:

```typescript
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { io, Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api/client';

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunLifecycleEvent {
  workflowRunId: string;
  workflowId: string;
  status: string;
}

interface GlobalRealtimeContextValue {
  isConnected: boolean;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const GlobalRealtimeContext = createContext<GlobalRealtimeContextValue>({
  isConnected: false,
});

// ─── Provider ────────────────────────────────────────────────────────────────

export function GlobalRealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = React.useState(false);

  // Fetch the WS config once (staleTime: Infinity — the server URL never changes)
  const { data: wsConfig } = useQuery({
    queryKey: ['notifications-websocket-config'],
    queryFn: () => apiClient.getNotificationsWebsocketConfig(),
    staleTime: Infinity,
  });

  const appEventsSocketRef = useRef<Socket | null>(null);
  const notifSocketRef = useRef<Socket | null>(null);

  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('nexus_token') ?? ''
      : '';

  // ── /app-events socket ────────────────────────────────────────────────────
  useEffect(() => {
    if (!wsConfig?.wsUrl || !token) return;

    const socket = io(`${wsConfig.wsUrl}/app-events`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10_000,
    });

    appEventsSocketRef.current = socket;

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    socket.on('run:lifecycle', (_event: RunLifecycleEvent) => {
      // Invalidate all workflow-run list queries so the sidebar badge re-counts
      queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
    });

    return () => {
      socket.disconnect();
      appEventsSocketRef.current = null;
    };
  }, [wsConfig?.wsUrl, token, queryClient]);

  // ── /notifications socket (hoisted here to prevent double-connect) ────────
  useEffect(() => {
    if (!wsConfig?.wsUrl || !wsConfig?.namespace || !token) return;

    const socket = io(`${wsConfig.wsUrl}${wsConfig.namespace}`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      timeout: 10_000,
    });

    notifSocketRef.current = socket;

    socket.on('notification:new', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-inbox'] });
    });

    socket.on('notification:read', ({ notificationId }: { notificationId: string }) => {
      // NOTE: Copy the exact setQueryData call from the existing useNotificationSocket
      // in apps/web/src/hooks/useNotifications.ts — the cache shape below is illustrative.
      // Match the actual shape returned by getNotificationsInbox() exactly.
      queryClient.setQueryData<{ notifications: Array<{ id: string; readAt: string | null }> }>(
        ['notifications-inbox'],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            notifications: old.notifications.map((n) =>
              n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n,
            ),
          };
        },
      );
    });

    return () => {
      socket.disconnect();
      notifSocketRef.current = null;
    };
  }, [wsConfig?.wsUrl, wsConfig?.namespace, token, queryClient]);

  return (
    <GlobalRealtimeContext.Provider value={{ isConnected }}>
      {children}
    </GlobalRealtimeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGlobalRealtime(): GlobalRealtimeContextValue {
  return useContext(GlobalRealtimeContext);
}
```

**Note on the `apiClient.getNotificationsWebsocketConfig()` call**: confirm the exact method name by checking `apps/web/src/lib/api/client.notifications.ts`. The returned shape should be `{ wsUrl: string; namespace: string }`. Adjust the query function accordingly.

- [ ] **Step 5.5: Commit**

```bash
git add apps/web/src/context/GlobalRealtimeContext.tsx
git commit -m "feat(web): add GlobalRealtimeContext owning /app-events and /notifications sockets"
```

---

### Task 6: Mount `GlobalRealtimeProvider` in `Layout.tsx` and remove notification socket from `useNotifications`

**Files:**
- Modify: `apps/web/src/components/layout/Layout.tsx`
- Modify: `apps/web/src/hooks/useNotifications.ts`

- [ ] **Step 6.1: Read `Layout.tsx` to find the exact JSX return**

```bash
cat apps/web/src/components/layout/Layout.tsx
```

Note the outermost JSX element name — you'll wrap its children with `GlobalRealtimeProvider`.

- [ ] **Step 6.2: Wrap layout children with `GlobalRealtimeProvider`**

In `Layout.tsx`, import `GlobalRealtimeProvider` and wrap the layout children:

```typescript
import { GlobalRealtimeProvider } from '../../context/GlobalRealtimeContext';

// In the return JSX — wrap the innermost content, inside the QueryClientProvider (which should already be an ancestor):
return (
  <GlobalRealtimeProvider>
    {/* existing layout JSX */}
  </GlobalRealtimeProvider>
);
```

If `QueryClientProvider` is inside `Layout`, ensure `GlobalRealtimeProvider` is a child of it (it uses `useQueryClient`).

- [ ] **Step 6.3: Remove `useNotificationSocket` from `useNotifications.ts`**

Open `apps/web/src/hooks/useNotifications.ts`. The `useNotificationSocket` function creates its own socket.io connection. Now that `GlobalRealtimeProvider` owns the notification socket, **delete `useNotificationSocket` entirely and remove its call** from the `useNotifications` hook.

The hook should retain only the React Query queries:
- `useQuery` for unread count (`['notifications-unread-count']`, polling at 30s as fallback)
- `useQuery` for the inbox list (`['notifications-inbox']`)
- `useQuery` for the WS config (`['notifications-websocket-config']`, staleTime Infinity) — keep this so the config cache is warm before `GlobalRealtimeProvider` mounts
- Mutation hooks for marking read

Remove:
- The `io()` import from `socket.io-client` (if it becomes unused)
- The `useNotificationSocket` function definition
- The call to `useNotificationSocket(...)` inside `useNotifications`

- [ ] **Step 6.4: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/components/layout/Layout.tsx apps/web/src/hooks/useNotifications.ts
git commit -m "fix(web): hoist notification socket into GlobalRealtimeProvider, eliminate double-connect"
```

---

### Task 7: Fix the stale sidebar run-count badge

**Context:** `Sidebar.tsx` calls `useWorkflowRuns()` with no arguments, which resolves `refetchInterval: false`. The badge value never changes after initial mount. The fix: `GlobalRealtimeProvider` already invalidates `['workflow-runs']` on every `run:lifecycle` event. We just need to make sure the sidebar's query key matches what gets invalidated.

**Files:**
- Modify: `apps/web/src/components/layout/Sidebar.tsx` (or wherever `useWorkflowRuns()` is called for the badge)

- [ ] **Step 7.1: Read the sidebar to confirm the exact call site**

```bash
cat apps/web/src/components/layout/Sidebar.tsx
```

Find the `useWorkflowRuns()` call and the query key it produces. Also check `apps/web/src/hooks/useWorkflows.ts` to understand what query key `useWorkflowRuns({})` generates vs. `useWorkflowRuns()` (no args).

- [ ] **Step 7.2: Verify the invalidation in `GlobalRealtimeContext` hits the sidebar's cache key**

In `GlobalRealtimeContext.tsx` (Task 5), the invalidation is:
```typescript
queryClient.invalidateQueries({ queryKey: ['workflow-runs'] });
```

React Query's `invalidateQueries` with a partial key will invalidate ALL entries whose key starts with `['workflow-runs']` — so `["workflow-runs", {}]`, `["workflow-runs", { status: "RUNNING" }]`, etc. are all covered. Confirm this is correct by checking `queryKeys.ts` for the workflow-run key shape.

- [ ] **Step 7.3: Add a short refetch interval as fallback in the sidebar query**

Even with WebSocket push, add a 60-second fallback poll so the badge recovers if the socket drops. In `Sidebar.tsx`, change:

```typescript
// Before:
const { data } = useWorkflowRuns();

// After:
const { data } = useWorkflowRuns({ refetchInterval: 60_000 });
```

Check `useWorkflows.ts` to confirm `refetchInterval` is a supported option in the hook's param type. If the hook does not expose this option, add it — it should pass through to React Query's `useQuery` options.

- [ ] **Step 7.4: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 7.5: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx
git commit -m "fix(web): sidebar run-count badge now updates on run:lifecycle events + 60s fallback poll"
```

---

### Task 8: Extract `useWorkItemRealtimeSubscription` — deduplicate and fix behavioral divergence

**Context:** `useKanbanBoardData.ts` and `SessionsTab.tsx` both contain near-identical Socket.IO subscription logic for work items. They diverge on one critical behaviour: the Kanban version upserts new items (appends if not found); the SessionsTab version only updates existing items. Extract a single shared hook with the correct behaviour (always upsert).

**Files:**
- Create: `apps/web/src/hooks/useWorkItemRealtimeSubscription.ts`
- Modify: `apps/web/src/pages/kanban/useKanbanBoardData.ts`
- Modify: `apps/web/src/pages/project-workspace/SessionsTab.tsx`

- [ ] **Step 8.1: Read both implementations in full**

```bash
cat apps/web/src/pages/kanban/useKanbanBoardData.ts
cat apps/web/src/pages/project-workspace/SessionsTab.tsx
```

Note:
- The exact query key used (is it a string literal or from `queryKeys`?)
- The exact upsert logic in both files
- The `getWorkItemRealtimeConfig` API call and what it returns
- The `join-project` emit payload

- [ ] **Step 8.2: Create the shared hook**

Create `apps/web/src/hooks/useWorkItemRealtimeSubscription.ts`:

```typescript
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { apiClient } from '../lib/api/client';

// Shape returned by GET /projects/:id/work-items/realtime-config
interface WorkItemRealtimeConfig {
  wsUrl: string;
  namespace: string;
}

// Shape of the work-item-updated payload from the server
interface WorkItemUpdatedPayload {
  projectId: string;
  workItem: Record<string, unknown> & { id: string };
  triggeredRunIds?: string[];
}

const WORK_ITEM_REALTIME_CONFIG_KEY = (projectId: string) => [
  'work-item-realtime-config',
  projectId,
];

// Note: confirm this query key matches the one used in useKanbanBoardData and SessionsTab
// If they use a queryKeys factory, import and use it here instead
const PROJECT_WORK_ITEMS_KEY = (projectId: string) => ['project-work-items', projectId];

export function useWorkItemRealtimeSubscription(projectId: string | undefined): void {
  const queryClient = useQueryClient();

  const { data: realtimeConfig } = useQuery<WorkItemRealtimeConfig>({
    queryKey: WORK_ITEM_REALTIME_CONFIG_KEY(projectId ?? ''),
    queryFn: () => apiClient.getWorkItemRealtimeConfig(projectId!),
    enabled: !!projectId,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!projectId || !realtimeConfig?.wsUrl || !realtimeConfig?.namespace) return;

    const token = localStorage.getItem('nexus_token') ?? '';

    const socket = io(`${realtimeConfig.wsUrl}${realtimeConfig.namespace}`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
    });

    socket.on('connect', () => {
      socket.emit('join-project', { projectId });
    });

    socket.on('work-item-updated', (payload: WorkItemUpdatedPayload) => {
      if (payload.projectId !== projectId) return;

      queryClient.setQueryData<{ items: WorkItemUpdatedPayload['workItem'][] }>(
        PROJECT_WORK_ITEMS_KEY(projectId),
        (old) => {
          if (!old) return old;
          const existing = old.items.find((i) => i.id === payload.workItem.id);
          if (existing) {
            // Update in-place
            return {
              ...old,
              items: old.items.map((i) =>
                i.id === payload.workItem.id ? { ...i, ...payload.workItem } : i,
              ),
            };
          }
          // Append new item (canonical upsert behaviour — this is the correct version)
          return { ...old, items: [...old.items, payload.workItem] };
        },
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId, realtimeConfig?.wsUrl, realtimeConfig?.namespace, queryClient]);
}
```

**Important**: The exact shape of the React Query cache for work items may not be `{ items: [...] }`. Check `useKanbanBoardData.ts` to see how `setQueryData` accesses the array and match that shape exactly (it might be a flat array, or have a different top-level key).

- [ ] **Step 8.3: Replace the inline socket code in `useKanbanBoardData.ts`**

Open `apps/web/src/pages/kanban/useKanbanBoardData.ts`. Find `useWorkItemRealtimeSubscription` (the private one) and delete it. Replace its call site with:

```typescript
import { useWorkItemRealtimeSubscription } from '../../hooks/useWorkItemRealtimeSubscription';

// Inside useKanbanBoardActions (or wherever the subscription was called):
useWorkItemRealtimeSubscription(projectId);
```

Remove all socket.io imports from this file if they are now unused.

- [ ] **Step 8.4: Replace the inline socket code in `SessionsTab.tsx`**

Open `apps/web/src/pages/project-workspace/SessionsTab.tsx`. Find the local `useWorkItemRealtime` function and delete it. Replace its call site with:

```typescript
import { useWorkItemRealtimeSubscription } from '../../hooks/useWorkItemRealtimeSubscription';

// Inside the component:
useWorkItemRealtimeSubscription(projectId);
```

Remove all socket.io imports from this file if now unused.

- [ ] **Step 8.5: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8.6: Commit**

```bash
git add apps/web/src/hooks/useWorkItemRealtimeSubscription.ts \
        apps/web/src/pages/kanban/useKanbanBoardData.ts \
        apps/web/src/pages/project-workspace/SessionsTab.tsx
git commit -m "refactor(web): extract shared useWorkItemRealtimeSubscription hook, fix upsert divergence"
```

---

### Task 9: Wire the missing budget status banner

**Context:** `BudgetStatusBanner` accepts a `budgetDecision` prop and renders only when `decision !== 'allow'`. In `SessionConversationPane.tsx`, the prop exists in the component interface but is never passed at the call site of `SessionConversationPaneAlerts`. This is a wiring bug — the data is already available in the parent's props/state.

**Files:**
- Modify: `apps/web/src/components/sessions/SessionConversationPane.tsx`

- [ ] **Step 9.1: Read `SessionConversationPane.tsx` and find the broken call site**

```bash
cat apps/web/src/components/sessions/SessionConversationPane.tsx
```

Look for the `SessionConversationPaneAlerts` call. Note what props it accepts and what props are available in `SessionConversationPane`'s own props. The `budgetDecision` type is likely `BudgetDecision` or similar — check the import.

- [ ] **Step 9.2: Trace where `budgetDecision` data comes from**

The session pane receives data via its own props or from hooks like `useChatSessionState`. Check:
- What `SessionConversationPane` receives as props
- What `useChatSessionState` returns (its type)
- Whether `budgetDecision` is already in scope just not threaded down

If the data isn't in scope, check `ActiveSessionWorkspace.tsx` or `SessionConversationPane.data.ts` to see where `budgetDecision` is computed and why it doesn't reach the alerts component.

- [ ] **Step 9.3: Pass `budgetDecision` to `SessionConversationPaneAlerts`**

Once you've confirmed the data source, thread the prop through. The change is typically one line:

```typescript
// Before (missing prop):
<SessionConversationPaneAlerts
  someOtherProp={someOtherProp}
/>

// After:
<SessionConversationPaneAlerts
  someOtherProp={someOtherProp}
  budgetDecision={budgetDecision}  // ← add this
/>
```

If `budgetDecision` isn't available in the component's scope, add it to `SessionConversationPane`'s own props interface and thread it from the parent call site.

- [ ] **Step 9.4: Type-check**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 9.5: Commit**

```bash
git add apps/web/src/components/sessions/SessionConversationPane.tsx
git commit -m "fix(web): wire missing budgetDecision prop to SessionConversationPaneAlerts"
```

---

## Phase 4 — Verification

### Task 10: End-to-end smoke test

- [ ] **Step 10.1: Start the full stack**

```bash
# From the repo root — adjust to the actual dev start command:
npm run dev
# or:
docker compose up
```

- [ ] **Step 10.2: Verify `/app-events` socket connects**

Open browser dev tools → Network → WS. Filter by `app-events`. Confirm:
- A WebSocket connection to `/app-events` is established on page load
- It stays connected when navigating between pages (it does not reconnect on route change — it's in `Layout`)

- [ ] **Step 10.3: Verify sidebar badge updates in real time**

1. Open the app with the sessions/sidebar visible
2. Start a new workflow run (or trigger one via the API)
3. Confirm the sidebar run-count badge increments **without a page refresh** within ~2 seconds
4. When the run completes, confirm the badge decrements

- [ ] **Step 10.4: Verify notifications no longer double-connect**

In dev tools WS view, confirm only ONE WebSocket connection to `/notifications` exists — even when the `/notifications` page is open alongside the sidebar.

- [ ] **Step 10.5: Verify work-item updates propagate**

1. Open the Kanban board for a project
2. Move a work item to a different status via the UI
3. Open a second browser tab to the same project's Kanban board
4. Confirm the second tab receives the update within ~1 second **without a page refresh**

- [ ] **Step 10.6: Verify budget status banner appears**

1. Navigate to an active session where a budget limit has been reached (or mock the condition)
2. Confirm the `BudgetStatusBanner` renders inside the session conversation pane

- [ ] **Step 10.7: Run the full test suite**

```bash
# From repo root:
npx turbo run test
# or for individual apps:
cd apps/api && npx jest --no-coverage
cd apps/kanban && npx jest --no-coverage
cd apps/web && npx vitest run  # adjust if jest is used
```

Expected: all tests pass

- [ ] **Step 10.8: Final commit and push**

```bash
git push
```

---

## Known Limitations & Follow-On Work

These are intentionally OUT of scope for this plan but should be tracked:

1. **Budget/spend live updates**: `useBudgetSummary` and `useBudgetTimeline` are one-shot fetches. To make them live, the backend needs to emit a spend event (e.g., `spend:updated`) when `CostTrackingService.trackLLMUsage()` records cost. Add a listener in `AppEventsGateway`, broadcast `spend:updated`, and invalidate `['budget-summary']` in `GlobalRealtimeContext`. This is straightforward but requires a backend change to the cost tracking service.

2. **Project orchestration status**: `useProjectOrchestrationState` polls at 10s. Replacing this requires the orchestration service to emit a `orchestration:state-changed` event. Lower priority since 10s is acceptable.

3. **Per-user scoping of `run:lifecycle`**: Currently broadcasts to ALL connected clients. In a multi-tenant deployment, scope this to the run owner by injecting a `WorkflowRunRepository` into `AppEventsGateway` to look up the userId, then use `this.server.to('user-{userId}').emit(...)` (following the same room pattern as `NotificationGateway`). The frontend already scopes its data correctly via React Query HTTP calls, so this is a security/privacy improvement rather than a functionality fix.

4. **`useChatSessionTelemetry` + `useWorkflowRunTelemetry` deduplication**: Both hooks are structural clones. Extract a `createTelemetryHook(config)` factory to eliminate the duplication. No behaviour change needed.
