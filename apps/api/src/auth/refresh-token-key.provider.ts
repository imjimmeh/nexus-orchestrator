import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Injection token bound to the resolved `REFRESH_TOKEN_HMAC_KEY` value by the
 * `AuthModule` provider registration. Consumers should inject the token to
 * receive the raw secret without depending on `ConfigService`.
 */
export const REFRESH_TOKEN_HMAC_KEY = Symbol('REFRESH_TOKEN_HMAC_KEY');

/**
 * Source label for the resolved key: `'env'` when the operator supplied the
 * key explicitly, or the fallback label (`'derived-from-jwt-secret'`) when
 * the schema derived it from `JWT_SECRET`. Exposed primarily for logging and
 * diagnostics so deployment misconfigurations are easy to spot.
 */
export const REFRESH_TOKEN_HMAC_KEY_SOURCE = Symbol(
  'REFRESH_TOKEN_HMAC_KEY_SOURCE',
);

/**
 * Thin NestJS provider that surfaces the resolved HMAC key (and its source
 * label) from `ConfigService` so callers can stay free of direct
 * configuration coupling.
 *
 * The provider is registered in `AuthModule` and bound to
 * {@link REFRESH_TOKEN_HMAC_KEY} / {@link REFRESH_TOKEN_HMAC_KEY_SOURCE}
 * injection tokens so consumers can request just the value they need:
 *
 * ```ts
 * constructor(
 *   @Inject(REFRESH_TOKEN_HMAC_KEY) private readonly hmacKey: string,
 * ) {}
 * ```
 */
@Injectable()
export class RefreshTokenHmacKeyProvider {
  constructor(private readonly configService: ConfigService) {}

  resolveHmacKey(): string {
    const value = this.configService.get<string>('REFRESH_TOKEN_HMAC_KEY');
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        'REFRESH_TOKEN_HMAC_KEY is missing from the validated environment',
      );
    }
    return value;
  }

  resolveSource(): string {
    const value = this.configService.get<string>(
      'REFRESH_TOKEN_HMAC_KEY_SOURCE',
    );
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        'REFRESH_TOKEN_HMAC_KEY_SOURCE is missing from the validated environment',
      );
    }
    return value;
  }
}
