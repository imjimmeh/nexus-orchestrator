import type { IContainerConfig } from '@nexus/core';
import type { ContainerAgentRequest } from '../docker/container-http-client.service';
import type { ExecutionKind } from './execution-lifecycle.contracts';

/**
 * DI token for the orchestrator IP resolver used by
 * `ExecutionDispatchService`. Bound to
 * `SystemSettingOrchestratorIpResolver` by default (which dispatches to
 * one of four concrete strategy resolvers based on the
 * `execution_dispatch_ip_resolver_override` system setting).
 */
export const ORCHESTRATOR_IP_RESOLVER = Symbol('ORCHESTRATOR_IP_RESOLVER');

/**
 * Per-strategy DI tokens used by
 * {@link SystemSettingOrchestratorIpResolver} to inject each concrete
 * strategy implementation independently. Keeping them token-bound (rather
 * than injecting by concrete class) avoids the multi-provider same-type
 * ambiguity at the constructor site and makes the strategy map trivial to
 * reconfigure via `useClass`/`useFactory` in `ExecutionLifecycleModule`.
 *
 * Each token is bound to the corresponding concrete resolver class:
 * - `DEFAULT_ORCHESTRATOR_IP_RESOLVER` → `DefaultOrchestratorIpResolver`
 * - `DNS_ROUND_ROBIN_IP_RESOLVER` → `DnsRoundRobinIpResolver`
 * - `SERVICE_MESH_HEADER_IP_RESOLVER` → `ServiceMeshHeaderIpResolver`
 * - `CUSTOM_HTTP_ENDPOINT_IP_RESOLVER` → `CustomHttpEndpointIpResolver`
 */
export const DEFAULT_ORCHESTRATOR_IP_RESOLVER = Symbol(
  'DEFAULT_ORCHESTRATOR_IP_RESOLVER',
);
export const DNS_ROUND_ROBIN_IP_RESOLVER = Symbol(
  'DNS_ROUND_ROBIN_IP_RESOLVER',
);
export const SERVICE_MESH_HEADER_IP_RESOLVER = Symbol(
  'SERVICE_MESH_HEADER_IP_RESOLVER',
);
export const CUSTOM_HTTP_ENDPOINT_IP_RESOLVER = Symbol(
  'CUSTOM_HTTP_ENDPOINT_IP_RESOLVER',
);

/**
 * Typed error thrown by `IOrchestratorIpResolver` implementations when
 * the configured strategy cannot produce a usable IP for the orchestrator
 * URL. Wrapped by `SystemSettingOrchestratorIpResolver` into an
 * `execution.dispatch.ip_resolution_failed` telemetry event before the
 * error propagates to `ExecutionDispatchService.resolveIpFromOrchestrator`
 * (which converts it into the polling-loop `undefined` retry sentinel,
 * preserving the pre-Milestone-3 retry semantics).
 *
 * The `cause` chain is preserved so the underlying DNS / HTTP / parse
 * failure is visible in the logs without callers needing to drill in.
 */
export class OrchestratorIpResolutionError extends Error {
  readonly strategy: OrchestratorIpResolverStrategy;
  readonly orchestratorUrl: string;

  constructor(
    strategy: OrchestratorIpResolverStrategy,
    orchestratorUrl: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'OrchestratorIpResolutionError';
    this.strategy = strategy;
    this.orchestratorUrl = orchestratorUrl;
  }
}

/**
 * Strategy identifiers for the orchestrator IP resolution pipeline.
 *
 * - `default`: parse the orchestrator URL via the WHATWG URL parser and
 *   return its hostname. Stateless; used when no override is configured.
 * - `dns_round_robin`: perform an A/AAAA lookup against the orchestrator
 *   host and return a shuffled entry (with a sticky cache).
 * - `service_mesh_header`: trust an `X-Orchestrator-Ip` response header
 *   from a sentinel `/healthz` call (used in Istio/Linkerd deployments).
 * - `custom_http_endpoint`: GET a configured endpoint and parse the JSON
 *   `{ "ip": "..." }` response.
 *
 * Selected via the `execution_dispatch_ip_resolver_override` system
 * setting. The token-bound `DefaultOrchestratorIpResolver` implements the
 * `default` strategy; richer strategies land in subsequent milestones.
 */
export type OrchestratorIpResolverStrategy =
  | 'default'
  | 'dns_round_robin'
  | 'service_mesh_header'
  | 'custom_http_endpoint';

/**
 * Telemetry payload emitted alongside the
 * `execution.dispatch.ip_resolved` domain event. Captures the strategy
 * actually used (which may differ from the configured override when the
 * resolver falls back to a safer default), the resolved IP, and a
 * sanitized orchestrator URL with any user-info / query string stripped
 * so logs do not leak secrets.
 */
export interface IOrchestratorIpResolutionContext {
  strategy: OrchestratorIpResolverStrategy;
  orchestratorUrl: string;
  resolvedIp: string;
  resolvedAt: string;
}

/**
 * Contract for resolving an orchestrator URL into a concrete IP
 * address used by outbound requests from the execution lifecycle.
 *
 * Implementations may delegate to the WHATWG URL parser, DNS lookup, a
 * service-mesh sidecar, or an external endpoint depending on the
 * configured strategy. Resolvers must return a non-empty IP literal (or
 * `hostname` for the default strategy); call sites are responsible for
 * translating resolution failures into retryable dispatch errors.
 */
export interface IOrchestratorIpResolver {
  resolve(orchestratorUrl: string): Promise<string>;
}

export interface AgentConfig {
  provider: string;
  model: string;
  auth: ContainerAgentRequest['auth'];
  apiKey?: string;
  baseUrl?: string;
  providerConfig?: ContainerAgentRequest['providerConfig'];
  systemPrompt: string;
  initialPrompt?: string;
  temperature?: number;
  thinkingLevel?: ContainerAgentRequest['thinkingLevel'];
}

export interface DispatchParams {
  kind: ExecutionKind;
  agentConfig: AgentConfig;
  containerConfig: IContainerConfig;
  /**
   * Numeric tier stored in the execution record (e.g. 1 = heavy, 2 = light).
   * Kept separate from `containerConfig.tier` (which is the `ContainerTier`
   * string enum used by the Docker orchestrator).
   */
  containerTier: number;
  /** Present when dispatching a chat session execution. */
  chatSessionId?: string | null;
  /** Present when dispatching under a workflow run. */
  workflowRunId?: string | null;
  /** Parent execution id (e.g. for subagent dispatches). */
  parentExecutionId?: string | null;
  /**
   * Domain-specific context identifier stored on the execution record.
   * For workflow_step executions this is the jobId, enabling completion
   * listeners to route execution.completed/failed events back to the
   * correct workflow job without a separate lookup table.
   */
  contextId?: string | null;
  /** Optional workspace path to bind-mount into the container. */
  workspacePath?: string;
  /**
   * Name of the agent profile to use for thinking-level resolution.
   * When provided, the dispatch service looks up the profile's
   * `thinking_level` as one policy layer.
   */
  agentProfileName?: string;
  /**
   * Harness capability hints surfaced from the harness registry entry.
   * Used during thinking-level resolution to determine whether the
   * target harness supports configurable thinking levels.
   */
  capabilities?: {
    supportsThinkingLevels?: boolean;
  };
}

export interface DispatchResult {
  executionId: string;
}
