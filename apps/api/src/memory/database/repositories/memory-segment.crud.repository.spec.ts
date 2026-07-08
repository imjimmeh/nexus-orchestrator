import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IsNull, type Repository } from 'typeorm';
import type { MemorySegment } from '../entities/memory-segment.entity';
import { MemorySegmentCrudRepository } from './memory-segment.crud.repository';

// ---------------------------------------------------------------------------
// CRUD-shape read/write surface for `memory_segments`.
//
// Read methods (`findAll`, `findById`, `findByEntity`, `findByEntityType`)
// default to `archived_at IS NULL` so the nightly `MemoryDecayReaper`
// (work item 3d7fb798) cannot silently surface confidence-decayed
// material to callers. The filter is delegated to `buildReadWhere`.
//
// Write methods (`create`, `update`, `save`, `remove`) are
// thin wrappers over TypeORM's `repository.create / update /
// save / delete` — they exist so the consumer-side migration can
// inject a single CRUD-shaped dependency instead of pulling in the
// TypeORM `Repository<MemorySegment>` directly.
// ---------------------------------------------------------------------------

describe('MemorySegmentCrudRepository', () => {
  const find = vi.fn();
  const findOne = vi.fn();
  const create = vi.fn();
  const save = vi.fn();
  const update = vi.fn();
  const remove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------
  // Read methods — `archived_at IS NULL` default invariant.
  // -----------------------------------------------------------------

  describe('findAll', () => {
    it('excludes archived rows by default', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findAll();

      expect(find).toHaveBeenCalledWith({
        where: { archived_at: IsNull() },
      });
    });

    it('honours includeArchived: true', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findAll({ includeArchived: true });

      expect(find).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('findById', () => {
    it('excludes archived rows by default', async () => {
      findOne.mockResolvedValue(null);
      const repository = new MemorySegmentCrudRepository({
        findOne,
      } as unknown as Repository<MemorySegment>);

      await repository.findById('segment-1');

      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'segment-1', archived_at: IsNull() },
      });
    });

    it('honours includeArchived: true', async () => {
      findOne.mockResolvedValue({ id: 'segment-1' });
      const repository = new MemorySegmentCrudRepository({
        findOne,
      } as unknown as Repository<MemorySegment>);

      await repository.findById('segment-1', { includeArchived: true });

      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'segment-1' },
      });
    });
  });

  describe('findByEntity', () => {
    it('excludes archived rows by default and orders by created_at DESC', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findByEntity('user', 'user-1');

      expect(find).toHaveBeenCalledWith({
        where: {
          entity_type: 'user',
          entity_id: 'user-1',
          archived_at: IsNull(),
        },
        order: { created_at: 'DESC' },
      });
    });

    it('honours includeArchived: true', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findByEntity('user', 'user-1', {
        includeArchived: true,
      });

      expect(find).toHaveBeenCalledWith({
        where: { entity_type: 'user', entity_id: 'user-1' },
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('findByEntityType', () => {
    it('excludes archived rows and orders by created_at DESC (entity_type + entity_id)', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findByEntityType('user', 'user-1');

      expect(find).toHaveBeenCalledWith({
        where: {
          entity_type: 'user',
          entity_id: 'user-1',
          archived_at: IsNull(),
        },
        order: { created_at: 'DESC' },
      });
    });

    it('excludes archived rows when entity_id is not provided', async () => {
      find.mockResolvedValue([]);
      const repository = new MemorySegmentCrudRepository({
        find,
      } as unknown as Repository<MemorySegment>);

      await repository.findByEntityType('user');

      expect(find).toHaveBeenCalledWith({
        where: { entity_type: 'user', archived_at: IsNull() },
        order: { created_at: 'DESC' },
      });
    });
  });

  // -----------------------------------------------------------------
  // Write methods — happy-path coverage.
  // -----------------------------------------------------------------

  describe('create', () => {
    it('invokes repository.create + repository.save and returns the persisted entity', async () => {
      const input = { content: 'hello' } as Partial<MemorySegment>;
      const staged = { id: 'memory-1', content: 'hello' } as MemorySegment;
      const persisted = { id: 'memory-1', content: 'hello' } as MemorySegment;
      create.mockReturnValue(staged);
      save.mockResolvedValue(persisted);
      const repository = new MemorySegmentCrudRepository({
        create,
        save,
      } as unknown as Repository<MemorySegment>);

      const result = await repository.create(input);

      expect(create).toHaveBeenCalledWith(input);
      expect(save).toHaveBeenCalledWith(staged);
      expect(result).toBe(persisted);
    });
  });

  describe('update', () => {
    it('invokes repository.update(id, partial) and re-fetches via findById', async () => {
      update.mockResolvedValue({ affected: 1 });
      findOne.mockResolvedValue({
        id: 'segment-1',
        content: 'updated',
      });
      const repository = new MemorySegmentCrudRepository({
        update,
        findOne,
      } as unknown as Repository<MemorySegment>);

      const result = await repository.update('segment-1', {
        content: 'updated',
      });

      expect(update).toHaveBeenCalledWith('segment-1', {
        content: 'updated',
      });
      // The follow-up read MUST default to `archived_at IS NULL` so
      // an update that "should have succeeded" cannot accidentally
      // resurrect an archived row.
      expect(findOne).toHaveBeenCalledWith({
        where: { id: 'segment-1', archived_at: IsNull() },
      });
      expect(result).toEqual({ id: 'segment-1', content: 'updated' });
    });

    it('returns null when the row does not exist after update', async () => {
      update.mockResolvedValue({ affected: 0 });
      findOne.mockResolvedValue(null);
      const repository = new MemorySegmentCrudRepository({
        update,
        findOne,
      } as unknown as Repository<MemorySegment>);

      const result = await repository.update('missing', { content: 'x' });

      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('invokes repository.save(entity) and returns the persisted entity', async () => {
      const entity = { id: 'segment-1', content: 'mutated' } as MemorySegment;
      save.mockResolvedValue(entity);
      const repository = new MemorySegmentCrudRepository({
        save,
      } as unknown as Repository<MemorySegment>);

      const result = await repository.save(entity);

      expect(save).toHaveBeenCalledWith(entity);
      expect(result).toBe(entity);
    });
  });

  describe('remove', () => {
    it('invokes repository.delete(id)', async () => {
      remove.mockResolvedValue({ affected: 1 });
      const repository = new MemorySegmentCrudRepository({
        delete: remove,
      } as unknown as Repository<MemorySegment>);

      await repository.remove('segment-1');

      expect(remove).toHaveBeenCalledWith('segment-1');
    });
  });
});
