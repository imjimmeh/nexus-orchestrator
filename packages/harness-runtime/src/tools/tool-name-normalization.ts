/**
 * Tool-name normalization for `permission_callback` engines.
 *
 * Governance knows tools by their canonical names — the dotted
 * `kanban.project_state`, the lowercase runner-native `read`. Engines that
 * surface tools through an external layer receive those tools back under a
 * sanitized name: the Claude Agent SDK's in-process MCP server cannot express
 * dots in a tool name, so `kanban.project_state` is presented (and called back)
 * as `kanban_project_state`, and the SDK emits its built-in tools in PascalCase
 * (`Read`) while the runner-native registry is lowercase (`read`).
 *
 * Both transforms collapse to the same shape: lowercase, with every run of
 * non-alphanumeric characters reduced to a single underscore. Matching on that
 * shape lets the engine recover the canonical name before consulting governance,
 * regardless of which casing/separator convention the surfacing layer chose.
 */
export function normalizeToolNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Builds a resolver mapping an engine-surfaced tool name back to its canonical
 * governance name.
 *
 * `canonicalNames` are the authoritative names governance understands — pass the
 * names from the mounted tool catalog ({@link CanonicalToolSpec.name}). Each is
 * indexed by its {@link normalizeToolNameKey}. The resolver normalizes an
 * incoming name the same way and returns the matching canonical name; when no
 * catalog tool matches — e.g. an SDK-native built-in like `Read`, which is not
 * mounted — it falls back to the normalized key, which equals the lowercase
 * runner-native convention governance expects.
 */
export function buildCanonicalToolNameResolver(
  canonicalNames: string[],
): (toolName: string) => string {
  const canonicalByKey = new Map<string, string>();
  for (const name of canonicalNames) {
    const key = normalizeToolNameKey(name);
    // Catalog names are unique per normalized key in practice; first wins.
    if (!canonicalByKey.has(key)) {
      canonicalByKey.set(key, name);
    }
  }

  return (toolName: string): string => {
    const key = normalizeToolNameKey(toolName);
    return canonicalByKey.get(key) ?? key;
  };
}
