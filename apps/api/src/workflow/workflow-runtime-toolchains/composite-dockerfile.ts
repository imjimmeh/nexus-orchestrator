import type { RuntimeToolchainConfig } from '@nexus/core';

const APT_CACHE = '/var/cache/apt/archives';
const MISE_CACHE = '/root/.cache/mise';

/**
 * Renders a composite Dockerfile from a resolved toolchain config.
 * SECURITY: performs no validation or escaping of tool/version/aptPackages
 * values — callers MUST run toolchain-validation.ts's validateRuntimeToolchainConfig
 * first. Values are interpolated unescaped into shell RUN commands.
 */
export function generateCompositeDockerfile(params: {
  baseImageRef: string;
  config: RuntimeToolchainConfig;
}): string {
  const lines: string[] = [
    '# syntax=docker/dockerfile:1.7',
    `FROM ${params.baseImageRef}`,
  ];

  const apt = [...(params.config.aptPackages ?? [])].sort();
  if (apt.length > 0) {
    lines.push(
      `RUN --mount=type=cache,target=${APT_CACHE} \\`,
      `    apt-get update && apt-get install -y --no-install-recommends ${apt.join(' ')}`,
    );
  }

  const tools = [...params.config.toolchains]
    .map((t) => `${t.tool}@${t.version}`)
    .sort()
    .join(' ');
  if (tools.length > 0) {
    lines.push(
      `RUN --mount=type=cache,target=${MISE_CACHE} \\`,
      `    mise use -g ${tools} && mise reshim`,
    );
  }

  return lines.join('\n') + '\n';
}
