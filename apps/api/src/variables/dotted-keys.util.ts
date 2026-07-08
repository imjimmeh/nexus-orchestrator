export function expandDottedKeys(
  flat: Record<string, unknown>,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [dottedKey, value] of Object.entries(flat)) {
    const segments = dottedKey.split('.');
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const next = cursor[segment];
      if (!next || typeof next !== 'object') {
        cursor[segment] = {};
      }
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]] = value;
  }
  return root;
}
