import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OAuthLoginService } from './oauth-login.service';
import { OAuthLoginWorker } from './oauth-login.worker';
import { PiAiOAuthProviderResolver } from './pi-ai-oauth-provider.resolver';
import { OAuthLoginSessionStore } from './oauth-login-session.store';
import { OAuthLoginSessionBusService } from './oauth-login-session.bus.service';
import { OAuthInstrumentation } from './oauth-instrumentation';
import { RedisModule } from '../redis/redis.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DatabaseModule } from '../database/database.module';
import { OAUTH_LOGIN_SESSION_JOB_QUEUE } from '@nexus/core/schemas/oauth';
import {
  OAUTH_PROVIDER_RESOLVER,
  OAUTH_LOGIN_SESSION_STORE,
  OAUTH_LOGIN_SESSION_BUS,
} from './oauth-login.types';

/**
 * Engine-only module exposing the unified {@link OAuthLoginService}. Callers
 * (provider page, harness credential bindings) import this and supply their own
 * credential sink — no storage concern leaks into the engine.
 *
 * This module has a hard dependency on Redis: the durable half of every
 * in-flight OAuth login session is persisted via {@link OAuthLoginSessionStore}
 * under the `oauth:session:{sessionId}` namespace, and the cross-pod
 * manual-code delivery is routed through {@link OAuthLoginSessionBusService}
 * on the `oauth:session:{sessionId}:code` channel. Redis is therefore required
 * at startup; this is recorded as a consequence of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`.
 *
 * The module also depends on `ObservabilityModule` for the
 * `nexus_oauth_login_orphaned_total` Prometheus counter that the
 * orphan-recovery path (work item
 * `b19758d8-2448-472a-b2db-3856d3f6b4bc`, follow-up §3 of
 * `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`)
 * increments through {@link OAuthInstrumentation}. `OAuthInstrumentation`
 * is registered as a single provider here — no separate
 * `OAuthInstrumentationModule` — mirroring the single-provider choice
 * made for `BackendInstrumentation` (see the helper-extraction ADR
 * §Decision for the rationale).
 *
 * The per-session `provider.login` Promise is driven by
 * {@link OAuthLoginWorker}, a BullMQ `WorkerHost` that subscribes to
 * the {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} queue (`"oauth-login"`).
 * The queue is registered through `BullModule.registerQueue({ name })`
 * here; the global BullMQ connection is supplied by
 * {@link RedisModule}'s `BullModule.forRootAsync` registration, so no
 * separate `BullModule.forRoot` call is needed in this module. The
 * worker is exported so the smoke spec can resolve it from the DI
 * container without reaching into private provider internals — the
 * export mirrors the single-provider convention used for
 * `OAuthInstrumentation` above (worker state is per-pod and isolated
 * by session id, so the leak surface is the same as for the
 * instrumentation helper).
 */
@Module({
  imports: [
    RedisModule,
    ObservabilityModule,
    DatabaseModule,
    BullModule.registerQueue({ name: OAUTH_LOGIN_SESSION_JOB_QUEUE }),
  ],
  providers: [
    OAuthLoginService,
    OAuthLoginWorker,
    OAuthLoginSessionStore,
    OAuthLoginSessionBusService,
    OAuthInstrumentation,
    { provide: OAUTH_PROVIDER_RESOLVER, useClass: PiAiOAuthProviderResolver },
    {
      provide: OAUTH_LOGIN_SESSION_STORE,
      useExisting: OAuthLoginSessionStore,
    },
    {
      provide: OAUTH_LOGIN_SESSION_BUS,
      useExisting: OAuthLoginSessionBusService,
    },
  ],
  exports: [
    OAuthLoginService,
    OAuthLoginWorker,
    OAUTH_PROVIDER_RESOLVER,
    OAUTH_LOGIN_SESSION_STORE,
    OAUTH_LOGIN_SESSION_BUS,
    OAuthInstrumentation,
  ],
})
export class OAuthModule {}
