import { describe, it, expect, vi } from 'vitest';
import { In, IsNull } from 'typeorm';
import type { Repository } from 'typeorm';
import { HarnessAssetRepository } from './harness-asset.repository';
import type { HarnessAssetEntity } from './harness-asset.entity';
import type { HarnessAssetSource } from '@nexus/core';

function makeTypeormRepo(): Repository<HarnessAssetEntity> {
  return {
    create: vi.fn(),
    save: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(),
  } as unknown as Repository<HarnessAssetEntity>;
}

function buildAsset(
  overrides: Partial<HarnessAssetEntity> = {},
): HarnessAssetEntity {
  const source: HarnessAssetSource = { kind: 'authored' };
  return {
    id: 'asset-uuid-1',
    kind: 'plugin',
    name: 'my-plugin',
    version: '1.0.0',
    source,
    checksum: 'sha256:abc123',
    bundle: '{}',
    scopeNodeId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('HarnessAssetRepository', () => {
  describe('create', () => {
    it('persists and returns the new asset row', async () => {
      const typeormRepo = makeTypeormRepo();
      const asset = buildAsset();
      vi.mocked(typeormRepo.create).mockReturnValue(asset);
      vi.mocked(typeormRepo.save).mockResolvedValue(asset);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.create({
        kind: 'plugin',
        name: 'my-plugin',
        version: '1.0.0',
        source: { kind: 'authored' },
        checksum: 'sha256:abc123',
        bundle: '{}',
        scopeNodeId: null,
      });

      expect(typeormRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'plugin', name: 'my-plugin' }),
      );
      expect(typeormRepo.save).toHaveBeenCalledWith(asset);
      expect(result).toBe(asset);
    });

    it('persists checksum and jsonb source and reads them back equal', async () => {
      const typeormRepo = makeTypeormRepo();
      const gitSource: HarnessAssetSource = {
        kind: 'git',
        repo: 'https://github.com/org/repo',
        ref: 'main',
        subdir: 'plugins/foo',
      };
      const asset = buildAsset({
        source: gitSource,
        checksum: 'sha256:deadbeef',
      });
      vi.mocked(typeormRepo.create).mockReturnValue(asset);
      vi.mocked(typeormRepo.save).mockResolvedValue(asset);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.create({
        kind: 'extension',
        name: 'foo-ext',
        version: '2.0.0',
        source: gitSource,
        checksum: 'sha256:deadbeef',
        bundle: 'console.log("hi")',
        scopeNodeId: null,
      });

      expect(result.source).toEqual(gitSource);
      expect(result.checksum).toBe('sha256:deadbeef');
    });
  });

  describe('findById', () => {
    it('returns the row when found', async () => {
      const typeormRepo = makeTypeormRepo();
      const asset = buildAsset();
      vi.mocked(typeormRepo.findOne).mockResolvedValue(asset);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findById('asset-uuid-1');

      expect(typeormRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'asset-uuid-1' },
      });
      expect(result).toBe(asset);
    });

    it('returns null when not found', async () => {
      const typeormRepo = makeTypeormRepo();
      vi.mocked(typeormRepo.findOne).mockResolvedValue(null);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('findByIds', () => {
    it('returns all rows matching the given ids', async () => {
      const typeormRepo = makeTypeormRepo();
      const rows = [buildAsset(), buildAsset({ id: 'asset-uuid-2' })];
      vi.mocked(typeormRepo.find).mockResolvedValue(rows);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findByIds(['asset-uuid-1', 'asset-uuid-2']);

      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { id: In(['asset-uuid-1', 'asset-uuid-2']) },
      });
      expect(result).toHaveLength(2);
    });

    it('returns [] for an empty ids list without querying', async () => {
      const typeormRepo = makeTypeormRepo();
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findByIds([]);

      expect(typeormRepo.find).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('findByScope', () => {
    it('returns rows for the given scopeNodeId', async () => {
      const typeormRepo = makeTypeormRepo();
      const rows = [buildAsset({ scopeNodeId: 'scope-abc' })];
      vi.mocked(typeormRepo.find).mockResolvedValue(rows);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findByScope('scope-abc');

      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { scopeNodeId: 'scope-abc' },
      });
      expect(result).toBe(rows);
    });

    it('returns platform-global rows when scopeNodeId is null', async () => {
      const typeormRepo = makeTypeormRepo();
      const rows = [buildAsset({ scopeNodeId: null })];
      vi.mocked(typeormRepo.find).mockResolvedValue(rows);
      const sut = new HarnessAssetRepository(typeormRepo);

      const result = await sut.findByScope(null);

      expect(typeormRepo.find).toHaveBeenCalledWith({
        where: { scopeNodeId: IsNull() },
      });
      expect(result).toBe(rows);
    });
  });
});
