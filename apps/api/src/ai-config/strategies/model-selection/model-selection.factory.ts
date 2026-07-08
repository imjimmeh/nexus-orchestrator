import { Injectable } from '@nestjs/common';
import { DatabaseModelStrategy } from './database-model.strategy';
import { EnvironmentModelStrategy } from './environment-model.strategy';

@Injectable()
export class ModelSelectionFactory {
  constructor(
    private readonly databaseStrategy: DatabaseModelStrategy,
    private readonly environmentStrategy: EnvironmentModelStrategy,
  ) {}

  async selectModel(useCase: string): Promise<string> {
    const strategies = [this.databaseStrategy, this.environmentStrategy].sort(
      (a, b) => a.priority - b.priority,
    );

    for (const strategy of strategies) {
      if (strategy.canSelect(useCase)) {
        const model = await strategy.selectModel(useCase);
        if (model) {
          return model;
        }
      }
    }

    return 'default-model';
  }
}
