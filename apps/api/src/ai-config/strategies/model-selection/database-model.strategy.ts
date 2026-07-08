import { Injectable } from '@nestjs/common';
import { ModelSelectionStrategy } from './model-selection.strategy';
import {
  LlmModelRepository,
  ModelUseCase,
} from '../../database/repositories/llm-model.repository';

@Injectable()
export class DatabaseModelStrategy implements ModelSelectionStrategy {
  readonly priority = 1; // Highest priority - check DB first

  constructor(private readonly models: LlmModelRepository) {}

  canSelect(_useCase: string): boolean {
    return true; // Always try database first
  }

  async selectModel(useCase: string): Promise<string | null> {
    const normalizedUseCase = this.normalizeUseCase(useCase);
    const model = await this.models.findDefaultForUseCase(normalizedUseCase);
    return model?.name || null;
  }

  private normalizeUseCase(useCase: string): ModelUseCase {
    switch (useCase) {
      case 'execution':
      case 'distillation':
      case 'summarization':
      case 'session':
        return useCase;
      default:
        return 'execution';
    }
  }
}
