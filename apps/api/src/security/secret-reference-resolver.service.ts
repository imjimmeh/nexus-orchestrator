import { BadRequestException, Injectable } from '@nestjs/common';
import { SecretCrudService } from './services/secret-crud.service';

type SecretPurpose = 'auth' | 'headers' | 'env';

interface SecretReferencedServer {
  auth_secret_id?: unknown;
  auth_token?: unknown;
  headers_secret_id?: unknown;
  headers?: unknown;
  env_secret_id?: unknown;
  env?: unknown;
}

interface ResolveStringOptions {
  secretId?: string | null;
  plaintext?: string | null;
  purpose: SecretPurpose;
  serverName: string;
  allowEmptySecret?: boolean;
}

interface ResolveMapOptions {
  secretId?: string | null;
  plaintext?: Record<string, string> | null;
  purpose: SecretPurpose;
  serverName: string;
}

@Injectable()
export class SecretReferenceResolver {
  constructor(private readonly secretCrud: SecretCrudService) {}

  async assertSecretExists(
    secretId: string | null | undefined,
    purpose: SecretPurpose,
  ): Promise<void> {
    if (!secretId) {
      return;
    }

    const secret = await this.secretCrud.findByIdRaw(secretId);
    if (!secret) {
      throw new BadRequestException(
        `${purpose}_secret_id does not reference an existing secret (${secretId})`,
      );
    }
  }

  async resolveString(options: ResolveStringOptions): Promise<string | null> {
    if (!options.secretId) {
      return options.plaintext ?? null;
    }

    const rawSecret = await this.requireSecret(options);
    return this.parseSecretString(rawSecret.decryptedValue, options);
  }

  async resolveMap(
    options: ResolveMapOptions,
  ): Promise<Record<string, string> | null> {
    if (!options.secretId) {
      return options.plaintext ?? null;
    }

    const rawSecret = await this.requireSecret(options);
    return this.parseSecretMap(rawSecret.decryptedValue, options);
  }

  redactServer<T extends SecretReferencedServer>(server: T): T {
    return {
      ...server,
      ...(server.auth_secret_id ? { auth_token: null } : {}),
      ...(server.headers_secret_id ? { headers: null } : {}),
      ...(server.env_secret_id ? { env: null } : {}),
    };
  }

  private async requireSecret(options: {
    secretId?: string | null;
    purpose: SecretPurpose;
    serverName: string;
  }): Promise<{ id: string; decryptedValue: string }> {
    if (!options.secretId) {
      throw new BadRequestException(
        `${options.purpose}_secret_id is required for ${options.serverName}`,
      );
    }

    const secret = await this.secretCrud.findByIdRaw(options.secretId);
    if (!secret) {
      throw new BadRequestException(
        `${options.purpose}_secret_id does not reference an existing secret (${options.secretId})`,
      );
    }

    return secret;
  }

  private parseSecretString(
    decryptedValue: string,
    options: ResolveStringOptions,
  ): string {
    const parsed = this.parseSecretJson(decryptedValue, options);
    const candidate = this.selectStringValue(parsed, options.purpose);

    if (candidate === null) {
      throw new BadRequestException(
        `${options.purpose}_secret_id for ${options.serverName} must resolve to a string value`,
      );
    }
    if (!options.allowEmptySecret && candidate.length === 0) {
      throw new BadRequestException(
        `${options.purpose}_secret_id for ${options.serverName} resolved to an empty string`,
      );
    }

    return candidate;
  }

  private parseSecretMap(
    decryptedValue: string,
    options: ResolveMapOptions,
  ): Record<string, string> {
    const parsed = this.parseSecretJson(decryptedValue, options);
    if (!this.isPlainObject(parsed)) {
      throw new BadRequestException(
        `${options.purpose}_secret_id for ${options.serverName} must resolve to a JSON object`,
      );
    }

    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        throw new BadRequestException(
          `${options.purpose}_secret_id for ${options.serverName} contains a non-string value at ${key}`,
        );
      }
      resolved[key] = value;
    }

    return resolved;
  }

  private parseSecretJson(
    decryptedValue: string,
    options: { purpose: SecretPurpose; serverName: string },
  ): unknown {
    try {
      return JSON.parse(decryptedValue) as unknown;
    } catch {
      throw new BadRequestException(
        `${options.purpose}_secret_id for ${options.serverName} must contain valid JSON`,
      );
    }
  }

  private selectStringValue(
    parsed: unknown,
    purpose: SecretPurpose,
  ): string | null {
    if (typeof parsed === 'string') {
      return parsed;
    }
    if (!this.isPlainObject(parsed)) {
      return null;
    }

    const keyCandidates = [
      purpose,
      `${purpose}_token`,
      'auth_token',
      'token',
      'value',
      'secret',
    ];
    for (const key of keyCandidates) {
      const candidate = parsed[key];
      if (typeof candidate === 'string') {
        return candidate;
      }
    }

    const values = Object.values(parsed).filter(
      (value): value is string => typeof value === 'string',
    );
    return values.length === 1 ? values[0] : null;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
