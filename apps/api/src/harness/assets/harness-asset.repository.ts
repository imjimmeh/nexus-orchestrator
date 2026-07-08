import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { HarnessAssetEntity } from './harness-asset.entity';
import type { CreateHarnessAssetInput } from './harness-asset.types';

/**
 * Read/write gateway for the immutable `harness_assets` table.
 *
 * There is intentionally no update or delete path — assets are
 * content-addressed and write-once.
 */
@Injectable()
export class HarnessAssetRepository {
  constructor(
    @InjectRepository(HarnessAssetEntity)
    private readonly repo: Repository<HarnessAssetEntity>,
  ) {}

  /** Persists a new asset row and returns it. */
  async create(input: CreateHarnessAssetInput): Promise<HarnessAssetEntity> {
    const entity = this.repo.create(input);
    return this.repo.save(entity);
  }

  /** Returns the row for `id`, or `null` when not found. */
  findById(id: string): Promise<HarnessAssetEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Returns all rows whose id is in `ids`.
   *
   * Returns an empty array without querying when `ids` is empty.
   */
  findByIds(ids: string[]): Promise<HarnessAssetEntity[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.repo.find({ where: { id: In(ids) } });
  }

  /**
   * Returns all assets belonging to the given scope.
   * Pass `null` to retrieve platform-global assets.
   */
  findByScope(scopeNodeId: string | null): Promise<HarnessAssetEntity[]> {
    return this.repo.find({
      where: { scopeNodeId: scopeNodeId === null ? IsNull() : scopeNodeId },
    });
  }
}
