import { z } from 'zod';
import {
  HarnessContributionsInputSchema,
  type HarnessContributions,
} from '@nexus/core';
import type { ContributionSource } from './harness-contribution-resolver.types';
import type { GatherInput } from './gather-contribution-sources.types';

const AssetRefsSchema = z.object({
  pluginRefs: z.array(z.string().min(1)).optional(),
  extensionRefs: z.array(z.string().min(1)).optional(),
});

function validate(raw: unknown): Partial<HarnessContributions> | undefined {
  if (raw == null) return undefined;
  const result = HarnessContributionsInputSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}

function parseAssetRefs(raw: unknown): {
  pluginRefs?: string[];
  extensionRefs?: string[];
} {
  if (raw == null) return {};
  const result = AssetRefsSchema.safeParse(raw);
  return result.success ? result.data : {};
}

/**
 * Build the precedence-ordered (step → profile → skill) contribution sources for
 * the resolver. Each candidate is validated against the author-input schema;
 * invalid blocks are dropped (never throw) so one bad authored entry cannot fail
 * a run. Skills contribute via `metadata.contributions`.
 *
 * Also extracts `pluginRefs` / `extensionRefs` (asset ids) from each surface so
 * the caller can hydrate them via the asset repository after the synchronous merge.
 */
export function gatherContributionSources(
  input: GatherInput,
): ContributionSource[] {
  const sources: ContributionSource[] = [];

  const step = validate(input.stepInput);
  if (step) {
    const refs = parseAssetRefs(input.stepInput);
    sources.push({ origin: 'step', contributions: step, ...refs });
  }

  const profile = validate(input.profile);
  if (profile) {
    const refs = parseAssetRefs(input.profile);
    sources.push({ origin: 'profile', contributions: profile, ...refs });
  }

  for (const skill of input.skills ?? []) {
    const raw = skill.metadata?.['contributions'];
    const contributions = validate(raw);
    if (contributions) {
      const refs = parseAssetRefs(raw);
      sources.push({ origin: 'skill', contributions, ...refs });
    }
  }

  return sources;
}
