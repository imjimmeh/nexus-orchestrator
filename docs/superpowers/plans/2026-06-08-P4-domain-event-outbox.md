# P4: DB-Backed Domain Event Outbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `InMemoryDomainEventOutboxStore` with a TypeORM-backed implementation so domain events survive process restarts. The in-memory implementation currently defeats the delivery guarantee of the outbox pattern.

**Architecture:** Create a `domain_event_outbox` table via a TypeORM entity and migration. Implement `DatabaseDomainEventOutboxStore` that satisfies the existing `DomainEventOutboxStore` interface. Register it as the DI provider replacing the in-memory store. The existing consumer that polls and delivers events does not need to change — only the store implementation is swapped.

**Tech Stack:** TypeORM, NestJS, PostgreSQL, Vitest

---

## Files

| Action | File |
|---|---|
| Read first | `apps/api/src/domain-events/in-memory-domain-event-outbox.store.ts` |
| Read first | `apps/api/src/domain-events/domain-events.module.ts` |
| Create | `apps/api/src/domain-events/database/entities/domain-event-outbox.entity.ts` |
| Create | `apps/api/src/domain-events/database/repositories/domain-event-outbox.repository.ts` |
| Create | `apps/api/src/domain-events/database-domain-event-outbox.store.ts` |
| Create | `apps/api/src/domain-events/database-domain-event-outbox.store.spec.ts` |
| Create | `apps/api/src/database/migrations/<timestamp>-create-domain-event-outbox.ts` |
| Modify | `apps/api/src/database/database.module.ts` |
| Modify | `apps/api/src/domain-events/domain-events.module.ts` |

---

## Task 1: Read the existing interface and in-memory store

Before writing anything, read these two files to understand the exact interface contract:

- [ ] **Step 1: Read the interface and in-memory implementation**

```bash
cat apps/api/src/domain-events/in-memory-domain-event-outbox.store.ts
```

Look for:
- The interface `DomainEventOutboxStore` and its method signatures
- What a "domain event" looks like (id, type, payload, status)
- How the consumer calls `append`, `markDelivered`, `findPending`

Once read, proceed to Task 2.

---

## Task 2: Create the outbox entity and migration

**Files:**
- Create: `apps/api/src/domain-events/database/entities/domain-event-outbox.entity.ts`
- Create: `apps/api/src/database/migrations/<timestamp>-create-domain-event-outbox.ts`

- [ ] **Step 1: Create the entity**

```typescript
// apps/api/src/domain-events/database/entities/domain-event-outbox.entity.ts
import {
  Entity, PrimaryColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

@Entity('domain_event_outbox')
@Index('idx_domain_event_outbox_status_created', ['status', 'createdAt'])
export class DomainEventOutboxEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 255 })
  eventType!: string;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  @Index('idx_domain_event_outbox_status')
  status!: 'pending' | 'delivered' | 'failed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  @Column({ name: 'failed_reason', type: 'text', nullable: true })
  failedReason!: string | null;
}
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api && npx typeorm migration:create src/database/migrations/create-domain-event-outbox
```

Then fill in the generated file:

```typescript
import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateDomainEventOutbox<timestamp> implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'domain_event_outbox',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'event_type', type: 'varchar', length: '255' },
          { name: 'payload', type: 'jsonb' },
          { name: 'status', type: 'varchar', length: '50', default: "'pending'" },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'delivered_at', type: 'timestamptz', isNullable: true },
          { name: 'failed_reason', type: 'text', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'domain_event_outbox',
      new TableIndex({
        name: 'idx_domain_event_outbox_status_created',
        columnNames: ['status', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('domain_event_outbox');
  }
}
```

- [ ] **Step 3: Register the entity in DatabaseModule**

In `apps/api/src/database/database.module.ts`, add `DomainEventOutboxEntity` to the entities array:

```typescript
import { DomainEventOutboxEntity } from '../domain-events/database/entities/domain-event-outbox.entity';

// Add to the entities: [...] array in TypeOrmModule.forRootAsync
entities: [
  // ...existing entities...
  DomainEventOutboxEntity,
],
```

---

## Task 3: Implement `DatabaseDomainEventOutboxStore`

**Files:**
- Create: `apps/api/src/domain-events/database/repositories/domain-event-outbox.repository.ts`
- Create: `apps/api/src/domain-events/database-domain-event-outbox.store.ts`
- Create: `apps/api/src/domain-events/database-domain-event-outbox.store.spec.ts`

- [ ] **Step 1: Create the repository**

```typescript
// apps/api/src/domain-events/database/repositories/domain-event-outbox.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainEventOutboxEntity } from '../entities/domain-event-outbox.entity';

@Injectable()
export class DomainEventOutboxRepository {
  constructor(
    @InjectRepository(DomainEventOutboxEntity)
    private readonly repo: Repository<DomainEventOutboxEntity>,
  ) {}

  save(entity: DomainEventOutboxEntity): Promise<DomainEventOutboxEntity> {
    return this.repo.save(entity);
  }

  findPending(): Promise<DomainEventOutboxEntity[]> {
    return this.repo.find({
      where: { status: 'pending' },
      order: { createdAt: 'ASC' },
      take: 100,
    });
  }

  updateStatus(
    id: string,
    status: 'delivered' | 'failed',
    meta?: { deliveredAt?: Date; failedReason?: string },
  ): Promise<void> {
    return this.repo
      .update(id, { status, ...meta })
      .then(() => undefined);
  }
}
```

- [ ] **Step 2: Write tests for the store implementation**

```typescript
// apps/api/src/domain-events/database-domain-event-outbox.store.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseDomainEventOutboxStore } from './database-domain-event-outbox.store';

const mockRepo = {
  save: vi.fn(),
  findPending: vi.fn(),
  updateStatus: vi.fn(),
};

describe('DatabaseDomainEventOutboxStore', () => {
  let store: DatabaseDomainEventOutboxStore;

  beforeEach(() => {
    vi.resetAllMocks();
    store = new DatabaseDomainEventOutboxStore(mockRepo as any);
  });

  it('append — saves a new entity with status pending', async () => {
    mockRepo.save.mockResolvedValue({});
    await store.append({ id: 'evt-1', type: 'UserCreated', payload: { userId: 'u1' } });

    expect(mockRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-1',
        eventType: 'UserCreated',
        payload: { userId: 'u1' },
        status: 'pending',
      }),
    );
  });

  it('findPending — returns pending events from the repository', async () => {
    const rows = [
      { id: 'e1', eventType: 'Foo', payload: {}, status: 'pending', createdAt: new Date() },
    ];
    mockRepo.findPending.mockResolvedValue(rows);

    const result = await store.findPending();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('markDelivered — calls updateStatus with delivered', async () => {
    mockRepo.updateStatus.mockResolvedValue(undefined);
    await store.markDelivered('evt-1');
    expect(mockRepo.updateStatus).toHaveBeenCalledWith(
      'evt-1',
      'delivered',
      expect.objectContaining({ deliveredAt: expect.any(Date) }),
    );
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npx vitest run apps/api/src/domain-events/database-domain-event-outbox.store.spec.ts
```

Expected: FAIL — file does not exist.

- [ ] **Step 4: Implement the store**

> First read `apps/api/src/domain-events/in-memory-domain-event-outbox.store.ts` to see the exact interface being implemented, then write:

```typescript
// apps/api/src/domain-events/database-domain-event-outbox.store.ts
import { Injectable } from '@nestjs/common';
import { DomainEventOutboxRepository } from './database/repositories/domain-event-outbox.repository';
import { DomainEventOutboxEntity } from './database/entities/domain-event-outbox.entity';
// Import the interface from wherever InMemoryDomainEventOutboxStore implements it:
import type { DomainEventOutboxStore, DomainOutboxEvent } from './domain-event-outbox.types'; // adjust import

@Injectable()
export class DatabaseDomainEventOutboxStore implements DomainEventOutboxStore {
  constructor(private readonly repo: DomainEventOutboxRepository) {}

  async append(event: DomainOutboxEvent): Promise<void> {
    const entity = new DomainEventOutboxEntity();
    entity.id = event.id;
    entity.eventType = event.type;
    entity.payload = event.payload as Record<string, unknown>;
    entity.status = 'pending';
    entity.deliveredAt = null;
    entity.failedReason = null;
    await this.repo.save(entity);
  }

  async findPending(): Promise<DomainOutboxEvent[]> {
    const rows = await this.repo.findPending();
    return rows.map((row) => ({
      id: row.id,
      type: row.eventType,
      payload: row.payload,
    }));
  }

  async markDelivered(id: string): Promise<void> {
    await this.repo.updateStatus(id, 'delivered', { deliveredAt: new Date() });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.repo.updateStatus(id, 'failed', { failedReason: reason });
  }
}
```

**Note:** Adjust the import path for `DomainEventOutboxStore` and `DomainOutboxEvent` to match wherever those types are declared in the existing codebase. Read `in-memory-domain-event-outbox.store.ts` to find the exact interface name and method signatures.

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx vitest run apps/api/src/domain-events/database-domain-event-outbox.store.spec.ts
```

Expected: All tests pass.

---

## Task 4: Register the DB store as the DI provider

**Files:**
- Modify: `apps/api/src/domain-events/domain-events.module.ts`

- [ ] **Step 1: Replace the in-memory provider**

In `apps/api/src/domain-events/domain-events.module.ts`, locate where `InMemoryDomainEventOutboxStore` is provided and replace:

```typescript
// BEFORE — find the existing provider token, e.g.:
{
  provide: DOMAIN_EVENT_OUTBOX_STORE,  // or whatever the injection token is
  useClass: InMemoryDomainEventOutboxStore,
},

// AFTER
import { DatabaseDomainEventOutboxStore } from './database-domain-event-outbox.store';
import { DomainEventOutboxRepository } from './database/repositories/domain-event-outbox.repository';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEventOutboxEntity } from './database/entities/domain-event-outbox.entity';

// In imports:
TypeOrmModule.forFeature([DomainEventOutboxEntity]),

// In providers:
DomainEventOutboxRepository,
{
  provide: DOMAIN_EVENT_OUTBOX_STORE,
  useClass: DatabaseDomainEventOutboxStore,
},
```

- [ ] **Step 2: Run the domain-events test suite**

```bash
npx vitest run apps/api/src/domain-events/
```

Expected: All tests pass. Any test that previously mocked `InMemoryDomainEventOutboxStore` should still work since the interface is the same.

- [ ] **Step 3: Run the full API test suite**

```bash
npx vitest run apps/api/
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/domain-events/ apps/api/src/database/
git commit -m "feat: replace in-memory domain event outbox with DB-backed implementation"
```
