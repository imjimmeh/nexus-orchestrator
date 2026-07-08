import { isRecord } from '@nexus/core';

/**
 * Normalizes the "XML array" tool-call serialization artifact produced by some
 * providers when they emit array-typed tool arguments via XML `<item>` elements.
 *
 * A multi-element XML array round-trips as `{ item: [...] }` — a sole-key object
 * whose value is an array. A single-element XML array round-trips as
 * `{ item: {...} }` — the same sole-key pattern but the value is a plain object
 * rather than an array. Both forms are unwrapped: the single-object form becomes
 * a one-element array so downstream `for_each` iterators receive a consistent type.
 *
 * The unwrap rule is deliberately narrow: an object is unwrapped only when it has
 * exactly one own key, that key is `item`, and its value is an array or a plain
 * object (not a primitive or null). Multi-key objects and primitives pass through.
 */

const ARRAY_ARTIFACT_KEY = 'item';

function isArrayArtifact(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== ARRAY_ARTIFACT_KEY) return false;
  const inner = value[ARRAY_ARTIFACT_KEY];
  return Array.isArray(inner) || isRecord(inner);
}

/**
 * Recursively unwraps sole-key `{ item: array }` artifacts into bare arrays.
 * Returns a new value; the input is not mutated.
 */
export function normalizeXmlArrayArtifacts(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeXmlArrayArtifacts);
  }

  if (isRecord(value)) {
    if (isArrayArtifact(value)) {
      const inner = value[ARRAY_ARTIFACT_KEY];
      const asArray = Array.isArray(inner) ? inner : [inner];
      return normalizeXmlArrayArtifacts(asArray);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeXmlArrayArtifacts(child),
      ]),
    );
  }

  return value;
}

/**
 * Reports whether the value contains at least one `{ item: array }` artifact
 * anywhere in its structure. Used to gate telemetry so events are only emitted
 * when normalization actually changes the payload.
 */
export function containsXmlArrayArtifact(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsXmlArrayArtifact);
  }

  if (isRecord(value)) {
    if (isArrayArtifact(value)) {
      return true;
    }

    return Object.values(value).some(containsXmlArrayArtifact);
  }

  return false;
}
