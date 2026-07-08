import {
  isRecord,
  type OutputContractType,
  type OutputContractTypeSchema,
} from '@nexus/core';
import type { OutputContractTypeMismatchResult as OutputContractTypeMismatch } from './workflow-output-contract.types';

const ALLOWED_OUTPUT_CONTRACT_TYPES: OutputContractType[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
];

export function isOutputContractType(
  value: unknown,
): value is OutputContractType {
  return (
    typeof value === 'string' &&
    ALLOWED_OUTPUT_CONTRACT_TYPES.includes(value as OutputContractType)
  );
}

export function isOutputContractTypeSchema(
  value: unknown,
): value is OutputContractTypeSchema {
  if (isOutputContractType(value)) {
    return true;
  }

  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !('type' in value) ||
    !isOutputContractType(value.type)
  ) {
    return false;
  }

  const schema = value as { type: OutputContractType } & Record<
    string,
    unknown
  >;

  switch (schema.type) {
    case 'array':
      return (
        schema.items === undefined || isOutputContractTypeSchema(schema.items)
      );
    case 'object':
      return (
        schema.properties === undefined ||
        (typeof schema.properties === 'object' &&
          schema.properties !== null &&
          !Array.isArray(schema.properties) &&
          Object.values(schema.properties).every((entry) =>
            isOutputContractTypeSchema(entry),
          ))
      );
    default:
      return true;
  }
}

export function describeRuntimeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function isValidScalarValue(value: unknown, type: OutputContractType): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isRecord(value);
    default:
      return false;
  }
}

export function findOutputContractTypeMismatch(
  value: unknown,
  schema: OutputContractTypeSchema,
  path: string,
): OutputContractTypeMismatch | undefined {
  if (isOutputContractType(schema)) {
    if (!isValidScalarValue(value, schema)) {
      return {
        field: path,
        expected: schema,
        actual: describeRuntimeType(value),
      };
    }
    return undefined;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return {
        field: path,
        expected: describeExpectedType(schema),
        actual: describeRuntimeType(value),
      };
    }

    if (schema.items === undefined) {
      return undefined;
    }

    for (let index = 0; index < value.length; index += 1) {
      const mismatch = findOutputContractTypeMismatch(
        value[index],
        schema.items,
        `${path}[${index}]`,
      );
      if (mismatch) {
        return mismatch;
      }
    }

    return undefined;
  }

  if (schema.type === 'object') {
    if (!isRecord(value)) {
      return {
        field: path,
        expected: describeExpectedType(schema),
        actual: describeRuntimeType(value),
      };
    }

    if (schema.properties === undefined) {
      return undefined;
    }

    for (const [key, propertySchema] of Object.entries(schema.properties)) {
      const mismatch = findOutputContractTypeMismatch(
        value[key],
        propertySchema,
        `${path}.${key}`,
      );
      if (mismatch) {
        return mismatch;
      }
    }

    return undefined;
  }

  return undefined;
}

export function matchesOutputContractType(
  value: unknown,
  schema: OutputContractTypeSchema,
): boolean {
  return findOutputContractTypeMismatch(value, schema, '') === undefined;
}

export function describeExpectedType(schema: OutputContractTypeSchema): string {
  if (isOutputContractType(schema)) {
    return schema;
  }

  if (schema.type === 'array') {
    if (schema.items === undefined) {
      return 'array';
    }
    return `array<${describeExpectedType(schema.items)}>`;
  }

  const properties = schema.properties ?? {};
  const entries = Object.entries(properties)
    .map(([key, entry]) => `${key}: ${describeExpectedType(entry)}`)
    .join(', ');
  return `object { ${entries} }`;
}
