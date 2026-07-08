/**
 * Boot integration test: verifies the full NestJS DI graph compiles without errors.
 *
 * Requires live infrastructure:
 *   - Postgres at DB_HOST:DB_PORT (see apps/api/.env.test)
 *   - Redis at REDIS_HOST:REDIS_PORT (see apps/api/.env.test)
 *
 * The test.vitest.setup.ts loads .env.test before any module is evaluated,
 * satisfying ConfigModule.forRoot({ validate: validateEnv }).
 *
 * Why pool: 'forks' is still needed:
 *   Vitest's in-process ES module runner cannot resolve circular static import
 *   chains (e.g. WorkflowCoreModule → SessionModule → MemoryModule →
 *   LearningModule → WorkflowKernelModule → WorkflowCoreModule). NestJS handles
 *   these at runtime via forwardRef(), but the static import graph hangs the
 *   module runner indefinitely. The forks pool runs the test in a separate
 *   Node.js process where CommonJS require() caching tolerates circular
 *   references, allowing the import to complete and NestJS to take over.
 *
 * What this test proves:
 *   - compile() resolves without throwing "Circular dependency detected", which
 *     means all necessary forwardRef() wrappers are present in the module graph.
 *   - compile() does not hang — providers connect to real Redis/Postgres so the
 *     async factory chain completes rather than blocking on infra forever.
 *
 * Note: .init() is intentionally NOT called. That would trigger application
 * lifecycle hooks (seeding, etc.) which are out of scope for a boot gate.
 */
import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule boots', () => {
  it('resolves the full DI graph without circular-dependency errors', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.close();

    expect(moduleRef).toBeDefined();
  }, 60000);
});
