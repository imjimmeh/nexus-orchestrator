import { describe, expect, it, vi } from 'vitest';
import { SubagentDetailsRepository } from './subagent-details.repository';

function buildRepo() {
  const typeormRepo = {
    findOne: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockImplementation((row) =>
      Promise.resolve({
        created_at: new Date(),
        updated_at: new Date(),
        ...row,
      }),
    ),
    find: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  return {
    repo: new SubagentDetailsRepository(typeormRepo),
    typeormRepo,
  };
}

describe('SubagentDetailsRepository', () => {
  describe('findByExecutionId', () => {
    it('delegates to findOne with execution_id where clause', async () => {
      const { repo, typeormRepo } = buildRepo();
      await repo.findByExecutionId('exec-1');
      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { execution_id: 'exec-1' },
      });
    });

    it('returns null when no record exists', async () => {
      const { repo } = buildRepo();
      const result = await repo.findByExecutionId('missing');
      expect(result).toBeNull();
    });
  });

  describe('upsert', () => {
    it('calls save with the provided details', async () => {
      const { repo, typeormRepo } = buildRepo();
      const details = {
        execution_id: 'exec-2',
        parent_container_id: 'container-abc',
        depth: 1,
      };
      await repo.upsert(details);
      expect(typeormRepo.save).toHaveBeenCalledWith(details);
    });

    it('returns the saved entity', async () => {
      const { repo } = buildRepo();
      const details = {
        execution_id: 'exec-3',
        parent_container_id: 'container-xyz',
        depth: 0,
      };
      const result = await repo.upsert(details);
      expect(result).toMatchObject(details);
    });
  });

  describe('findByParentContainerId', () => {
    it('queries find with parent_container_id where clause', async () => {
      const { repo, typeormRepo } = buildRepo();
      await repo.findByParentContainerId('container-parent');
      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { parent_container_id: 'container-parent' },
      });
    });

    it('returns an empty array when no records exist', async () => {
      const { repo } = buildRepo();
      const result = await repo.findByParentContainerId('no-children');
      expect(result).toEqual([]);
    });
  });

  describe('delete', () => {
    it('delegates to repo.delete with the execution id', async () => {
      const { repo, typeormRepo } = buildRepo();
      await repo.delete('exec-4');
      expect(typeormRepo.delete).toHaveBeenCalledWith('exec-4');
    });

    it('resolves without error', async () => {
      const { repo } = buildRepo();
      await expect(repo.delete('exec-5')).resolves.toBeUndefined();
    });
  });
});
