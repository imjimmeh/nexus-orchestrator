/**
 * Type surface for the memory-decay settings resolver helper
 * (`memory-decay.settings.helpers.ts`).
 */
import type { SystemSettingsService } from '../settings/system-settings.service';
import type { MemoryDecaySettingsResolver } from './memory-decay.settings.resolver';

/**
 * Dependencies required to resolve the live `MemoryDecaySettings`
 * snapshot. The `settingsResolver` slot is `@Optional()` on the
 * owning service so the helper preserves the no-resolver fallback
 * the reaper used before extraction.
 */
export interface MemoryDecaySettingsResolverDeps {
  readonly settings: SystemSettingsService;
  readonly settingsResolver?: MemoryDecaySettingsResolver | null;
}
