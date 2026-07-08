const CANONICAL_API_KEY_FIELD = 'API_KEY';

export function deriveApiKeyField(providerId?: string | null): string {
  if (!providerId || providerId === 'custom') {
    return CANONICAL_API_KEY_FIELD;
  }
  const token = providerId.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_');
  return `${token}_${CANONICAL_API_KEY_FIELD}`;
}

export function buildSecretValueMap(params: {
  apiKeyField: string;
  apiKey?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const value: Record<string, string> = { ...(params.extra ?? {}) };
  if (typeof params.apiKey === 'string' && params.apiKey.length > 0) {
    value[params.apiKeyField] = params.apiKey;
  }
  return value;
}

export function headersToRecord(
  headers?: Array<{ name: string; value: string }>,
): Record<string, string> | undefined {
  if (!headers || headers.length === 0) {
    return undefined;
  }
  return Object.fromEntries(headers.map((h) => [h.name, h.value]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function applyCredentialRuntimeEnv(params: {
  runtimeEnv?: Record<string, unknown>;
  apiKeyField: string;
  headerRecord?: Record<string, string>;
}): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(params.runtimeEnv ?? {}),
    api_key_field: params.apiKeyField,
  };

  if (params.headerRecord) {
    const existingConfig = asRecord(next.providerConfig);
    const existingHeaders = asRecord(existingConfig.headers) as Record<
      string,
      string
    >;
    next.providerConfig = {
      ...existingConfig,
      headers: { ...existingHeaders, ...params.headerRecord },
    };
  }

  return next;
}
