import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;
const ROTATED_SECRET_BYTES = 32;

@Injectable()
export class SecretManagerService {
  private readonly logger = new Logger(SecretManagerService.name);
  private readonly rotatedSecrets = new Map<string, string>();

  constructor(private readonly configService: ConfigService) {}

  async getSecret(key: string): Promise<string> {
    const normalizedKey = this.requireSecretKey(key);
    const rotated = this.rotatedSecrets.get(normalizedKey);
    if (rotated) {
      return rotated;
    }

    const value = this.configService.get<string>(normalizedKey);
    if (!value) {
      this.logger.warn(`Secret ${normalizedKey} not found in configuration`);
      return '';
    }
    await Promise.resolve();
    return value;
  }

  async validateSecret(value: string): Promise<void> {
    if (value.trim().length < MIN_SECRET_LENGTH) {
      throw new BadRequestException(
        `Secret must be at least ${MIN_SECRET_LENGTH.toString()} characters long`,
      );
    }
    await Promise.resolve();
  }

  async rotateSecret(key: string): Promise<void> {
    const normalizedKey = this.requireSecretKey(key);
    const rotatedValue =
      randomBytes(ROTATED_SECRET_BYTES).toString('base64url');

    await this.validateSecret(rotatedValue);
    this.rotatedSecrets.set(normalizedKey, rotatedValue);

    this.logger.log(`Rotated secret for key ${normalizedKey}`);
    await Promise.resolve();
  }

  private requireSecretKey(key: string): string {
    const normalized = key.trim();
    if (normalized.length === 0) {
      throw new BadRequestException('Secret key is required');
    }

    return normalized;
  }
}
