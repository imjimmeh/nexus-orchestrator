import type { HarnessSettingsContribution } from "@nexus/core";
import type { HarnessEngine } from "./harness-engine.js";
import type { HarnessSessionContext } from "./session-context.js";
import {
  isHookMaterializer,
  isExtensionMaterializer,
  isSettingsMaterializer,
} from "./contribution-materializers.js";

function hasSettings(s: HarnessSettingsContribution): boolean {
  return (
    (s.env !== undefined && Object.keys(s.env).length > 0) ||
    s.permissions !== undefined ||
    s.outputStyle !== undefined
  );
}

/**
 * Materialize the session's contributions through whichever engine materializers
 * the engine implements AND its capabilities admit. A capability/implementation
 * mismatch is a no-op, never a crash. Runs once at kernel bootstrap, before the
 * first prompt.
 */
export async function applyContributions(
  engine: HarnessEngine,
  ctx: HarnessSessionContext,
): Promise<void> {
  const caps = engine.capabilities;
  const c = ctx.contributions;

  if (caps.supportsHooks && c.hooks.length > 0 && isHookMaterializer(engine)) {
    await engine.materializeHooks(c.hooks, ctx);
  }
  if (
    caps.supportsExtensions &&
    c.extensions.length > 0 &&
    isExtensionMaterializer(engine)
  ) {
    await engine.materializeExtensions(c.extensions, ctx);
  }
  if (
    caps.supportsSettings &&
    hasSettings(c.settings) &&
    isSettingsMaterializer(engine)
  ) {
    await engine.materializeSettings(c.settings, ctx);
  }
}
