/**
 * Shared filter utility for include/exclude pattern matching.
 * Used by both MCP and ACP filter modules.
 */

/**
 * Normalizes an optional pattern array by trimming whitespace and removing empty entries.
 */
export function normalizePatterns(patterns?: string[] | null): string[] {
  if (!patterns) {
    return [];
  }
  return patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

/**
 * Converts a glob-like pattern to a case-insensitive RegExp.
 * Supports '*' as a wildcard matching any characters.
 */
export function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
}

/**
 * Checks if a value matches any pattern in the list.
 * Returns false if patterns array is empty.
 */
export function matchesAnyPattern(value: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => patternToRegex(pattern).test(value));
}

/**
 * Generic filter function that applies include/exclude patterns to a list of items.
 *
 * @param items - Array of items to filter
 * @param getName - Function to extract the name property from each item
 * @param includePatterns - Patterns to include (if empty, all items are candidates for inclusion)
 * @param excludePatterns - Patterns to exclude (takes precedence over include)
 * @returns Filtered array of items
 */
export function filterByPatterns<T>(
  items: T[],
  getName: (item: T) => string,
  includePatterns?: string[] | null,
  excludePatterns?: string[] | null,
): T[] {
  const include = normalizePatterns(includePatterns);
  const exclude = normalizePatterns(excludePatterns);

  return items.filter((item) => {
    const name = getName(item);

    // Check if included (if no include patterns, item is included by default)
    const included = include.length === 0 || matchesAnyPattern(name, include);
    if (!included) {
      return false;
    }

    // Check if excluded (exclude takes precedence)
    const excluded = matchesAnyPattern(name, exclude);
    return !excluded;
  });
}
