import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretCrudService } from '../../../security/services/secret-crud.service';
import type { ResolvedSmtpSettings } from './email-config.types';

const DEFAULT_SMTP_PORT = 587;
const DEFAULT_PUBLIC_APP_URL = 'http://localhost:3120';

/** JSON keys checked (in priority order) when a decrypted SMTP secret is a JSON object. */
const SECRET_PASSWORD_KEYS = ['password', 'value', 'smtp_password'] as const;

interface ResolvedAuth {
  user: string;
  pass: string;
}

/**
 * Resolves SMTP connection settings for the invitation-email sender from
 * config/env, preferring the encrypted `secret_store` for the SMTP
 * password (via {@link SecretCrudService.findByIdRaw}) over the plaintext
 * `SMTP_PASSWORD` env fallback. Also builds the accept-invite link used in
 * outbound invitation emails.
 *
 * The resolved password is never logged; only the secret id (not
 * sensitive on its own) may appear in warning messages.
 */
@Injectable()
export class EmailConfigService {
  private readonly logger = new Logger(EmailConfigService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly secretCrud: SecretCrudService,
  ) {}

  /** Returns `null` when the minimum SMTP settings (host + from) are absent. */
  async resolveSmtpSettings(): Promise<ResolvedSmtpSettings | null> {
    const host = this.nonEmpty(this.config.get<string>('SMTP_HOST'));
    const from = this.nonEmpty(this.config.get<string>('SMTP_FROM'));
    if (!host || !from) {
      return null;
    }

    const port = this.resolvePort();
    const secure = this.config.get<boolean>('SMTP_SECURE') === true;
    const user = this.nonEmpty(this.config.get<string>('SMTP_USER'));
    const pass = await this.resolvePassword();
    const auth = this.resolveAuth(user, pass);

    return {
      host,
      port,
      secure,
      from,
      ...(auth ? { auth } : {}),
    };
  }

  async isConfigured(): Promise<boolean> {
    return (await this.resolveSmtpSettings()) !== null;
  }

  /** `${PUBLIC_APP_URL trimmed}/accept-invite?token=${encodeURIComponent(rawToken)}`. */
  buildAcceptInviteLink(rawToken: string): string {
    const configuredOrigin = this.nonEmpty(
      this.config.get<string>('PUBLIC_APP_URL'),
    );
    const origin = (configuredOrigin ?? DEFAULT_PUBLIC_APP_URL).replace(
      /\/+$/,
      '',
    );
    return `${origin}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  }

  private resolvePort(): number {
    const portRaw = this.config.get<number>('SMTP_PORT');
    return typeof portRaw === 'number' && Number.isFinite(portRaw)
      ? portRaw
      : DEFAULT_SMTP_PORT;
  }

  /** Secret-store id (`SMTP_PASSWORD_SECRET_ID`) preferred; falls back to env `SMTP_PASSWORD`. */
  private async resolvePassword(): Promise<string | undefined> {
    const secretId = this.nonEmpty(
      this.config.get<string>('SMTP_PASSWORD_SECRET_ID'),
    );
    if (secretId) {
      const resolved = await this.resolvePasswordFromSecretStore(secretId);
      if (resolved) {
        return resolved;
      }
    }
    return this.nonEmpty(this.config.get<string>('SMTP_PASSWORD'));
  }

  private async resolvePasswordFromSecretStore(
    secretId: string,
  ): Promise<string | undefined> {
    try {
      const secret = await this.secretCrud.findByIdRaw(secretId);
      if (!secret) {
        this.logger.warn(
          `SMTP password secret ${secretId} was not found; falling back to SMTP_PASSWORD env`,
        );
        return undefined;
      }
      const extracted = this.extractPasswordString(secret.decryptedValue);
      if (!extracted) {
        this.logger.warn(
          `SMTP password secret ${secretId} did not resolve to a usable value; falling back to SMTP_PASSWORD env`,
        );
      }
      return extracted;
    } catch {
      // Deliberately omit the thrown error's message: SecretCrudService's
      // decrypt-failure path can surface underlying detail that may embed
      // sensitive material. Only the (non-sensitive) secret id is logged.
      this.logger.warn(
        `Failed to resolve SMTP password secret ${secretId}; falling back to SMTP_PASSWORD env`,
      );
      return undefined;
    }
  }

  /**
   * Tolerant string extraction: the decrypted value may be a raw string or
   * JSON (`"value"`, `{ "password": "..." }`, `{ "value": "..." }`, or a
   * single-string-valued object). Never logs the candidate value.
   */
  private extractPasswordString(decryptedValue: string): string | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decryptedValue) as unknown;
    } catch {
      return this.nonEmpty(decryptedValue);
    }

    if (typeof parsed === 'string') {
      return this.nonEmpty(parsed);
    }
    if (!this.isPlainObject(parsed)) {
      return undefined;
    }

    for (const key of SECRET_PASSWORD_KEYS) {
      const candidate = parsed[key];
      if (typeof candidate === 'string') {
        return this.nonEmpty(candidate);
      }
    }

    const stringValues = Object.values(parsed).filter(
      (value): value is string => typeof value === 'string',
    );
    return stringValues.length === 1
      ? this.nonEmpty(stringValues[0])
      : undefined;
  }

  /**
   * Auth is only set when both a user and a resolved password are present.
   * A lone `SMTP_USER` (no resolvable password) or a lone password (no
   * `SMTP_USER`) is logged and treated as unauthenticated rather than sent
   * with an empty/mismatched credential. Neither being set is the expected
   * open-relay case and is not warned about.
   */
  private resolveAuth(
    user: string | undefined,
    pass: string | undefined,
  ): ResolvedAuth | undefined {
    if (user && pass) {
      return { user, pass };
    }
    if (user && !pass) {
      this.logger.warn(
        'SMTP_USER is set but no password could be resolved; sending unauthenticated',
      );
      return undefined;
    }
    if (!user && pass) {
      this.logger.warn(
        'An SMTP password resolved but SMTP_USER is unset; sending unauthenticated',
      );
      return undefined;
    }
    return undefined;
  }

  private nonEmpty(value: string | null | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
