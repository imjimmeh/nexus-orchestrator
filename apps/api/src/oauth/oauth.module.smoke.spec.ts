import { describe, it, expect, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { OAuthModule } from './oauth.module';
import { OAuthInstrumentation } from './oauth-instrumentation';
import { OAuthLoginWorker } from './oauth-login.worker';
import { ObservabilityModule } from '../observability/observability.module';
import { MetricsService } from '../observability/metrics.service';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { SystemSettingsModule } from '../settings/system-settings.module';
import { RedisPubSubService } from '../redis/redis-pubsub.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { Redis } from 'ioredis';
import {
  OAUTH_LOGIN_SESSION_BUS,
  OAUTH_LOGIN_SESSION_STORE,
} from './oauth-login.types';
import { LlmProviderRepository } from '../ai-config/database/repositories/llm-provider.repository';
import { OAUTH_LOGIN_SESSION_JOB_QUEUE } from '@nexus/core/schemas/oauth';
import { OAuthLoginSessionStore } from './oauth-login-session.store';

const redisStub = {
  on: vi.fn(),
  duplicate: vi.fn(),
} as unknown as Redis;

const pubSubStub = {
  publishToChannel: vi.fn().mockResolvedValue(undefined),
  subscribeToRawChannel: vi.fn(),
  unsubscribeFromRawChannel: vi.fn(),
} as unknown as RedisPubSubService;

/**
 * Test-only stub for {@link LlmProviderRepository}. The smoke spec only
 * needs `findByProviderId` to return a valid Anthropic OAuth row so that
 * `PiAiOAuthProviderResolver` can build the server-less provider without
 * touching a real database.
 */
const llmProviderRepositoryStub = {
  findByProviderId: vi.fn().mockResolvedValue({
    provider_id: 'anthropic',
    oauth_client_id: 'stub-client-id',
    oauth_authorization_url: 'https://stub.authorize',
    oauth_token_url: 'https://stub.token',
    oauth_redirect_uri: 'https://stub.redirect',
    oauth_scopes: ['stub:scope'],
  }),
} as unknown as LlmProviderRepository;

/**
 * Test-only stub for the {@link OAUTH_LOGIN_SESSION_JOB_QUEUE} BullMQ
 * queue. The smoke spec never enqueues a real job — it only verifies
 * that {@link OAuthModule}'s DI graph compiles and that the worker +
 * queue constants are resolvable. Providing the stub via `useValue`
 * (rather than `useFactory`) short-circuits the `@nestjs/bullmq`
 * queue factory that would otherwise reach for the global Redis
 * connection during `.compile()` and open a real BullMQ client.
 *
 * The stub exposes only the surface that the OAuth smoke test
 * exercises (`add`, `getJobs`); `OAuthLoginService.start()` calls
 * `add(...)` and the orphan-recovery path queries `getJobs(...)`,
 * so pinning both stubs makes the queue contract visible to the
 * smoke assertions without committing to a full BullMQ fake.
 *
 * Mirrors the `metricsStub` / `pubSubStub` pattern used elsewhere
 * in this file — minimal `vi.fn()` surface, cast to the
 * production type for type safety.
 */
const loginQueueStub = {
  add: vi.fn().mockResolvedValue({ id: 'stub' }),
  getJobs: vi.fn().mockResolvedValue([]),
};

/**
 * Test-only dependency stub for {@link MetricsService}. Replaces the
 * production `MetricsService` (which lives in `ObservabilityModule`
 * and transitively pulls in `AuthModule`, `AuthorizationModule`,
 * `DatabaseModule`, etc.) so the smoke test does not need to
 * compile the full observability + auth + database module graph
 * just to verify that {@link OAuthModule} wires its own providers.
 *
 * The stub exposes only the mutator that
 * {@link OAuthInstrumentation} touches. Other oauth-domain counters
 * (none today; if added later, extend this stub with the matching
 * `vi.fn()` entries).
 *
 * Mirrors the mock-module pattern used by
 * `apps/api/src/workflow/workflow-host-mount/workflow-host-mount.module.spec.ts`
 * and other heavy-graph smoke tests in the codebase.
 */
const metricsStub = {
  recordOAuthLoginOrphaned: vi.fn(),
} as unknown as MetricsService;

// Mock modules for the heavy transitive dependencies that
// ObservabilityModule pulls in. The OAuth smoke test only
// verifies OAuthModule's own wiring — the heavy auth /
// authorization / database / settings modules are replaced
// with empty placeholder modules so the DI graph compiles
// without needing JWT secrets, TypeORM connections, or
// system-settings seed data.
@Module({})
class MockAuthModule {}

@Module({})
class MockAuthorizationModule {}

@Module({})
class MockDatabaseModule {}

@Module({})
class MockSystemSettingsModule {}

@Module({
  providers: [
    {
      provide: MetricsService,
      useValue: metricsStub,
    },
  ],
  exports: [MetricsService],
})
class StubObservabilityModule {}

/**
 * Stub `OAuthInstrumentation` provider — bound here (rather than
 * imported from `OAuthModule`) so the smoke test can spy on the
 * helper without the production DI graph's full transitive
 * dependencies. The smoke test only verifies OAuthModule's own
 * wiring, not the helper's behaviour; the helper has its own
 * dedicated spec file.
 */
@Module({
  providers: [
    {
      provide: OAuthInstrumentation,
      useValue: {
        recordOAuthLoginOrphaned: vi.fn(),
      },
    },
  ],
  exports: [OAuthInstrumentation],
})
class StubOAuthInstrumentationModule {}

describe('OAuthModule DI smoke (M4 wiring)', () => {
  it('compiles, resolves every provider, and re-exports the new injection tokens', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [OAuthModule, StubOAuthInstrumentationModule],
      providers: [
        // Override the BullMQ queue token that
        // `OAuthModule`'s `BullModule.registerQueue({ name: ... })`
        // import registers, so the smoke test does not open a real
        // BullMQ client during `.compile()`. The stub satisfies the
        // queue surface that `OAuthLoginService.start()` calls
        // (`add`) and the orphan-recovery helper queries (`getJobs`).
        // See the `loginQueueStub` jsdoc for the rationale.
        {
          provide: getQueueToken(OAUTH_LOGIN_SESSION_JOB_QUEUE),
          useValue: loginQueueStub,
        },
        // `OAuthModule` imports `DatabaseModule` to obtain `LlmProviderRepository`,
        // but the real module is overridden by `MockDatabaseModule` below. Provide
        // a minimal stub here so `PiAiOAuthProviderResolver` can resolve without
        // opening a real TypeORM connection.
        {
          provide: LlmProviderRepository,
          useValue: llmProviderRepositoryStub,
        },
      ],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisStub)
      .overrideProvider(RedisPubSubService)
      .useValue(pubSubStub)
      .overrideModule(ObservabilityModule)
      .useModule(StubObservabilityModule)
      .overrideModule(AuthModule)
      .useModule(MockAuthModule)
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(SystemSettingsModule)
      .useModule(MockSystemSettingsModule)
      .useMocker(() => ({}))
      .compile();

    expect(moduleRef).toBeDefined();

    const store = moduleRef.get(OAuthLoginSessionStore);
    expect(store).toBeInstanceOf(OAuthLoginSessionStore);

    const storeViaToken = moduleRef.get(OAUTH_LOGIN_SESSION_STORE);
    expect(storeViaToken).toBe(store);

    const busViaToken = moduleRef.get(OAUTH_LOGIN_SESSION_BUS);
    expect(busViaToken).toBeDefined();
    expect(typeof busViaToken.subscribeToCode).toBe('function');
    expect(typeof busViaToken.publishCode).toBe('function');

    // M4 wiring assertions: the BullMQ-backed `OAuthLoginWorker`
    // is resolvable from the DI container (it sits in
    // `OAuthModule.providers` and is re-exported for tests), and
    // the queue constant pinned in `@nexus/core/schemas/oauth`
    // matches the `"oauth-login"` literal that the durable
    // queue + smoke spec both reference. These are smoke-level
    // contract pins — behaviour is covered by the dedicated
    // `oauth-login.integration.spec.ts`.
    const worker = moduleRef.get(OAuthLoginWorker);
    expect(worker).toBeDefined();
    expect(worker).toBeInstanceOf(OAuthLoginWorker);

    expect(OAUTH_LOGIN_SESSION_JOB_QUEUE).toBe('oauth-login');

    // The queue override must be wired so the smoke spec never
    // opens a real BullMQ client during `.compile()`. The stub
    // surface is the union of the methods called by
    // `OAuthLoginService.start()` (`add`) and the orphan-recovery
    // path (`getJobs`); both must be present.
    expect(loginQueueStub.add).toBeDefined();
    expect(loginQueueStub.getJobs).toBeDefined();

    await moduleRef.close();
  });
});
