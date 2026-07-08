import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScopedVariableSeedService } from './scoped-variables.seed';
import type { ScopedVariableRepository } from '../../../variables/database/repositories/scoped-variable.repository';

describe('ScopedVariableSeedService', () => {
  let seedRoot: string;
  let repo: ScopedVariableRepository;

  beforeEach(() => {
    seedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vars-seed-'));
    const dir = path.join(seedRoot, 'seed', 'variables');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'orchestration-defaults.json'),
      JSON.stringify({
        variables: [
          {
            key: 'gates.rediscovery_merge_threshold',
            value: 10,
            valueType: 'number',
          },
        ],
      }),
    );
    process.env.NEXUS_VARIABLES_SEED_PATH = dir;
    repo = {
      findOneByKeyAndScope: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    } as unknown as ScopedVariableRepository;
  });

  afterEach(() => {
    delete process.env.NEXUS_VARIABLES_SEED_PATH;
    fs.rmSync(seedRoot, { recursive: true, force: true });
  });

  it('inserts global defaults that do not yet exist', async () => {
    const service = new ScopedVariableSeedService(repo);
    await service.seed();
    expect(repo.upsert).toHaveBeenCalledWith({
      scopeNodeId: null,
      key: 'gates.rediscovery_merge_threshold',
      value: 10,
      valueType: 'number',
      description: null,
    });
  });

  it('does not overwrite an existing global default', async () => {
    (repo.findOneByKeyAndScope as ReturnType<typeof vi.fn>).mockResolvedValue({
      key: 'gates.rediscovery_merge_threshold',
    });
    const service = new ScopedVariableSeedService(repo);
    await service.seed();
    expect(repo.upsert).not.toHaveBeenCalled();
  });
});
