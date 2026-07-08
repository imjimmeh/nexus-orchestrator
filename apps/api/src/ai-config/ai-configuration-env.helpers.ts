/**
 * Utility helpers for resolving API keys and base URLs from provider environment
 * variables, used by provider config resolution and embedding config.
 */

export function resolveProviderApiKey(params: {
  provider: string;
  providerEnv: Record<string, string>;
  apiKeyField?: string;
}): string {
  const fieldFromConfig = params.apiKeyField;
  if (fieldFromConfig) {
    const configuredValue =
      params.providerEnv[fieldFromConfig] || process.env[fieldFromConfig];
    if (typeof configuredValue === 'string' && configuredValue.length > 0) {
      return configuredValue;
    }
  }

  const providerToken = params.provider
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, '_');

  const providerScopedKey = `${providerToken}_API_KEY`;
  const providerScopedValue =
    params.providerEnv[providerScopedKey] || process.env[providerScopedKey];
  if (
    typeof providerScopedValue === 'string' &&
    providerScopedValue.length > 0
  ) {
    return providerScopedValue;
  }

  const candidates = Object.entries(params.providerEnv).filter(
    ([key, value]) =>
      typeof value === 'string' &&
      value.length > 0 &&
      /(API_KEY|TOKEN)$/i.test(key),
  );

  const providerMatched = candidates.find(([key]) =>
    key
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]/g, '_')
      .includes(providerToken),
  );
  if (providerMatched) {
    return providerMatched[1];
  }

  if (candidates.length === 1) {
    return candidates[0][1];
  }

  return '';
}

export function resolveProviderBaseUrl(params: {
  providerEnv: Record<string, string>;
  baseUrlField?: string;
}): string | undefined {
  if (params.baseUrlField) {
    const configured =
      params.providerEnv[params.baseUrlField] ||
      process.env[params.baseUrlField];
    if (typeof configured === 'string' && configured.length > 0) {
      return configured;
    }
  }

  const baseUrlCandidates = Object.entries(params.providerEnv).filter(
    ([key, value]) =>
      typeof value === 'string' &&
      value.length > 0 &&
      /(BASE_URL|ENDPOINT)$/i.test(key),
  );

  if (baseUrlCandidates.length === 1) {
    return baseUrlCandidates[0][1];
  }

  return undefined;
}
