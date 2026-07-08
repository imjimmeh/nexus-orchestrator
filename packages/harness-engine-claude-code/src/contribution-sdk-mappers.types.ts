/**
 * Pre-resolved SDK query-option fragments derived from an author contributions
 * bundle. `mcpServers` / `envPatch` are always present (empty objects for an
 * empty bundle, so spreading them is a no-op); `optionalOptions` carries only
 * the `hooks` / `settings` keys that are actually authored, so spreading it
 * leaves an empty bundle's options byte-identical to the no-contribution path.
 */
export interface ContributionQueryFragments {
  /** Extra MCP servers to merge alongside the kernel server (empty when none). */
  mcpServers: Record<string, unknown>;
  /** Additive env patch from authored settings (empty object when none). */
  envPatch: Record<string, string>;
  /** Spreadable SDK option keys (`hooks` / `settings`) present only when authored. */
  optionalOptions: Record<string, unknown>;
}
