import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SecretStore } from '../../../security/database/entities/secret-store.entity';

function resolveSeedConfig(): {
  shouldSeedFromEnv: boolean;
  providerName: string;
  secretName: string;
  secretKeyName: string;
} {
  const providerName = process.env.E2E_PROVIDER_NAME || 'chutes.ai';
  return {
    shouldSeedFromEnv: process.env.SEED_LLM_SECRET_FROM_ENV === 'true',
    providerName,
    secretName:
      process.env.E2E_PROVIDER_SECRET_NAME || `${providerName}-seed-secret`,
    secretKeyName: process.env.E2E_PROVIDER_SECRET_KEY || 'OPENAI_API_KEY',
  };
}

function getProviderApiKey(): string {
  return (
    process.env.E2E_PROVIDER_API_KEY ||
    process.env.E2E_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  );
}

function deriveVaultKey(): Buffer {
  const source =
    process.env.SECRET_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'nexus-dev-secret-encryption-key';
  return createHash('sha256').update(source).digest();
}

function encryptSecretPayload(plainText: string): string {
  const iv = randomBytes(12);
  const key = deriveVaultKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, 'utf-8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

@Injectable()
export class LlmSecretSeedService {
  private readonly logger = new Logger(LlmSecretSeedService.name);

  constructor(
    @InjectRepository(SecretStore)
    private readonly repository: Repository<SecretStore>,
  ) {}

  async seed(): Promise<string | null> {
    const { shouldSeedFromEnv, providerName, secretName, secretKeyName } =
      resolveSeedConfig();

    if (!shouldSeedFromEnv) {
      return null;
    }

    const apiKey = getProviderApiKey();
    if (!apiKey) {
      this.logger.warn(
        'SEED_LLM_SECRET_FROM_ENV=true but no provider API key env var was found. Skipping secret seed.',
      );
      return null;
    }

    const desiredPlainObject: Record<string, string> = {
      [secretKeyName]: apiKey,
    };
    const desiredPlainText = JSON.stringify(desiredPlainObject);
    const metadata = {
      source: 'database-seed',
      provider: providerName,
      keyName: secretKeyName,
    };

    const existing = await this.repository.findOne({
      where: { name: secretName, owner_type: 'global' },
    });
    if (existing) {
      existing.encrypted_value = encryptSecretPayload(desiredPlainText);
      existing.metadata = metadata;
      const updated = await this.repository.save(existing);
      this.logger.log(`Updated LLM secret: ${secretName}`);
      return updated.id;
    }

    const created = await this.repository.save(
      this.repository.create({
        name: secretName,
        encrypted_value: encryptSecretPayload(desiredPlainText),
        metadata,
      }),
    );
    this.logger.log(`Created LLM secret: ${secretName}`);
    return created.id;
  }
}

export async function seedLlmSecret(
  dataSource: DataSource,
): Promise<string | null> {
  const service = new LlmSecretSeedService(
    dataSource.getRepository(SecretStore),
  );
  return service.seed();
}
