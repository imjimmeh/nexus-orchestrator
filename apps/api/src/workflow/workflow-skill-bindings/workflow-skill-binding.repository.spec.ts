import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from 'typeorm';
import { WorkflowSkillBinding } from './workflow-skill-binding.entity';
import { WorkflowSkillBindingRepository } from './workflow-skill-binding.repository';

// ---------------------------------------------------------------------------
// `listActive` is the read path for the self-improvement control plane
// `SkillBindingUsageCard`. It must surface only pipeline-mediated
// bindings (non-null provenance) that have NOT been rolled back
// (rolledBackAt IS NULL), order them freshest-first, and apply the
// documented default limit of 200.
// ---------------------------------------------------------------------------

describe('WorkflowSkillBindingRepository.listActive', () => {
  const queryBuilder = {
    where: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    getMany: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters on provenance IS NOT NULL AND provenance->>rolledBackAt IS NULL', async () => {
    const bindings = [{ id: 'binding-1' }] as WorkflowSkillBinding[];
    queryBuilder.getMany.mockResolvedValue(bindings);
    const repository = new WorkflowSkillBindingRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<WorkflowSkillBinding>);

    const result = await repository.listActive();

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'binding.provenance IS NOT NULL',
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      "binding.provenance->>'rolledBackAt' IS NULL",
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'binding.created_at',
      'DESC',
    );
    expect(queryBuilder.limit).toHaveBeenCalledWith(200);
    expect(result).toEqual(bindings);
  });

  it('defaults the limit to 200 when none is provided', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new WorkflowSkillBindingRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<WorkflowSkillBinding>);

    await repository.listActive();

    expect(queryBuilder.limit).toHaveBeenCalledWith(200);
  });

  it('honors a caller-supplied limit', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new WorkflowSkillBindingRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<WorkflowSkillBinding>);

    await repository.listActive({ limit: 25 });

    expect(queryBuilder.limit).toHaveBeenCalledWith(25);
  });

  it('does not add an archived_at filter (the table has no archived_at column)', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new WorkflowSkillBindingRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<WorkflowSkillBinding>);

    await repository.listActive();

    const whereCalls = queryBuilder.where.mock.calls.map(
      (call) => call[0] as string,
    );
    const andWhereCalls = queryBuilder.andWhere.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(whereCalls).not.toContain('binding.archived_at IS NULL');
    expect(andWhereCalls).not.toContain('binding.archived_at IS NULL');
  });

  it('returns an empty array when no active bindings exist', async () => {
    queryBuilder.getMany.mockResolvedValue([]);
    const repository = new WorkflowSkillBindingRepository({
      createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<WorkflowSkillBinding>);

    const result = await repository.listActive();

    expect(result).toEqual([]);
  });
});
