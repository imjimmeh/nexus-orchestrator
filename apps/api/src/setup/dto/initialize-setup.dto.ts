import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  initializeSetupSchema,
  type InitializeSetupRequest,
} from '@nexus/core';

export class InitializeSetupDto implements InitializeSetupRequest {
  static get schema() {
    return initializeSetupSchema;
  }

  @ApiProperty({
    description: 'Provider name to create or update',
    example: 'chutes.ai',
  })
  providerName!: string;

  @ApiPropertyOptional({
    description: 'Provider API base URL',
    example: 'https://llm.chutes.ai/v1/',
  })
  providerBaseUrl?: string;

  @ApiPropertyOptional({
    description: 'Secret record name',
    example: 'chutes.ai-primary',
  })
  secretName?: string;

  @ApiPropertyOptional({
    description: 'Key name inside secret JSON payload',
    example: 'OPENAI_API_KEY',
  })
  secretKeyName?: string;

  @ApiProperty({
    description: 'Secret value for provider authentication',
    example: 'sk-***',
  })
  secretValue!: string;

  @ApiProperty({
    description: 'Model name to create or update as default',
    example: 'MiniMaxAI/MiniMax-M2.5-TEE',
  })
  modelName!: string;

  @ApiPropertyOptional({
    description: 'Token limit for model',
    example: 128000,
    default: 128000,
  })
  tokenLimit?: number;
}
