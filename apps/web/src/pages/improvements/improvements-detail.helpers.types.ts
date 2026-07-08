/**
 * A single flattened row of an `agent_profile_change` proposal's patch,
 * suitable for direct rendering in a field-diff table. `from` is omitted
 * entirely (rather than set to an empty string) when no pre-apply snapshot
 * is available yet — the caller renders that as dimmed/absent.
 */
export interface ProfilePatchEntry {
  field: string;
  from?: string;
  to: string;
}
