import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LlmModel } from '../../../ai-config/database/entities/llm-model.entity';

const DEFAULT_MODEL_NAME =
  process.env.E2E_MODEL_NAME || 'MiniMaxAI/MiniMax-M2.5-TEE';
const DEFAULT_PROVIDER_NAME = process.env.E2E_PROVIDER_NAME || 'chutes.ai';

export const DEFAULT_LLM_MODELS: Array<Partial<LlmModel> & { name: string }> = [
  {
    name: DEFAULT_MODEL_NAME,
    provider_name: DEFAULT_PROVIDER_NAME,
    token_limit: 128000,
    default_for_execution: true,
    default_for_distillation: true,
    default_for_summarization: true,
    default_for_session: true,
    is_active: true,
  },
];

@Injectable()
export class LlmModelSeedService {
  private readonly logger = new Logger(LlmModelSeedService.name);

  constructor(
    @InjectRepository(LlmModel)
    private readonly repository: Repository<LlmModel>,
  ) {}

  async seed(): Promise<void> {
    for (const modelData of DEFAULT_LLM_MODELS) {
      const existing = await this.repository.findOne({
        where: { name: modelData.name },
      });

      if (existing) {
        continue;
      }

      await this.repository.save(this.repository.create(modelData));
      this.logger.log(`Created LLM model: ${modelData.name}`);
    }
  }
}

export async function seedLlmModels(dataSource: DataSource): Promise<void> {
  const service = new LlmModelSeedService(dataSource.getRepository(LlmModel));
  await service.seed();
}
