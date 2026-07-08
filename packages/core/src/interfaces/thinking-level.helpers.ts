import type { RunnerThinkingLevel } from "./runner-config.types";
import { THINKING_LEVEL_ORDER } from "../schemas/ai-config/thinking-level.schema";

export { THINKING_LEVEL_ORDER };

function indexOf(level: RunnerThinkingLevel): number {
  return THINKING_LEVEL_ORDER.indexOf(level);
}

export function parseThinkingLevel(
  value: unknown,
): RunnerThinkingLevel | undefined {
  return typeof value === "string" &&
    (THINKING_LEVEL_ORDER as readonly string[]).includes(value)
    ? (value as RunnerThinkingLevel)
    : undefined;
}

/**
 * Clamp `requested` to the nearest level in `supported` (ordinal distance,
 * ties round DOWN). `off` always returns `off`. Returns undefined when no
 * non-`off` level is supported so the caller omits the field.
 */
export function clampThinkingLevel(
  requested: RunnerThinkingLevel,
  supported: readonly RunnerThinkingLevel[],
): RunnerThinkingLevel | undefined {
  if (requested === "off") return "off";
  const candidates = [...supported]
    .filter((l) => l !== "off")
    .sort((a, b) => indexOf(a) - indexOf(b));
  if (candidates.length === 0) return undefined;
  const target = indexOf(requested);
  let best: RunnerThinkingLevel | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of candidates) {
    const distance = Math.abs(indexOf(level) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level; // strict `<` + ascending order => ties keep the lower level
    }
  }
  return best;
}

/** First-defined layer wins. */
export function resolveThinkingLevel(layers: {
  stepInput?: RunnerThinkingLevel;
  agentProfile?: RunnerThinkingLevel;
  modelDefault?: RunnerThinkingLevel;
}): RunnerThinkingLevel | undefined {
  return layers.stepInput ?? layers.agentProfile ?? layers.modelDefault;
}
