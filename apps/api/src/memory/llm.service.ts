import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiConfigurationService } from '../ai-config/ai-configuration.service';

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(private readonly aiConfig: AiConfigurationService) {}

  async summarizeNode(
    content: string,
    context: string,
    targetPercentage: number,
  ): Promise<string> {
    const model = await this.aiConfig.getModelForUseCase('summarization');
    const providerEnv = await this.aiConfig.buildProviderEnvByModel(model);
    const apiKey = providerEnv.OPENAI_API_KEY;
    const baseURL = providerEnv.OPENAI_BASE_URL;

    if (!apiKey) {
      this.logger.error(
        `OPENAI_API_KEY is not configured for summarization model ${model}`,
      );
      return content; // Return original if no API key
    }

    const openai = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: `You are a conversation summarizer. Summarize the following conversation node concisely while preserving all key information, decisions, and context.
Provide a concise summary (target: ${targetPercentage.toString()}% of original length).`,
          },
          {
            role: 'user',
            content: `Original content:
${content}

Context from surrounding nodes:
${context}`,
          },
        ],
        max_tokens: 500,
      });

      return response.choices[0].message.content || content;
    } catch (e) {
      const err = e as Error;
      this.logger.error(`LLM summarization failed: ${err.message}`);
      return content;
    }
  }

  async executePrompt(
    systemPrompt: string,
    userPrompt: string,
    maxTokens = 1000,
  ): Promise<string> {
    const model = await this.aiConfig.getModelForUseCase('summarization');
    const providerEnv = await this.aiConfig.buildProviderEnvByModel(model);
    const apiKey = providerEnv.OPENAI_API_KEY;
    const baseURL = providerEnv.OPENAI_BASE_URL;

    if (!apiKey) {
      this.logger.error(
        `OPENAI_API_KEY is not configured for use case summarization model ${model}`,
      );
      throw new Error(
        `OPENAI_API_KEY is not configured for summarization model ${model}`,
      );
    }

    const openai = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        max_tokens: maxTokens,
      });

      return response.choices[0].message.content || '';
    } catch (e) {
      const err = e as Error;
      this.logger.error(`LLM executePrompt failed: ${err.message}`);
      throw err;
    }
  }
}
