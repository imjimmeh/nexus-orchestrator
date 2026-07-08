import { Injectable } from '@nestjs/common';
import { SecretCrudService } from '../security/services/secret-crud.service';

const WEBHOOK_SECRET_ENV = 'GITHUB_WEBHOOK_SECRET';

/**
 * Resolves the HMAC verification secret for an inbound PR webhook. Prefers the
 * deployment-wide `GITHUB_WEBHOOK_SECRET` env var; falls back to a per-scope
 * secret id when one is wired (Phase 5 enriches the per-scope path). Returns
 * null when no secret is configured so the controller can answer 401, not 500.
 * The secret value is never logged.
 */
@Injectable()
export class WebhookSecretResolver {
  constructor(private readonly secretCrud: SecretCrudService) {}

  async resolveSecret(scopeSecretId: string | null): Promise<string | null> {
    const fromEnv = process.env[WEBHOOK_SECRET_ENV];
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv;
    }
    if (scopeSecretId) {
      const secret = await this.secretCrud.findByIdRaw(scopeSecretId);
      if (secret) {
        return secret.decryptedValue;
      }
    }
    return null;
  }
}
