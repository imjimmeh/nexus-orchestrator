import type { RuntimeToolchainConfig } from '@nexus/core';
import { validateRuntimeToolchainConfig } from '../workflow-runtime-toolchains/toolchain-validation';

interface RawStepRuntimeToolchainInputs {
  toolchains?: unknown;
  apt_packages?: unknown;
  caches?: unknown;
  disable_caches?: unknown;
}

const RUNTIME_TOOLCHAIN_INPUT_KEYS = [
  'toolchains',
  'apt_packages',
  'caches',
  'disable_caches',
] as const;

/**
 * Lifts the optional `steps[].inputs.{toolchains, apt_packages, caches,
 * disable_caches}` workflow-YAML keys into a {@link RuntimeToolchainConfig},
 * validating the result via {@link validateRuntimeToolchainConfig} so an
 * invalid step-level toolchain request fails fast.
 *
 * Returns `undefined` when the step inputs carry none of the runtime
 * toolchain keys, so callers (the {@link ToolchainResolverService}
 * precedence chain) can treat "no step override" as "fall through to the
 * next layer" rather than an explicit empty toolchain set.
 *
 * This is the single shared parser for the step-input layer: both the
 * author-time workflow validator and the provision-time container
 * integration import it, so the two never drift on field mapping.
 */
export function parseStepRuntimeToolchainConfig(
  stepInputs: Record<string, unknown> | undefined,
): RuntimeToolchainConfig | undefined {
  if (!stepInputs) return undefined;

  const raw = stepInputs as RawStepRuntimeToolchainInputs;
  const hasRuntimeToolchainKeys = RUNTIME_TOOLCHAIN_INPUT_KEYS.some(
    (key) => raw[key] !== undefined,
  );
  if (!hasRuntimeToolchainKeys) return undefined;

  const config: RuntimeToolchainConfig = {
    toolchains: Array.isArray(raw.toolchains)
      ? (raw.toolchains as RuntimeToolchainConfig['toolchains'])
      : [],
    ...(raw.apt_packages !== undefined
      ? { aptPackages: raw.apt_packages as string[] }
      : {}),
    ...(raw.caches !== undefined
      ? { caches: raw.caches as RuntimeToolchainConfig['caches'] }
      : {}),
    ...(raw.disable_caches !== undefined
      ? { disableCaches: raw.disable_caches as string[] }
      : {}),
  };

  validateRuntimeToolchainConfig(config);
  return config;
}

/**
 * Parses the neutral `runtime_toolchains` run-input field carried on a
 * workflow run's trigger record (`stateVariables.trigger.runtime_toolchains`)
 * into a {@link RuntimeToolchainConfig}. This is layer 3 of the 5-layer
 * precedence chain (step > agent profile > run input > repo-detected > base
 * default) — the field is neutral and provider-agnostic; upstream launch
 * callers populate it from whatever project-level config they own, but this
 * parser has no knowledge of where the value originated.
 *
 * Returns `undefined` when the trigger carries no `runtime_toolchains` field
 * or it isn't shaped like a {@link RuntimeToolchainConfig} (missing a
 * `toolchains` array), so callers can treat "no run-input override" as "fall
 * through to the next layer" rather than an explicit empty toolchain set.
 */
export function parseRunInputRuntimeToolchainConfig(
  trigger: Record<string, unknown> | undefined,
): RuntimeToolchainConfig | undefined {
  const raw = trigger?.runtime_toolchains;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  const config = raw as RuntimeToolchainConfig;
  if (!Array.isArray(config.toolchains)) return undefined;

  validateRuntimeToolchainConfig(config);
  return config;
}
