/**
 * Pure helpers for `GitOpsCredentialsResolver`.
 *
 * Kept in a dedicated `*.helpers.ts` file so the resolver
 * implementation stays focused on NestJS wiring (DI,
 * telemetry, cache, error handling) and the ESM-free
 * classification/coercion logic is easy to unit-test in
 * isolation.
 */
import type {
  ResolvedHttpsCredentials,
  ResolvedSecretKind,
} from './gitops-credentials-resolver.service.types';
import { CredentialResolutionError } from './gitops-credentials-resolver.service';

/**
 * Inspect the resolved secret value and classify it as
 * `'https'`, `'ssh'`, or `null` when the shape is
 * unrecognised. See the JSDoc on
 * `GitOpsCredentialsResolver` for the full mapping table.
 */
export function inferSecretKind(value: unknown): ResolvedSecretKind {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    // Plain string credentials are treated as token-only HTTPS
    // blobs. We do NOT auto-detect OpenSSH `-----BEGIN ...-----`
    // blobs here because operators frequently use PEM-wrapped
    // values that also have a token-like surface; the
    // discriminator field (`kind`/`type`) on an object is the
    // safe escape hatch for that.
    return 'https';
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  // Discriminator fields take precedence — operators can
  // opt into a specific shape regardless of which keys are
  // present.
  const discriminator = readDiscriminator(record);
  if (discriminator !== undefined) {
    return discriminatorToKind(discriminator);
  }

  return inferKindFromShape(record);
}

/**
 * Map a normalised discriminator alias to the canonical
 * kind union, returning `null` when the alias does not
 * match a known variant.
 */
function discriminatorToKind(discriminator: string): ResolvedSecretKind {
  if (discriminator === 'ssh' || discriminator === 'ssh_private_key') {
    return 'ssh';
  }
  if (
    discriminator === 'https' ||
    discriminator === 'https_token' ||
    discriminator === 'token'
  ) {
    return 'https';
  }
  return null;
}

/**
 * Inspect the field shape when no discriminator was
 * declared. Returns `'ssh'` for a record carrying a
 * private-key field, `'https'` for a record carrying a
 * username + password/token pair, and `null` otherwise.
 */
function inferKindFromShape(
  record: Record<string, unknown>,
): ResolvedSecretKind {
  if (
    typeof record['sshPrivateKey'] === 'string' ||
    typeof record['privateKey'] === 'string'
  ) {
    return 'ssh';
  }

  if (
    typeof record['username'] === 'string' &&
    (typeof record['password'] === 'string' ||
      typeof record['token'] === 'string')
  ) {
    return 'https';
  }

  return null;
}

/**
 * Best-effort coercion of an `unknown` shape into a
 * `{ username, password }` pair suitable for the
 * git-credential helper contract. Returns `null` when the
 * shape is not coercible.
 */
export function toHttpsCredentials(
  value: unknown,
): ResolvedHttpsCredentials | null {
  if (typeof value === 'string') {
    return { username: '', password: value };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const username =
    typeof record['username'] === 'string' ? record['username'] : '';
  const passwordValue =
    typeof record['password'] === 'string'
      ? record['password']
      : typeof record['token'] === 'string'
        ? record['token']
        : null;

  if (passwordValue === null) {
    return null;
  }

  return { username, password: passwordValue };
}

/**
 * Best-effort coercion of an `unknown` shape into a private
 * key string. Returns `null` when the shape is not coercible.
 */
export function toSshPrivateKey(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['sshPrivateKey'] === 'string') {
    return record['sshPrivateKey'];
  }
  if (typeof record['privateKey'] === 'string') {
    return record['privateKey'];
  }
  return null;
}

/**
 * Read the `kind` or `type` discriminator field, normalising
 * the value to a short alias. Returns `undefined` when no
 * discriminator is present.
 */
function readDiscriminator(
  record: Record<string, unknown>,
): string | undefined {
  const candidates = [record['kind'], record['type']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate.toLowerCase();
    }
  }
  return undefined;
}

/**
 * Decode the secret-store JSON payload. The vault returns
 * the original JSON-encoded string the operator stored;
 * objects are parsed once and cached as-is. Strings are
 * returned verbatim. Anything that fails to parse is
 * returned as the raw string — the caller is responsible
 * for rejecting un-parseable shapes via `inferSecretKind`.
 */
export function decodeSecretValue(decryptedValue: string): unknown {
  try {
    return JSON.parse(decryptedValue) as unknown;
  } catch {
    return decryptedValue;
  }
}

/**
 * Extract the host portion of a repository URL. Returns
 * `null` when the URL is not parseable. The result is
 * already lower-cased so callers can do a direct `includes`
 * comparison against the anonymous-allowed list.
 */
export function extractHost(repoUrl: string): string | null {
  if (repoUrl.startsWith('ssh://') || /^[^/]+@[^/:]+:/.test(repoUrl)) {
    // The `git@host:path` shorthand and `ssh://user@host/path`
    // both carry `host` after the `@` separator.
    const at = repoUrl.indexOf('@');
    if (at === -1) {
      return null;
    }
    const tail = repoUrl.slice(at + 1);
    const colon = tail.indexOf(':');
    const slash = tail.indexOf('/');
    const end =
      colon === -1
        ? slash === -1
          ? tail.length
          : slash
        : slash === -1
          ? colon
          : Math.min(colon, slash);
    const host = end === -1 ? tail : tail.slice(0, end);
    return host.length > 0 ? host.toLowerCase() : null;
  }

  try {
    const url = new URL(repoUrl);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Produce a sanitised reason label from an unexpected error
 * without leaking the credential value. We deliberately
 * drop the message body — only the error's class name
 * (`Error`, `TypeError`, ...) and a length-bounded marker
 * are surfaced.
 */
export function sanitiseThrownError(error: unknown): string {
  if (error instanceof CredentialResolutionError) {
    return error.reason;
  }
  if (error instanceof Error) {
    return error.name || 'unexpected_error';
  }
  return 'unexpected_error';
}

/**
 * Detect an SSH-style URL. Both the `ssh://` protocol and
 * the `git@host:path` shorthand are recognised. Returns
 * `false` for plain `https://` URLs and unparseable input.
 */
export function isSshUrl(url: string): boolean {
  if (url.startsWith('ssh://')) {
    return true;
  }
  // The shorthand `git@host:path` cannot be parsed by the
  // `URL` constructor reliably, so we detect it with a
  // direct regex.
  return /^[^/]+@[^/:]+:/.test(url);
}
