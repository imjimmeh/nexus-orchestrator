import { extractAgentProfileFromTriggerState } from './step-support.helpers';

const DIRECT_TEMPLATE_PATH_REGEX = /^\s*\{\{\s*([\w.-]+)\s*\}\}\s*$/;

export function resolveAgentProfileFromInputs(params: {
  resolvedInputs: Record<string, unknown>;
  legacyAgentProfile: unknown;
  stateVariables?: Record<string, unknown>;
}): string | undefined {
  if (typeof params.resolvedInputs.agent_profile === 'string') {
    const value = params.resolvedInputs.agent_profile.trim();
    if (value.length > 0) {
      return value;
    }
  }

  if (typeof params.legacyAgentProfile === 'string') {
    const value = params.legacyAgentProfile.trim();
    if (value.length > 0) {
      return value;
    }
  }

  return extractAgentProfileFromTriggerState(params.stateVariables);
}

export function resolveTemplatedInputs(
  inputs: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): Record<string, unknown> {
  if (!inputs) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    const resolved = resolveTemplatedInputValue(
      value,
      variables,
      substituteTemplate,
    );
    if (resolved !== undefined) {
      result[key] = resolved;
    }
  }

  return result;
}

function resolveTemplatedInputValue(
  value: unknown,
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): unknown {
  if (typeof value === 'string') {
    const directTemplatePath = extractDirectTemplatePath(value);
    if (directTemplatePath) {
      return getNestedTemplateValue(variables, directTemplatePath);
    }

    return substituteTemplate(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      resolveTemplatedInputValue(entry, variables, substituteTemplate),
    );
  }

  if (value && typeof value === 'object') {
    const mapping = asMappingTransform(value);
    if (mapping) {
      return resolveMappingTransform(mapping, variables, substituteTemplate);
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, nestedValue]) => [
          key,
          resolveTemplatedInputValue(
            nestedValue,
            variables,
            substituteTemplate,
          ),
        ],
      ),
    );
  }

  return value;
}

function asMappingTransform(value: unknown):
  | {
      source: unknown;
      mapping: Record<string, unknown>;
      defaultValue?: unknown;
      hasDefault: boolean;
    }
  | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (!('source' in record) || !('mapping' in record)) {
    return undefined;
  }

  if (!record.mapping || typeof record.mapping !== 'object') {
    return undefined;
  }

  return {
    source: record.source,
    mapping: record.mapping as Record<string, unknown>,
    defaultValue: record.default,
    hasDefault: Object.hasOwn(record, 'default'),
  };
}

function resolveMappingTransform(
  transform: {
    source: unknown;
    mapping: Record<string, unknown>;
    defaultValue?: unknown;
    hasDefault: boolean;
  },
  variables: Record<string, unknown>,
  substituteTemplate: (value: string) => string,
): unknown {
  const resolvedSource = resolveTemplatedInputValue(
    transform.source,
    variables,
    substituteTemplate,
  );
  const sourceKey = String(resolvedSource);

  if (Object.hasOwn(transform.mapping, sourceKey)) {
    return resolveTemplatedInputValue(
      transform.mapping[sourceKey],
      variables,
      substituteTemplate,
    );
  }

  if (transform.hasDefault) {
    return resolveTemplatedInputValue(
      transform.defaultValue,
      variables,
      substituteTemplate,
    );
  }

  throw new Error(
    `Mapping error: value '${sourceKey}' not found in mapping and no default provided`,
  );
}

function extractDirectTemplatePath(template: string): string | undefined {
  const match = template.match(DIRECT_TEMPLATE_PATH_REGEX);
  if (!match) {
    return undefined;
  }

  return match[1];
}

function getNestedTemplateValue(
  variables: Record<string, unknown>,
  path: string,
): unknown {
  const segments = path.split('.');
  let current: unknown = variables;

  for (const segment of segments) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}
