export function normalizeNullableString(
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

export function normalizeStringArray(
  values: string[] | undefined,
): string[] | null {
  if (!values) {
    return null;
  }

  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return normalized.length > 0 ? normalized : null;
}

export function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!headers) {
    return null;
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();

    if (normalizedKey.length === 0 || normalizedValue.length === 0) {
      continue;
    }

    normalized[normalizedKey] = normalizedValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function normalizeEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!env) {
    return null;
  }

  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();

    if (normalizedKey.length === 0 || normalizedValue.length === 0) {
      continue;
    }

    normalized[normalizedKey] = normalizedValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function assignDirectValues<TTarget extends object>(
  target: Partial<TTarget>,
  values: Partial<TTarget>,
): void {
  for (const [key, value] of Object.entries(values) as Array<
    [keyof TTarget, TTarget[keyof TTarget] | undefined]
  >) {
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

export function assignIfDefined<
  TTarget extends object,
  TKey extends keyof TTarget,
>(target: Partial<TTarget>, key: TKey, value: TTarget[TKey] | undefined): void {
  if (value !== undefined) {
    target[key] = value;
  }
}
