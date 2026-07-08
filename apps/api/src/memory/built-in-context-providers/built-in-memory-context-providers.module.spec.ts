import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import {
  ChatContextRegistryEmptyError,
  ChatSessionContextService,
} from '../../session/chat-session-context.service';
import { ChatSessionRepository } from '../../chat/database/repositories/chat-session.repository';
import { ChatMessageRepository } from '../../chat/database/repositories/chat-message.repository';
import { CostGovernanceModule } from '../../cost-governance/cost-governance.module';
import { AuthorizationModule } from '../../auth/authorization/authorization.module';
import { DatabaseModule } from '../../database/database.module';
import { SessionModule } from '../../session/session.module';
import { BudgetPolicyService } from '../../cost-governance/budget-policy.service';
import { BudgetUsageEventRepository } from '../../cost-governance/database/repositories/budget-usage-event.repository';
import { WorkflowEventRepository } from '../../workflow/database/repositories/workflow-event.repository';
import type { WorkflowEvent } from '../../workflow/database/entities/workflow-event.entity';
import { BuiltInMemoryContextProvidersModule } from './built-in-memory-context-providers.module';
import { BuiltInContextProviderRegistrar } from './built-in-context-provider.registrar';
import { BudgetContextProvider } from './budget-context.provider';
import { RecentTaskSummaryProvider } from './recent-task-summary.provider';
import { ProjectStateDigestProvider } from './project-state-digest.provider';
import { LastFailurePostmortemProvider } from './last-failure-postmortem.provider';
import { UserPreferenceEchoProvider } from './user-preference-echo.provider';
import type { IChatContextProvider } from '../../session/chat-context-providers/chat-context.provider.interface';
import { ChatContextProviderAdapter } from '../../session/chat-context-providers/chat-context-provider.adapter';
import { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';
import { MemoryListingService } from '../memory-listing.service';
import { MemoryManagerService } from '../memory-manager.service';
import { MemoryModule } from '../memory.module';
import type { MemorySegmentListItem } from '../memory-listing.types';
import type { IMemorySegment } from '@nexus/core';

/**
 * Contract test for `BuiltInMemoryContextProvidersModule`.
 *
 * Pin the public contract:
 *   1. The module compiles cleanly with its real dependencies.
 *   2. After `onApplicationBootstrap`, the provider registry contains
 *      exactly the five canonical providers in the documented order.
 *   3. The `ChatSessionContextService` accessors return consistent
 *      values (`getRegisteredProviderCount` / `isRegistryEmpty` /
 *      `isHealthy` / `assertRegistryNonEmpty`).
 *   4. Re-registration is idempotent.
 *   5. Each individual provider's `IChatContextProvider` contract
 *      (canProvide returns boolean; getContext returns a block with
 *      the required shape) holds.
 *
 * The budget provider's DB and policy dependencies are mocked at the
 * provider level so the test does not need a real Postgres or Redis.
 */
describe('BuiltInMemoryContextProvidersModule', () => {
  // Module mocks for global modules the real CostGovernanceModule pulls in.
  @Module({})
  class MockAuthorizationModule {}

  @Module({})
  class MockDatabaseModule {}

  @Module({})
  class MockSessionModule {}

  /**
   * Mock of `CostGovernanceModule` that exposes the providers our
   * `BudgetContextProvider` depends on, without pulling in the real
   * AuthorizationModule/DatabaseModule tree.
   */
  @Module({
    providers: [
      {
        provide: BudgetPolicyService,
        useValue: { listAll: vi.fn().mockResolvedValue([]) },
      },
      {
        provide: BudgetUsageEventRepository,
        useValue: {
          getSpendInWindow: vi.fn().mockResolvedValue({
            totalCents: 0,
            totalTokens: 0,
          }),
        },
      },
    ],
    exports: [BudgetPolicyService, BudgetUsageEventRepository],
  })
  class MockCostGovernanceModule {}

  /**
   * Mock of `MemoryModule` that exposes stub `MemoryListingService`
   * and `MemoryManagerService` tokens, without pulling in the real
   * module's full dependency tree (Auth, AI config, Observability,
   * PluginKernel, BullMQ queues, etc.). The stub tokens are what the
   * stub providers under `BuiltInMemoryContextProvidersModule` will
   * inject once milestones M3–M6 land; for M2 we only need the
   * forwardRef wiring to close the cycle at DI time and for the two
   * tokens to remain reachable through the testing module.
   */
  @Module({
    providers: [
      {
        provide: MemoryListingService,
        useValue: {
          listSegments: vi.fn().mockResolvedValue({
            items: [],
            total: 0,
            limit: 0,
            offset: 0,
          }),
        },
      },
      {
        provide: MemoryManagerService,
        useValue: {
          getStrategicIntentSegment: vi.fn().mockResolvedValue(null),
          getMemorySegments: vi.fn().mockResolvedValue([]),
          searchMemory: vi.fn().mockResolvedValue([]),
        },
      },
    ],
    exports: [MemoryListingService, MemoryManagerService],
  })
  class MockMemoryModule {}

  function makeStubSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
      id: 'sess-stub-1',
      scopeId: 'proj-stub-1',
      agent_profile_id: 'ap-stub-1',
      agent_profile_name: 'stub-agent',
      initial_message: 'stub',
      status: 'RUNNING' as ChatSession['status'],
      container_tier: 2,
      // `ad_hoc` is the string value of `ChatSessionSource.AD_HOC` from
      // `@nexus/core`. We use a literal here to avoid pulling in the
      // workspace package from the typecheck (vitest resolves the alias
      // at runtime; tsc does not, and the pre-existing project typecheck
      // config does not declare path mappings for workspace packages).
      source: 'ad_hoc' as ChatSession['source'],
      session_type: 'general' as ChatSession['session_type'],
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    } as ChatSession;
  }

  /**
   * Per-provider stub overrides for the data sources each built-in
   * provider pulls from. When omitted, the testing module substitutes
   * the empty-default stubs declared in `MockMemoryModule` /
   * `useMocker`, which keep every `canProvide()` honest (returns
   * `false`) — exactly the shape the placeholder-era contract test
   * relied on. The M7 per-provider contract test sets these so each
   * `canProvide()` returns `true` and the rendered `getContext()`
   * output contains real markdown content rather than the
   * no-data fallback.
   */
  interface ProviderStubs {
    memoryListing?: { listSegments: MockInstance };
    memoryManager?: { getStrategicIntentSegment: MockInstance };
    workflowEventRepository?: { findPaged: MockInstance };
  }

  async function buildTestingModule(stubs?: ProviderStubs): Promise<{
    moduleRef: TestingModule;
    contextService: ChatSessionContextService;
    registrar: BuiltInContextProviderRegistrar;
    systemPromptAssembly: SystemPromptAssemblyService;
  }> {
    // Build a real `ChatSessionContextService` with its DB and
    // budget-resolver dependencies mocked. We pass it in via `useMocker`
    // so the registrar's constructor receives a fully-fledged instance
    // (not the empty `useMocker` stub). The budget-resolver and token-
    // counter stubs are not exercised by this module spec (it only tests
    // provider registration, not the budget-capping path).
    const assemblyService = new SystemPromptAssemblyService();
    const realContextService = new ChatSessionContextService(
      {
        findById: vi.fn(),
        update: vi.fn(),
      } as unknown as ChatSessionRepository,
      { create: vi.fn() } as unknown as ChatMessageRepository,
      { resolve: vi.fn().mockResolvedValue({ memory: 120_000 }) } as never,
      { countTokens: vi.fn().mockReturnValue(0) } as never,
      assemblyService,
    );
    realContextService.onModuleInit();

    // Use `useMocker` to provide the real `ChatSessionContextService`
    // instance to the registrar. The `BuiltInMemoryContextProvidersModule`
    // does not declare `ChatSessionContextService` as a provider (it relies
    // on the global `SessionModule` for that), so in this isolated test
    // scope the resolver falls back to the mocker for the token. By
    // returning the real service from the mocker, we get a registrar that
    // mutates the real registry, which is exactly what we want to assert
    // against.
    const builder = Test.createTestingModule({
      imports: [BuiltInMemoryContextProvidersModule],
    })
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(SessionModule)
      .useModule(MockSessionModule)
      .overrideModule(CostGovernanceModule)
      .useModule(MockCostGovernanceModule)
      .overrideModule(MemoryModule)
      .useModule(MockMemoryModule)
      .overrideProvider(ChatSessionRepository)
      .useValue({ findById: vi.fn(), update: vi.fn() })
      .overrideProvider(ChatMessageRepository)
      .useValue({ create: vi.fn() })
      .overrideProvider(BudgetPolicyService)
      .useValue({ listAll: vi.fn().mockResolvedValue([]) })
      .overrideProvider(BudgetUsageEventRepository)
      .useValue({
        getSpendInWindow: vi.fn().mockResolvedValue({
          totalCents: 0,
          totalTokens: 0,
        }),
      });

    // Apply per-provider data-source stub overrides. M7's per-provider
    // contract test passes real data so each `canProvide()` returns
    // `true` and `getContext()` renders a real block. When `stubs` is
    // omitted (default for every other test in this file), the
    // empty-default stubs from `MockMemoryModule` / `useMocker` are
    // preserved — every `canProvide()` returns `false`, which is the
    // exact shape the placeholder-era contract assertions relied on.
    //
    // Note: NestJS's `overrideProvider` only merges into providers
    // that already exist in the module graph, while `MockMemoryModule`
    // does NOT declare `WorkflowEventRepository` (it is a global
    // repository owned by `DatabaseModule`, whose stub is
    // `MockDatabaseModule` — also empty). For consistency we route
    // every M7 override through `useMocker`, which is invoked as a
    // fallback during DI resolution and is the same seam the
    // pre-existing `WorkflowEventRepository` mock uses.
    if (stubs?.memoryListing?.listSegments) {
      builder.overrideProvider(MemoryListingService).useValue({
        listSegments: stubs.memoryListing.listSegments,
      });
    }
    if (stubs?.memoryManager?.getStrategicIntentSegment) {
      builder.overrideProvider(MemoryManagerService).useValue({
        getStrategicIntentSegment:
          stubs.memoryManager.getStrategicIntentSegment,
        // The other MemoryManagerService methods are not exercised by
        // the built-in providers; keep their default empty mocks so a
        // stray call (e.g. from a future provider) is harmless.
        getMemorySegments: vi.fn().mockResolvedValue([]),
        searchMemory: vi.fn().mockResolvedValue([]),
      });
    }

    const moduleRef = await builder
      .useMocker((token) => {
        if (token === ChatSessionContextService) {
          return realContextService;
        }
        if (token === WorkflowEventRepository) {
          if (stubs?.workflowEventRepository?.findPaged) {
            return { findPaged: stubs.workflowEventRepository.findPaged };
          }
          // Default stub when no M7 override is supplied. Returning an
          // empty page keeps `LastFailurePostmortemProvider.canProvide`
          // honest (returns `false`) so the rest of the suite only
          // asserts on the IChatContextProvider shape, not on the
          // wiring.
          return {
            findPaged: vi.fn().mockResolvedValue([[], 0]),
          };
        }
        return {};
      })
      .compile();

    // Trigger lifecycle hooks (incl. BuiltInContextProviderRegistrar.onApplicationBootstrap).
    await moduleRef.init();
    const contextService = moduleRef.get(ChatSessionContextService);
    const registrar = moduleRef.get(BuiltInContextProviderRegistrar);
    return {
      moduleRef,
      contextService,
      registrar,
      systemPromptAssembly: assemblyService,
    };
  }

  it('compiles the module without error', async () => {
    const { moduleRef } = await buildTestingModule();
    expect(moduleRef).toBeDefined();
    expect(moduleRef.get(BuiltInMemoryContextProvidersModule)).toBeInstanceOf(
      BuiltInMemoryContextProvidersModule,
    );
    await moduleRef.close();
  });

  it('registers the five canonical providers in the documented order post-bootstrap', async () => {
    const { contextService, moduleRef } = await buildTestingModule();
    expect(contextService.getRegisteredProviderNames()).toEqual([
      'budget',
      'recent-task-summary',
      'project-state-digest',
      'last-failure-postmortem',
      'user-preference-echo',
    ]);
    await moduleRef.close();
  });

  it('reports the correct count and empty-status after bootstrap', async () => {
    const { contextService, moduleRef } = await buildTestingModule();
    expect(contextService.getRegisteredProviderCount()).toBe(5);
    expect(contextService.isRegistryEmpty()).toBe(false);
    expect(contextService.isHealthy()).toBe(true);
    await moduleRef.close();
  });

  it('allows re-registering an existing provider (logs and overwrites)', async () => {
    const { contextService, moduleRef } = await buildTestingModule();
    const replacement: IChatContextProvider = {
      name: 'budget',
      priority: 1,
      cacheTtlSeconds: 1,
      canProvide: vi.fn().mockResolvedValue(false),
      getContext: vi.fn(),
    };
    expect(() => {
      contextService.registerProvider('budget', replacement);
    }).not.toThrow();
    expect(contextService.getRegisteredProviderCount()).toBe(5);
    await moduleRef.close();
  });

  it('assertRegistryNonEmpty is a no-op when providers are present', async () => {
    const { contextService, moduleRef } = await buildTestingModule();
    expect(() => {
      contextService.assertRegistryNonEmpty();
    }).not.toThrow();
    expect(() => {
      contextService.assertRegistryNonEmpty('custom');
    }).not.toThrow();
    await moduleRef.close();
  });

  it('assertRegistryNonEmpty throws ChatContextRegistryEmptyError on an empty registry', async () => {
    const { contextService, moduleRef } = await buildTestingModule();
    contextService.clearProvidersForTesting();
    expect(contextService.isRegistryEmpty()).toBe(true);
    expect(() => {
      contextService.assertRegistryNonEmpty('unit-test');
    }).toThrow(ChatContextRegistryEmptyError);
    try {
      contextService.assertRegistryNonEmpty('unit-test');
    } catch (error) {
      expect(error).toBeInstanceOf(ChatContextRegistryEmptyError);
      const typed = error as ChatContextRegistryEmptyError;
      expect(typed.contextLabel).toBe('unit-test');
      expect(typed.registeredCount).toBe(0);
      expect(typed.message).toContain('unit-test');
      expect(typed.message).toContain('0');
    }
    await moduleRef.close();
  });

  it('BuiltInContextProviderRegistrar re-running bootstrap is idempotent', async () => {
    const { contextService, registrar, moduleRef } = await buildTestingModule();
    expect(contextService.getRegisteredProviderCount()).toBe(5);
    registrar.reRunForTesting();
    expect(contextService.getRegisteredProviderCount()).toBe(5);
    expect(contextService.getRegisteredProviderNames()).toEqual([
      'budget',
      'recent-task-summary',
      'project-state-digest',
      'last-failure-postmortem',
      'user-preference-echo',
    ]);
    await moduleRef.close();
  });

  it('per-provider contract: each provider renders a real block when stubbed data sources indicate applicability', async () => {
    // M7 fixture: stub the data sources each provider pulls from so
    // every `canProvide()` returns `true` and `getContext()` renders a
    // real block (with the expected markdown heading and content),
    // rather than the empty fallback the providers emit when their
    // upstream lookup returns nothing.
    //
    // The shapes mirror what the real data sources would return:
    //   - `MemoryListingService.listSegments` returns a page with
    //     `total > 0` for the `history` and `preference` memory types
    //     (recent-task-summary and user-preference-echo providers).
    //   - `MemoryManagerService.getStrategicIntentSegment` returns a
    //     fixture `IMemorySegment` with a populated `metadata_json`
    //     (project-state-digest provider).
    //   - `WorkflowEventRepository.findPaged` returns a single failure
    //     event with a non-empty payload (last-failure-postmortem
    //     provider).
    const historySegment: MemorySegmentListItem = {
      id: 'seg-history-1',
      entity_type: 'Project',
      entity_id: 'proj-stub-1',
      content: 'Closed milestone M3 wiring',
      memory_type: 'history',
      version: 1,
      metadata: null,
      created_at: '2026-06-19T12:00:00.000Z',
      updated_at: '2026-06-19T12:00:00.000Z',
    };
    const preferenceSegment: MemorySegmentListItem = {
      id: 'seg-pref-1',
      entity_type: 'User',
      entity_id: 'proj-stub-1',
      content: 'prefers concise answers',
      memory_type: 'preference',
      version: 1,
      metadata: null,
      created_at: '2026-06-19T12:00:00.000Z',
      updated_at: '2026-06-19T12:00:00.000Z',
    };
    const strategicIntentSegment: IMemorySegment = {
      id: 'seg-intent-1',
      entity_type: 'Project',
      entity_id: 'proj-stub-1',
      memory_type: 'strategic_intent',
      content: 'horizon=Q3 2026',
      version: 1,
      metadata_json: {
        horizon: 'Q3 2026',
        priority_themes: ['stability', 'perf'],
        focus_areas: ['api'],
        constraints: ['budget'],
        rationale: 'because',
      },
      created_at: new Date('2026-06-19T12:00:00.000Z'),
      updated_at: new Date('2026-06-19T12:00:00.000Z'),
    };
    const failureEvent: WorkflowEvent = {
      id: 'evt-failure-1',
      workflow_run_id: 'run-stub-1',
      event_type: 'workflow.failed',
      payload: { reason: 'Tool contract mismatch' },
      timestamp: new Date('2026-06-20T18:30:45.000Z'),
    };

    const listSegments = vi.fn().mockImplementation((params: unknown) => {
      const p = params as {
        memoryType?: string;
        limit: number;
        offset: number;
      };
      if (p.memoryType === 'history') {
        return Promise.resolve({
          items: [historySegment],
          total: 1,
          limit: p.limit,
          offset: p.offset,
        });
      }
      if (p.memoryType === 'preference') {
        return Promise.resolve({
          items: [preferenceSegment],
          total: 1,
          limit: p.limit,
          offset: p.offset,
        });
      }
      return Promise.resolve({
        items: [],
        total: 0,
        limit: p.limit,
        offset: p.offset,
      });
    });
    const getStrategicIntentSegment = vi
      .fn()
      .mockResolvedValue(strategicIntentSegment);
    const findPaged = vi.fn().mockResolvedValue([[failureEvent], 1]);

    const { moduleRef } = await buildTestingModule({
      memoryListing: { listSegments },
      memoryManager: { getStrategicIntentSegment },
      workflowEventRepository: { findPaged },
    });
    const session = makeStubSession();

    // Sanity: the fixture session has a non-null `scopeId` and `id`,
    // which is the precondition for every provider's `canProvide()`
    // to call its upstream data source.
    expect(session.id).toBe('sess-stub-1');
    expect(session.scopeId).toBe('proj-stub-1');

    const providers: IChatContextProvider[] = [
      moduleRef.get(BudgetContextProvider),
      moduleRef.get(RecentTaskSummaryProvider),
      moduleRef.get(ProjectStateDigestProvider),
      moduleRef.get(LastFailurePostmortemProvider),
      moduleRef.get(UserPreferenceEchoProvider),
    ];

    for (const provider of providers) {
      expect(typeof provider.name).toBe('string');
      expect(provider.name.length).toBeGreaterThan(0);
      expect(typeof provider.priority).toBe('number');
      // cacheTtlSeconds may be number or null; both are valid.
      expect(['number', 'object']).toContain(typeof provider.cacheTtlSeconds);

      // canProvide must return `true` against the stubbed data sources,
      // which is the M7 contract: the provider renders real content
      // only when its upstream data source reports applicability.
      const applicable = await provider.canProvide(session);
      expect(applicable).toBe(true);

      const block = await provider.getContext(session);
      expect(typeof block.title).toBe('string');
      expect(block.title.length).toBeGreaterThan(0);
      expect(typeof block.content).toBe('string');
      // Real block: contains the markdown heading derived from the
      // block title (so it would render as a `## Heading` section in
      // the assembled context message) and is more than just the
      // empty-fallback sentence.
      expect(block.content).toContain(`## ${block.title}`);
      expect(block.content.length).toBeGreaterThan(
        `## ${block.title}\n\n`.length,
      );
      expect(typeof block.priority).toBe('number');
      expect(block.metadata).toBeDefined();
      expect((block.metadata as Record<string, unknown>).provider).toBe(
        provider.name,
      );
    }

    // Per-provider spot checks against the stubbed data: each block
    // must surface the fixture's distinctive content so a regression
    // in `getContext()` (e.g. silently returning the empty fallback
    // even when `canProvide()` is `true`) trips loudly here.
    const budgetBlock = await moduleRef
      .get(BudgetContextProvider)
      .getContext(session);
    expect(budgetBlock.title).toBe('Budget');
    expect(budgetBlock.content).toContain('## Budget');
    expect(budgetBlock.content).toContain('Budget');

    const recentBlock = await moduleRef
      .get(RecentTaskSummaryProvider)
      .getContext(session);
    expect(recentBlock.title).toBe('Recent Tasks');
    expect(recentBlock.content).toContain('## Recent Tasks');

    const digestBlock = await moduleRef
      .get(ProjectStateDigestProvider)
      .getContext(session);
    expect(digestBlock.title).toBe('Project State Digest');
    expect(digestBlock.content).toContain('## Project State Digest');
    expect(digestBlock.content).toContain('- **Horizon**: Q3 2026');
    expect(digestBlock.content).toContain(
      '- **Priority themes**: stability, perf',
    );

    const failureBlock = await moduleRef
      .get(LastFailurePostmortemProvider)
      .getContext(session);
    expect(failureBlock.title).toBe('Last Failure Postmortem');
    expect(failureBlock.content).toContain('## Last Failure Postmortem');
    expect(failureBlock.content).toContain(
      `- **Occurred at**: ${failureEvent.timestamp.toISOString()}`,
    );
    expect(failureBlock.content).toContain('- **Event type**: workflow.failed');
    expect(failureBlock.content).toContain(
      `- **Workflow run**: ${failureEvent.workflow_run_id}`,
    );
    expect(failureBlock.content).toContain('Tool contract mismatch');

    const preferenceBlock = await moduleRef
      .get(UserPreferenceEchoProvider)
      .getContext(session);
    expect(preferenceBlock.title).toBe('User Preferences');
    expect(preferenceBlock.content).toContain('## User Preferences');
    expect(preferenceBlock.content).toContain(preferenceSegment.content);

    await moduleRef.close();
  });

  it('skips provider when canProvide returns false (adapter translates false to a null contribution)', async () => {
    // M7: pin the contract that the `ChatContextProviderAdapter` drops
    // a provider's contribution when its `canProvide()` returns
    // `false`. The per-provider contract test above covers the happy
    // path (canProvide=true → real block); this test covers the
    // symmetric drop so no block reaches the chat context.
    //
    // We exercise the same code path the registrar wires up at
    // bootstrap (`ChatSessionContextService.registerProvider` ->
    // `systemPromptAssembly.register(new ChatContextProviderAdapter(p))`),
    // but assert on the adapter directly so the test stays focused
    // on the canProvide=false branch and does not depend on the
    // memory-budget or block-formatting layers.
    const { moduleRef } = await buildTestingModule();
    const session = makeStubSession();

    // Pick `UserPreferenceEchoProvider` because it depends on
    // `MemoryListingService.listSegments` with memoryType='preference',
    // whose default mock returns `total=0` — so `canProvide()` honestly
    // returns `false` for this session (i.e. there are no preference
    // segments to surface).
    const provider = moduleRef.get(UserPreferenceEchoProvider);

    // Sanity: confirm the fixture + default stubs drive
    // canProvide=false so the rest of this test exercises the "drop"
    // branch (not the "happy path").
    expect(await provider.canProvide(session)).toBe(false);

    // Wrap in the `ChatContextProviderAdapter` — the same adapter the
    // registrar installs via `ChatSessionContextService.registerProvider`.
    // The adapter is the layer that translates a canProvide=false
    // result into a null contribution, which `SystemPromptAssemblyService.gatherBlocks`
    // then drops from the chat context.
    const adapter = new ChatContextProviderAdapter(provider);

    const block = await adapter.contribute({
      runType: 'chat',
      chatSessionId: session.id,
      scopeId: session.scopeId ?? undefined,
      baseLayers: [],
    });

    // The adapter must drop the contribution — no block reaches the
    // chat context. This is the seam the orchestrator's
    // `buildContextMessage` pipeline relies on: a provider that
    // declines the session does not surface an empty heading to the
    // model.
    expect(block).toBeNull();

    // Cross-check at the registry layer: the same provider, when
    // registered via the real registrar at bootstrap, is wrapped in a
    // `ChatContextProviderAdapter` and pushed into the
    // `SystemPromptAssemblyService` that
    // `ChatSessionContextService.getContextBlocks` uses to assemble
    // the chat context. Calling `gatherBlocks` with the same chat
    // context confirms the drop happens end-to-end (no block from
    // this provider appears in the assembled result, and the provider
    // is not in the `applied` list).
    const { systemPromptAssembly } = await buildTestingModule();
    const result = await systemPromptAssembly.gatherBlocks({
      runType: 'chat',
      chatSessionId: session.id,
      scopeId: session.scopeId ?? undefined,
      baseLayers: [],
    });
    expect(
      result.blocks.find(
        (b) => b.metadata?.provider === 'user-preference-echo',
      ),
    ).toBeUndefined();
    expect(result.applied).not.toContain('user-preference-echo');

    await moduleRef.close();
  });

  it('last-failure-postmortem provider has cacheTtlSeconds=null (always fresh)', async () => {
    const { moduleRef } = await buildTestingModule();
    const provider = moduleRef.get(LastFailurePostmortemProvider);
    expect(provider.cacheTtlSeconds).toBeNull();
    await moduleRef.close();
  });

  it('budget provider preserves the legacy build(contextId) shim', async () => {
    const { moduleRef } = await buildTestingModule();
    const provider = moduleRef.get(BudgetContextProvider);
    const block = await provider.build('ctx-legacy-1');
    expect(typeof block).toBe('string');
    expect(block).toContain('Budget');
    await moduleRef.close();
  });

  it('closes the BuiltInMemoryContextProvidersModule <-> MemoryModule forwardRef cycle at DI time', async () => {
    // Sanity test for the M2 wiring: import `BuiltInMemoryContextProvidersModule`
    // alone and substitute its `forwardRef(() => MemoryModule)` edge with the
    // slim `MockMemoryModule` that exports stub `MemoryListingService` and
    // `MemoryManagerService` tokens. If the bidirectional `forwardRef`
    // wiring closes the cycle at DI time, `.compile()` returns without
    // throwing and both tokens are reachable through the testing module —
    // which proves the cycle resolves cleanly without a real
    // `MemoryModule` compile. The stub providers do not yet inject these
    // services (that lands in M3–M6); this test asserts only that the
    // cycle compiles and the exported tokens are visible to NestJS DI.
    const moduleRef = await Test.createTestingModule({
      imports: [BuiltInMemoryContextProvidersModule],
    })
      .overrideModule(AuthorizationModule)
      .useModule(MockAuthorizationModule)
      .overrideModule(DatabaseModule)
      .useModule(MockDatabaseModule)
      .overrideModule(SessionModule)
      .useModule(MockSessionModule)
      .overrideModule(CostGovernanceModule)
      .useModule(MockCostGovernanceModule)
      .overrideModule(MemoryModule)
      .useModule(MockMemoryModule)
      .overrideProvider(ChatSessionRepository)
      .useValue({ findById: vi.fn(), update: vi.fn() })
      .overrideProvider(ChatMessageRepository)
      .useValue({ create: vi.fn() })
      .overrideProvider(BudgetPolicyService)
      .useValue({ listAll: vi.fn().mockResolvedValue([]) })
      .overrideProvider(BudgetUsageEventRepository)
      .useValue({
        getSpendInWindow: vi.fn().mockResolvedValue({
          totalCents: 0,
          totalTokens: 0,
        }),
      })
      .useMocker((token) => {
        if (token === ChatSessionContextService) {
          return {
            registerProvider: vi.fn(),
            getRegisteredProviderCount: vi.fn().mockReturnValue(0),
            isRegistryEmpty: vi.fn().mockReturnValue(true),
            isHealthy: vi.fn().mockReturnValue(true),
            assertRegistryNonEmpty: vi.fn(),
            getRegisteredProviderNames: vi.fn().mockReturnValue([]),
            clearProvidersForTesting: vi.fn(),
          };
        }
        if (token === WorkflowEventRepository) {
          // Stub for the cycle test (M5). The cycle test does not
          // exercise the repository mock directly; it only asserts
          // that the BuiltInMemoryContextProvidersModule compiles
          // with the new WorkflowEventRepository dependency wired in.
          return {
            findPaged: vi.fn().mockResolvedValue([[], 0]),
          };
        }
        return {};
      })
      .compile();

    // Both services must resolve through the forwardRef cycle. The
    // stubs come from MockMemoryModule, which is what the
    // `forwardRef(() => MemoryModule)` import on
    // `BuiltInMemoryContextProvidersModule` resolves to here.
    expect(moduleRef.get(MemoryListingService)).toBeDefined();
    expect(moduleRef.get(MemoryManagerService)).toBeDefined();

    await moduleRef.close();
  });
});
