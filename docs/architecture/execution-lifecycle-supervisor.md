# Execution Lifecycle Supervisor

**Status:** Current — last updated 2026-06-22
**Domain:** Execution / Reliability

> **Canonical reference:** The detailed, up-to-date description of the execution dispatch pipeline lives in
> `apps/api/src/execution-lifecycle/execution-dispatch.service.ts` (dispatch loop) and
> `apps/api/src/execution-lifecycle/system-setting-orchestrator-ip-resolver.ts` (IP resolution override).  
> This document provides an architectural overview and cross-cutting context.

---

## 1. Overview

The Execution Lifecycle Supervisor owns the lifecycle of `Execution` rows: creation, container
provisioning, agent kickoff, freeze/resume during shutdown/startup, supervisor sweep, and reap. The
supervisor is decomposed into several cooperating services:

| Layer                                    | Location                                            | Responsibility                                                            |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| **`ExecutionDispatchService`**           | `execution-dispatch.service.ts`                     | Create row, emit `execution.created`, provision container, kick off agent |
| **`ExecutionSupervisorService`**         | `execution-supervisor.service.ts`                   | Periodic sweep, state reconciliation, frozen-row skip, reap idle runs     |
| **`ShutdownFreezeCoordinator`**          | `shutdown-freeze.coordinator.ts`                    | `SIGTERM` → freeze in-flight containers via `CONTAINER_FREEZER` token     |
| **`StartupResumeCoordinator`**           | `startup-resume.coordinator.ts`                     | On boot, resume paused executions via `CONTAINER_RESUMER` token           |
| **`ExecutionEventPublisher`**            | `execution-event.publisher.ts`                      | Domain-event outbox publisher (per-execution + IP resolution telemetry)   |
| **`ExecutionProjector`**                 | `execution.projector.ts`                            | Outbox → row state projector (single source of truth for transitions)     |

All cross-module hooks are wired via DI tokens (`CONTAINER_FREEZER`, `CONTAINER_RESUMER`,
`STEP_QUEUE_DRAINER`, `SESSION_REHYDRATOR`, `ORCHESTRATOR_IP_RESOLVER`) so the lifecycle module
never reaches into a concrete dependency. This page focuses on the IP resolution override added in
WI-2026-064; the dispatch / freeze / resume flows are documented in the per-service TSDoc and the
`docs/architecture/container-orchestration.md` cross-link.

---

## 2. Orchestrator IP Resolution Override (WI-2026-064)

### 2.1 The interface and DI token

`ExecutionDispatchService.resolveIpFromOrchestrator()` was historically a `protected` method that
parsed the orchestrator URL inline and returned `undefined` as a placeholder while production wiring
was deferred. WI-2026-064 promoted that hook to a typed DI token with four strategy implementations
and a system-setting-based override. The architectural contract is now:

```ts
export const ORCHESTRATOR_IP_RESOLVER = Symbol('ORCHESTRATOR_IP_RESOLVER');

export interface IOrchestratorIpResolver {
  resolve(orchestratorUrl: string): Promise<string>;
}
```

The default binding in `ExecutionLifecycleModule` is
`SystemSettingOrchestratorIpResolver` (useClass), which dispatches to one of four concrete
strategies based on the `execution_dispatch_ip_resolver_override` system setting.

### 2.2 The four strategies

| Strategy                | Implementation                          | When to use                                                                                        |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `default`               | `DefaultOrchestratorIpResolver`         | Plain HTTP/HTTPS orchestrator reachable by hostname or literal IP. No external dependencies.       |
| `dns_round_robin`       | `DnsRoundRobinIpResolver`               | Orchestrator is deployed behind a DNS round-robin pool; the dispatcher wants stickiness for warm caches and in-flight session affinity. IPv6 brackets are stripped before DNS lookup. Records are shuffled with `crypto.randomInt` and cached for 60s per host. |
| `service_mesh_header`   | `ServiceMeshHeaderIpResolver`           | Istio / Linkerd deployments where the orchestrator's `ClusterIP` is not routable across the mesh; the orchestrator advertises its mesh-allocated address via the `X-Orchestrator-Ip` response header on `GET /healthz`. |
| `custom_http_endpoint`  | `CustomHttpEndpointIpResolver`          | Custom control plane, multi-region proxy, or tenancy-aware IP allocator. The endpoint must answer `GET` with a JSON object whose `ip` field is a non-empty IPv4 / canonical full-form IPv6 literal. |

Per-strategy DI tokens (`DEFAULT_ORCHESTRATOR_IP_RESOLVER`, `DNS_ROUND_ROBIN_IP_RESOLVER`,
`SERVICE_MESH_HEADER_IP_RESOLVER`, `CUSTOM_HTTP_ENDPOINT_IP_RESOLVER`) are used so the delegating
resolver can be unit-tested by substituting one resolver at a time without the multi-provider
same-type ambiguity that NestJS raises when multiple providers share a concrete class token.

### 2.3 The setting keys

| Setting key                                     | Type    | Accepted values                                                                    | Read by                                          |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| `execution_dispatch_ip_resolver_override`       | string  | `default` \| `dns_round_robin` \| `service_mesh_header` \| `custom_http_endpoint`  | `SystemSettingOrchestratorIpResolver` (every call) |
| `execution_dispatch_ip_resolver_endpoint`       | string  | Absolute URL (e.g. `https://ip-allocator.internal/orchestrator`)                   | `CustomHttpEndpointIpResolver` (every call)      |

Both keys live in `apps/api/src/execution-lifecycle/execution-dispatch.settings.ts` and are
intentionally NOT seeded in `apps/api/src/settings/system-settings.defaults.ts` — the override is
an operator opt-in (unset = use the URL-parse default), so absence from the seeded-defaults
registry is the desired first-run behavior.

Unknown or unset values fall back to `'default'` with a warn-log (or silently, when the value is
`null`), so a stale override cannot brick the dispatch loop. The fallback preserves the
pre-Milestone-3 URL-parse behavior.

### 2.4 The delegating resolver

```ts
@Injectable()
export class SystemSettingOrchestratorIpResolver implements IOrchestratorIpResolver {
  constructor(
    settings: SystemSettingsService,
    eventPublisher: ExecutionEventPublisher,
    @Inject(DEFAULT_ORCHESTRATOR_IP_RESOLVER) defaultResolver,
    @Inject(DNS_ROUND_ROBIN_IP_RESOLVER) dnsRoundRobinResolver,
    @Inject(SERVICE_MESH_HEADER_IP_RESOLVER) serviceMeshHeaderResolver,
    @Inject(CUSTOM_HTTP_ENDPOINT_IP_RESOLVER) customHttpEndpointResolver,
  ) {}
  async resolve(orchestratorUrl: string): Promise<string> { /* ... */ }
  static readonly token = ORCHESTRATOR_IP_RESOLVER;
}
```

The delegator reads the override setting on every call (so operators can swap strategies without a
restart), validates against the known `OrchestratorIpResolverStrategy` set, dispatches via the
exhaustive strategy switch, and emits one telemetry event per resolution attempt.

### 2.5 Telemetry events

Two domain events are emitted to the outbox via `ExecutionEventPublisher`:

| Event                                              | Emitted on            | Aggregate identity                                                                |
| -------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `execution.dispatch.ip_resolved`                   | Successful resolution | `aggregateType = 'execution_dispatch'`, `aggregateId = orchestrator host`         |
| `execution.dispatch.ip_resolution_failed`          | Resolution failure    | `aggregateType = 'execution_dispatch'`, `aggregateId = orchestrator host`         |

Payload shape (both events):

```ts
{
  strategy: OrchestratorIpResolverStrategy,
  resolvedIp?: string,       // ipResolved only
  orchestratorUrl: string,   // sanitized — see §2.6
  errorMessage?: string,     // ipResolutionFailed only
}
```

The `aggregateType` is intentionally distinct from `'execution'` because IP resolution describes
the orchestrator (a shared, long-lived resource) rather than any single execution row, and
outbox consumers filtering by `aggregateType` should be able to isolate the resolution stream
cleanly from per-execution lifecycle events.

### 2.6 URL sanitization guarantee

The delegator's `sanitizeOrchestratorUrl` helper strips userinfo (basic-auth credentials), the
query string, and the fragment from the orchestrator URL before it is placed in a telemetry
payload. The path and port are preserved (so operators can still tell two orchestrators apart
by port), but:

| Input                                                          | Sanitized                                       |
| -------------------------------------------------------------- | ----------------------------------------------- |
| `https://user:pass@host:3010/path?q=1#h`                       | `https://host:3010/path`                        |
| `http://orchestrator.local:3010/`                              | `http://orchestrator.local:3010/`               |
| `not a url`                                                    | `not a url` (returned verbatim — never throws)  |

The telemetry path must never fail the dispatch loop, so malformed URLs are passed through
verbatim rather than throwing. The strategy resolver itself will surface a typed
`OrchestratorIpResolutionError` on the next resolution attempt, which the existing
`ExecutionDispatchService.resolveIpFromOrchestrator` already converts to a polling-loop retry.

### 2.7 Failure semantics

The delegator does **not** swallow underlying resolver errors — they propagate to the caller after
emitting the `ip_resolution_failed` telemetry event. This is intentional: the existing
`ExecutionDispatchService.resolveIpFromOrchestrator` already wraps the resolver call in a try/catch
that returns `undefined` on failure (so the polling loop in `resolveContainerIp` retries), and
introducing a second swallowing layer here would mask the `OrchestratorIpResolutionError.cause`
chain from logs.

When the underlying resolver throws an `OrchestratorIpResolutionError`, the failure event uses the
strategy attached to the typed error (which may differ from the override when an upstream resolver
re-threw its own typed error from a nested call). Non-typed errors use the override strategy in the
failure event payload.

---

## 3. Related Files

- `apps/api/src/execution-lifecycle/default-orchestrator-ip-resolver.ts` — `default` strategy.
- `apps/api/src/execution-lifecycle/dns-round-robin-ip-resolver.ts` — `dns_round_robin` strategy.
- `apps/api/src/execution-lifecycle/service-mesh-header-ip-resolver.ts` — `service_mesh_header` strategy.
- `apps/api/src/execution-lifecycle/custom-http-endpoint-ip-resolver.ts` — `custom_http_endpoint` strategy.
- `apps/api/src/execution-lifecycle/system-setting-orchestrator-ip-resolver.ts` — system-setting-based delegating resolver + URL sanitization helper.
- `apps/api/src/execution-lifecycle/execution-dispatch.service.types.ts` — `IOrchestratorIpResolver` interface + DI tokens + `OrchestratorIpResolutionError` + telemetry payload types.
- `apps/api/src/execution-lifecycle/execution-dispatch.settings.ts` — setting-key constants (`EXECUTION_DISPATCH_IP_RESOLVER_OVERRIDE_SETTING`, `EXECUTION_DISPATCH_IP_RESOLVER_ENDPOINT_SETTING`, `EXECUTION_DISPATCH_IP_RESOLVED_EVENT`, `EXECUTION_DISPATCH_IP_RESOLUTION_FAILED_EVENT`) + `isKnownResolverStrategy` type guard.
- `apps/api/src/execution-lifecycle/execution-event.publisher.ts` — `ipResolved` / `ipResolutionFailed` event publishers.
- `apps/api/src/execution-lifecycle/execution-lifecycle.module.ts` — DI wiring of all four per-strategy tokens + the delegating `ORCHESTRATOR_IP_RESOLVER` token.
- `apps/api/src/execution-lifecycle/execution-dispatch.service.ts` — consumer of `ORCHESTRATOR_IP_RESOLVER`; reads orchestrator URL from `process.env.ORCHESTRATOR_URL` and converts resolver failures into polling-loop retries.
- `apps/api/src/docker/container-http-client.service.ts` — provides `httpGetRaw(url, options)` for the `service_mesh_header` and `custom_http_endpoint` strategies.
- `docs/work-items/WI-2026-064-execution-ip-resolution-override.md` — work item that defined this feature and the four-milestone plan.

---

## 4. Test Coverage

Each resolver implementation has a dedicated unit spec covering the contract documented above:

| File                                                                                       | Test count |
| ------------------------------------------------------------------------------------------ | ---------- |
| `apps/api/src/execution-lifecycle/default-orchestrator-ip-resolver.spec.ts`               | 6          |
| `apps/api/src/execution-lifecycle/dns-round-robin-ip-resolver.spec.ts`                     | 8          |
| `apps/api/src/execution-lifecycle/service-mesh-header-ip-resolver.spec.ts`                | 11         |
| `apps/api/src/execution-lifecycle/custom-http-endpoint-ip-resolver.spec.ts`                | 14         |
| `apps/api/src/execution-lifecycle/system-setting-orchestrator-ip-resolver.spec.ts`         | 17         |
| `apps/api/src/execution-lifecycle/execution-dispatch.service.spec.ts`                      | (existing) |

Run targeted iteration:

```bash
npm run test --workspace=apps/api -- execution-lifecycle
npm run test --workspace=apps/api -- execution-dispatch
```
