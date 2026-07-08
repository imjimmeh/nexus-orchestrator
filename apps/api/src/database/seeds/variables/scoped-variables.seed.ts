import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScopedVariableValueType } from '@nexus/core';
import { ScopedVariableRepository } from '../../../variables/database/repositories/scoped-variable.repository';

interface SeedVariable {
  key: string;
  value: unknown;
  valueType: ScopedVariableValueType;
  description?: string | null;
}

/**
 * Seed default GLOBAL variables from seed/variables/*.json. The seeder is
 * domain-agnostic: orchestration key names live in the seed data files, not in
 * this source, preserving domain boundaries. Existing rows are never overwritten
 * (defaults only fill gaps).
 */
@Injectable()
export class ScopedVariableSeedService {
  private readonly logger = new Logger(ScopedVariableSeedService.name);

  private readonly candidateSeedDirs = [
    process.env.NEXUS_VARIABLES_SEED_PATH?.trim(),
    path.join(process.cwd(), 'seed', 'variables'),
    path.join(process.cwd(), '..', 'seed', 'variables'),
    path.join(process.cwd(), '..', '..', 'seed', 'variables'),
    path.resolve(__dirname, '../../../../../../seed/variables'),
  ].filter((dir): dir is string => Boolean(dir));

  constructor(private readonly repository: ScopedVariableRepository) {}

  async seed(): Promise<void> {
    const dir = this.candidateSeedDirs.find(
      (candidate) =>
        fs.existsSync(candidate) && this.listFiles(candidate).length > 0,
    );
    if (!dir) {
      this.logger.log(
        `No variable seed files found. Checked: ${this.candidateSeedDirs.join(', ')}`,
      );
      return;
    }

    let seeded = 0;
    for (const file of this.listFiles(dir)) {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, file), 'utf8'),
      ) as { variables?: SeedVariable[] };
      for (const variable of parsed.variables ?? []) {
        const existing = await this.repository.findOneByKeyAndScope(
          variable.key,
          null,
        );
        if (existing) {
          continue;
        }
        await this.repository.upsert({
          scopeNodeId: null,
          key: variable.key,
          value: variable.value,
          valueType: variable.valueType,
          description: variable.description ?? null,
        });
        seeded++;
      }
    }
    this.logger.log(`Seeded ${seeded} default global variable(s)`);
  }

  private listFiles(directory: string): string[] {
    return fs.readdirSync(directory).filter((file) => file.endsWith('.json'));
  }
}
