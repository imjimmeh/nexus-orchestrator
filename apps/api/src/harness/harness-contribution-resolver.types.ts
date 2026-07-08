import type {
  HarnessContributions,
  HarnessId,
  HarnessCapabilities,
} from '@nexus/core';
import type { HarnessAssetRepository } from './assets/harness-asset.repository';
import type {
  McpServerRefRepository,
  McpSecretResolver,
} from './harness-mcp-ref-resolution';

export type ContributionOrigin = 'step' | 'profile' | 'skill' | 'platform';

export interface ContributionSource {
  origin: ContributionOrigin;
  /** Any subset of the bundle; missing arrays/objects are treated as empty. */
  contributions: Partial<HarnessContributions>;
  /**
   * Asset ids referencing `harness_assets` rows of kind `plugin`.
   * Hydrated asynchronously after the synchronous merge by `hydrateAssetReferences`.
   */
  pluginRefs?: string[];
  /**
   * Asset ids referencing `harness_assets` rows of kind `extension`.
   * Hydrated asynchronously after the synchronous merge by `hydrateAssetReferences`.
   */
  extensionRefs?: string[];
}

export interface ContributionLedger {
  emitBestEffort: (payload: unknown) => unknown;
}

export interface ResolveContributionsParams {
  harnessId: HarnessId;
  capabilities: HarnessCapabilities;
  /** Highest precedence first (step, then profile, then skill, then platform). */
  sources: ContributionSource[];
  ledger?: ContributionLedger;
  /**
   * When provided, asset references (`pluginRefs` / `extensionRefs`) collected
   * from the sources are hydrated into full typed assets via the repository.
   * Omitting this leaves asset-ref resolution to the caller.
   */
  assetRepository?: Pick<HarnessAssetRepository, 'findByIds'>;
  /**
   * When provided, `mcpServerRefs` declared in resolved plugins are looked up
   * via this repository and attached as `resolvedMcpServers` on the output
   * bundle. Unknown IDs are dropped with a `harness_contribution_dropped`
   * diagnostic. Omitting this skips MCP ref resolution.
   */
  mcpServerRepository?: McpServerRefRepository;
  /**
   * Secret resolver used to expand `env_secret_id`/`headers_secret_id` into
   * their plaintext maps before the descriptor is emitted to the engine.
   * Required when `mcpServerRepository` is provided; omitting it leaves
   * secret-bearing fields unresolved.
   */
  mcpSecretResolver?: McpSecretResolver;
}
