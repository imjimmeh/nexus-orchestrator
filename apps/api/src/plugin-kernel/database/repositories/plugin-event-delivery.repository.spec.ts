import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Repository } from 'typeorm';
import { PluginEventDelivery } from '../entities/plugin-event-delivery.entity';
import {
  PluginEventDeliveryRepository,
  type PluginEventDeliveryStatus,
} from './plugin-event-delivery.repository';

type MockQueryBuilder = {
  select: ReturnType<typeof vi.fn>;
  addSelect: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  getRawMany: ReturnType<typeof vi.fn>;
  clone: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
};

type MockTypeOrmRepository = Pick<
  Repository<PluginEventDelivery>,
  'create' | 'save' | 'find' | 'findOne' | 'update' | 'createQueryBuilder'
>;

function createQueryBuilderMock(
  overrides: Partial<MockQueryBuilder> = {},
): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    select: vi.fn().mockReturnThis(),
    addSelect: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ raw: [] }),
    getRawMany: vi.fn().mockResolvedValue([]),
    clone: vi.fn().mockReturnThis(),
    getCount: vi.fn().mockResolvedValue(0),
    ...overrides,
  };

  return builder;
}

function createTypeOrmRepository(
  overrides: Partial<MockTypeOrmRepository> = {},
): MockTypeOrmRepository {
  return {
    create: vi.fn(),
    save: vi.fn(),
    find: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    createQueryBuilder: vi.fn(),
    ...overrides,
  };
}

function createRepository(
  overrides: Partial<MockTypeOrmRepository> = {},
): PluginEventDeliveryRepository {
  return new PluginEventDeliveryRepository(
    createTypeOrmRepository(overrides) as Repository<PluginEventDelivery>,
  );
}

function createDelivery(
  overrides: Partial<PluginEventDelivery> = {},
): PluginEventDelivery {
  return {
    id: 'delivery-1',
    plugin_id: 'acme.plugin',
    plugin_version: '1.0.0',
    contribution_id: 'audit-subscription',
    topic: 'workflow.run.completed.v1',
    event_name: 'workflow.run.completed.v1',
    payload: { scopeId: 'scope-1' },
    correlation_id: 'corr-1',
    delivery_mode: 'non_blocking',
    status: 'pending',
    attempt_count: 0,
    max_attempts: 3,
    retry_initial_delay_ms: 1000,
    retry_backoff_multiplier: 2,
    dead_letter_enabled: true,
    next_attempt_at: new Date('2026-05-18T12:00:00.000Z'),
    delivered_at: null,
    error_code: null,
    error_message: null,
    error_metadata: null,
    created_at: new Date('2026-05-18T12:00:00.000Z'),
    updated_at: new Date('2026-05-18T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PluginEventDeliveryRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending delivery record', async () => {
    const pending = createDelivery();
    const repository = createTypeOrmRepository({
      create: vi.fn().mockReturnValue(pending),
      save: vi.fn().mockResolvedValue(pending),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.createPending({
      pluginId: 'acme.plugin',
      pluginVersion: '1.0.0',
      contributionId: 'audit-subscription',
      topic: 'workflow.run.completed.v1',
      eventName: 'workflow.run.completed.v1',
      payload: { scopeId: 'scope-1' },
      correlationId: 'corr-1',
      deliveryMode: 'non_blocking',
      maxAttempts: 3,
      retryInitialDelayMs: 1000,
      retryBackoffMultiplier: 2,
      deadLetterEnabled: true,
      nextAttemptAt: new Date('2026-05-18T12:00:00.000Z'),
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        plugin_id: 'acme.plugin',
        status: 'pending',
        attempt_count: 0,
      }),
    );
    expect(repository.save).toHaveBeenCalledWith(pending);
    expect(result).toEqual(pending);
  });

  it('claims due pending or failed deliveries', async () => {
    const due = createDelivery({ status: 'delivering' });
    const qb = createQueryBuilderMock({
      execute: vi.fn().mockResolvedValue({ raw: [due] }),
    });
    const subject = createRepository({
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    });

    const result = await subject.claimDueDeliveries(
      5,
      new Date('2026-05-18T12:00:00.000Z'),
    );

    expect(qb.update).toHaveBeenCalled();
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivering' }),
    );
    expect(result).toEqual([due]);
  });

  it('marks a delivery as delivered', async () => {
    const delivered = createDelivery({
      status: 'delivered',
      delivered_at: new Date(),
    });
    const repository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(delivered),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.markDelivered(
      'delivery-1',
      new Date('2026-05-18T12:01:00.000Z'),
    );

    expect(repository.update).toHaveBeenCalled();
    expect(result?.status).toBe('delivered');
  });

  it('marks a delivery as failed and schedules next attempt', async () => {
    const failed = createDelivery({
      status: 'failed',
      attempt_count: 1,
      error_code: 'runtime_timeout',
      error_message: 'Plugin runtime call timed out.',
    });
    const repository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(failed),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.markFailed({
      id: 'delivery-1',
      nextAttemptAt: new Date('2026-05-18T12:02:00.000Z'),
      errorCode: 'runtime_timeout',
      errorMessage: 'Plugin runtime call timed out.',
      errorMetadata: { retryable: true },
      incrementAttemptCount: true,
    });

    expect(repository.update).toHaveBeenCalled();
    expect(result?.status).toBe('failed');
  });

  it('marks a delivery as dead-lettered', async () => {
    const deadLetter = createDelivery({ status: 'dead_lettered' });
    const repository = createTypeOrmRepository({
      update: vi.fn().mockResolvedValue({ affected: 1 }),
      findOne: vi.fn().mockResolvedValue(deadLetter),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.markDeadLettered({
      id: 'delivery-1',
      errorCode: 'delivery_exhausted',
      errorMessage: 'Delivery attempts exhausted.',
      errorMetadata: { attempts: 3 },
    });

    expect(repository.update).toHaveBeenCalled();
    expect(result?.status).toBe('dead_lettered');
  });

  it('lists delivery records by status, plugin, and topic', async () => {
    const rows = [createDelivery({ status: 'dead_lettered' })];
    const repository = createTypeOrmRepository({
      find: vi.fn().mockResolvedValue(rows),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.listByFilters({
      status: 'dead_lettered',
      pluginId: 'acme.plugin',
      topic: 'workflow.run.completed.v1',
      limit: 10,
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'dead_lettered',
          plugin_id: 'acme.plugin',
          topic: 'workflow.run.completed.v1',
        }),
      }),
    );
    expect(result).toEqual(rows);
  });

  it('lists recent deliveries with default limit', async () => {
    const rows = [createDelivery({ id: 'delivery-recent' })];
    const repository = createTypeOrmRepository({
      find: vi.fn().mockResolvedValue(rows),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.listRecentDeliveries({
      pluginId: 'acme.plugin',
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          plugin_id: 'acme.plugin',
        }),
        take: 50,
      }),
    );
    expect(result).toEqual(rows);
  });

  it('lists dead-letter deliveries through helper method', async () => {
    const rows = [createDelivery({ status: 'dead_lettered' })];
    const repository = createTypeOrmRepository({
      find: vi.fn().mockResolvedValue(rows),
    });
    const subject = new PluginEventDeliveryRepository(
      repository as Repository<PluginEventDelivery>,
    );

    const result = await subject.listDeadLetterDeliveries({
      pluginId: 'acme.plugin',
      limit: 5,
    });

    expect(repository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'dead_lettered',
          plugin_id: 'acme.plugin',
        }),
        take: 5,
      }),
    );
    expect(result).toEqual(rows);
  });

  it('aggregates delivery counts by status', async () => {
    const qb = createQueryBuilderMock({
      getRawMany: vi.fn().mockResolvedValue([
        { status: 'delivered', count: '4' },
        { status: 'failed', count: '2' },
      ]),
    });
    const subject = createRepository({
      createQueryBuilder: vi.fn().mockReturnValue(qb),
    });

    const result = await subject.countByStatus({ pluginId: 'acme.plugin' });

    expect(result).toEqual({
      pending: 0,
      delivering: 0,
      delivered: 4,
      failed: 2,
      dead_lettered: 0,
    });
    expect(qb.groupBy).toHaveBeenCalledWith('delivery.status');
  });

  // --------------------------------------------------------------------------
  // Observability query methods
  // --------------------------------------------------------------------------

  describe('findRecentDeliveries', () => {
    const rawDeliveryRow = {
      id: 'delivery-1',
      plugin_id: 'acme.plugin',
      plugin_version: '1.0.0',
      contribution_id: 'audit-subscription',
      topic: 'workflow.run.completed.v1',
      event_name: 'workflow.run.completed.v1',
      payload: { sensitiveData: 'should-be-redacted' },
      correlation_id: 'corr-1',
      delivery_mode: 'non_blocking',
      status: 'delivered',
      attempt_count: 1,
      max_attempts: 3,
      retry_initial_delay_ms: 1000,
      retry_backoff_multiplier: 2,
      dead_letter_enabled: true,
      next_attempt_at: new Date('2026-05-18T12:00:00.000Z'),
      delivered_at: new Date('2026-05-18T12:00:01.000Z'),
      error_code: null,
      error_message: null,
      error_metadata: null,
      created_at: new Date('2026-05-18T12:00:00.000Z'),
      updated_at: new Date('2026-05-18T12:00:01.000Z'),
    };

    it('returns plain DTOs with payloads redacted', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([rawDeliveryRow]),
        getCount: vi.fn().mockResolvedValue(1),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.findRecentDeliveries('acme.plugin');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('delivery-1');
      expect(result.items[0].payload).toBeNull();
      expect(result.items[0].pluginId).toBe('acme.plugin');
    });

    it('applies topic and status filters', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.findRecentDeliveries('acme.plugin', {
        topic: 'tool.invoked.v1',
        status: 'failed',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('delivery.topic = :topic', {
        topic: 'tool.invoked.v1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('delivery.status = :status', {
        status: 'failed',
      });
    });

    it('applies contributionId filter', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.findRecentDeliveries('acme.plugin', {
        contributionId: 'subscription-1',
      });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'delivery.contribution_id = :contributionId',
        { contributionId: 'subscription-1' },
      );
    });

    it('returns pagination metadata', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(42),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.findRecentDeliveries('acme.plugin', {
        limit: 10,
        offset: 20,
      });

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(20);
      expect(result.total).toBe(42);
    });

    it('does NOT include payload column in query', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.findRecentDeliveries('acme.plugin');

      // Verify payload is NOT selected (payload is redacted for observability)
      expect(qb.addSelect).not.toHaveBeenCalledWith(
        'delivery.payload',
        'payload',
      );
    });
  });

  describe('findDeadLetters', () => {
    const rawDeadLetterRow = {
      id: 'dead-letter-1',
      plugin_id: 'acme.plugin',
      plugin_version: '1.0.0',
      contribution_id: 'audit-subscription',
      topic: 'workflow.run.completed.v1',
      event_name: 'workflow.run.completed.v1',
      payload: { sensitiveData: 'should-be-redacted' },
      correlation_id: 'corr-1',
      delivery_mode: 'non_blocking',
      status: 'dead_lettered',
      attempt_count: 3,
      max_attempts: 3,
      retry_initial_delay_ms: 1000,
      retry_backoff_multiplier: 2,
      dead_letter_enabled: true,
      next_attempt_at: new Date('2026-05-18T12:00:00.000Z'),
      delivered_at: null,
      error_code: 'delivery_exhausted',
      error_message: 'Max attempts reached',
      error_metadata: { attempts: 3 },
      created_at: new Date('2026-05-18T12:00:00.000Z'),
      updated_at: new Date('2026-05-18T12:00:01.000Z'),
    };

    it('returns plain DTOs with payloads redacted', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([rawDeadLetterRow]),
        getCount: vi.fn().mockResolvedValue(1),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.findDeadLetters('acme.plugin');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('dead-letter-1');
      expect(result.items[0].payload).toBeNull();
      expect(result.items[0].status).toBe('dead_lettered');
    });

    it('applies topic and contributionId filters', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.findDeadLetters('acme.plugin', {
        topic: 'tool.invoked.v1',
        contributionId: 'subscription-1',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('delivery.topic = :topic', {
        topic: 'tool.invoked.v1',
      });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'delivery.contribution_id = :contributionId',
        { contributionId: 'subscription-1' },
      );
    });

    it('returns empty list when no dead letters exist', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.findDeadLetters(undefined);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('does NOT include payload column in query', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
        getCount: vi.fn().mockResolvedValue(0),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.findDeadLetters(undefined);

      // Verify payload is NOT selected (payload is redacted for observability)
      expect(qb.addSelect).not.toHaveBeenCalledWith(
        'delivery.payload',
        'payload',
      );
    });
  });

  describe('aggregateCounts', () => {
    it('returns status counts grouped by status', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([
          { status: 'delivered', count: '10' },
          { status: 'failed', count: '5' },
          { status: 'dead_lettered', count: '2' },
        ]),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.aggregateCounts();

      expect(result.counts).toHaveLength(3);
      expect(result.total).toBe(17);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('applies pluginId filter', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.aggregateCounts({ pluginId: 'acme.plugin' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        'delivery.plugin_id = :pluginId',
        { pluginId: 'acme.plugin' },
      );
    });

    it('applies topic filter', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      await subject.aggregateCounts({ topic: 'tool.invoked.v1' });

      expect(qb.andWhere).toHaveBeenCalledWith('delivery.topic = :topic', {
        topic: 'tool.invoked.v1',
      });
    });

    it('returns zero counts when no deliveries exist', async () => {
      const qb = createQueryBuilderMock({
        getRawMany: vi.fn().mockResolvedValue([]),
      });
      const subject = createRepository({
        createQueryBuilder: vi.fn().mockReturnValue(qb),
      });

      const result = await subject.aggregateCounts();

      expect(result.counts).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
