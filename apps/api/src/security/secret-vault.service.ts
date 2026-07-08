import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

@Injectable()
export class SecretVaultService {
  private readonly logger = new Logger(SecretVaultService.name);

  constructor(private readonly configService: ConfigService) {}

  encrypt(plainText: string): string {
    const key = this.getKey();
    const iv = randomBytes(12);
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

  decrypt(encryptedPayload: string): string {
    const parsed = JSON.parse(encryptedPayload) as {
      iv: string;
      authTag: string;
      data: string;
    };

    const key = this.getKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(parsed.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf-8');
  }

  private getKey(): Buffer {
    const source =
      this.configService.get<string>('SECRET_ENCRYPTION_KEY') ||
      this.configService.get<string>('JWT_SECRET') ||
      'nexus-dev-secret-encryption-key';

    if (!this.configService.get<string>('SECRET_ENCRYPTION_KEY')) {
      this.logger.warn(
        'SECRET_ENCRYPTION_KEY is not configured, using fallback derivation key',
      );
    }

    return createHash('sha256').update(source).digest();
  }
}
