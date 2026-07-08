import type { ScopedVariableValueType } from '@nexus/core';

export function coerceVariableValue(
  value: unknown,
  type: ScopedVariableValueType,
): unknown {
  switch (type) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      return value === 'true' || value === true;
    case 'string':
      return typeof value === 'string' ? value : String(value);
    case 'json':
    default:
      return value;
  }
}
