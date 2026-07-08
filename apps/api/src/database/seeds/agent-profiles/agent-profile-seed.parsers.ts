import type { Logger } from '@nestjs/common';

export function parseRequiredString(
  value: unknown,
  label: string,
  logger: Logger,
): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    logger.warn(
      `Skipping invalid agent profile seed definition: ${label} must be a non-empty string.`,
    );
    return null;
  }

  return value.trim();
}

export function parseTierPreference(
  value: unknown,
  name: string,
  logger: Logger,
): 'light' | 'heavy' | null {
  if (value === 'light' || value === 'heavy') {
    return value;
  }

  logger.warn(
    `Skipping invalid agent profile seed definition ${name}: tier_preference must be light or heavy.`,
  );
  return null;
}

export function parseOptionalIsActive(
  value: unknown,
  profileName: string,
  logger: Logger,
): boolean | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    logger.warn(
      `Skipping invalid agent profile seed definition ${profileName}: is_active must be a boolean.`,
    );
    return null;
  }

  return value;
}

export function parseOptionalBoolean(
  value: unknown,
  profileName: string,
  fieldName: string,
  logger: Logger,
): boolean | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    logger.warn(
      `Skipping invalid agent profile seed definition ${profileName}: ${fieldName} must be a boolean.`,
    );
    return null;
  }
  return value;
}

export function parseOptionalModelOrProviderName(
  value: unknown,
  profileName: string,
  fieldName: string,
  logger: Logger,
): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !value.trim()) {
    logger.warn(
      `Skipping invalid agent profile seed definition ${profileName}: ${fieldName} must be a non-empty string or null.`,
    );
    return null;
  }

  return value.trim();
}

export function parseProviderSource(
  value: unknown,
  profileName: string,
  logger: Logger,
): 'global' | 'user' | 'scope' | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || !value.trim()) {
    logger.warn(
      `Skipping invalid agent profile seed definition ${profileName}: provider_source must be a non-empty string or null.`,
    );
    return null;
  }

  const trimmed = value.trim();

  if (!['global', 'user', 'scope'].includes(trimmed)) {
    logger.warn(
      `Skipping invalid agent profile seed definition ${profileName}: provider_source must be one of global, user, scope, or null.`,
    );
    return null;
  }

  return trimmed as 'global' | 'user' | 'scope';
}

export function parseOptionalStringArray(
  value: unknown,
  label: string,
  logger: Logger,
): string[] | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    logger.warn(
      `Skipping invalid agent profile seed definition: ${label} must be an array.`,
    );
    return null;
  }

  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') {
      logger.warn(
        `Skipping invalid agent profile seed definition: ${label} must contain only strings.`,
      );
      return null;
    }

    const trimmed = item.trim();
    if (!trimmed || normalized.includes(trimmed)) {
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

export function parseRequiredStringArray(
  value: unknown,
  label: string,
  logger: Logger,
): string[] | null {
  const parsed = parseOptionalStringArray(value, label, logger);
  if (!parsed) {
    logger.warn(
      `Skipping invalid agent profile seed definition: ${label} must contain at least one string.`,
    );
    return null;
  }

  return parsed;
}
