/**
 * Shared types for `PostmortemSettingsResolver` (work item
 * 71cdcd7b-daff-489d-b681-44d239765c99, milestone 1).
 *
 * The resolver's exported interface lives here so it conforms
 * to the project's `no-restricted-syntax` lint rule, which keeps
 * exported types in dedicated `*.types.ts` files. Downstream
 * consumers (the postmortem listener after milestone 4 wires it
 * in; future listeners / controllers that need the same shape)
 * can import `ResolvedPostmortemSettings` from this module
 * without taking a dependency on the resolver implementation.
 */
export interface ResolvedPostmortemSettings {
  enabled: boolean;
  delaySeconds: number;
}
