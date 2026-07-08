# Epic: ChatSessionContextService — Pluggable Multi-Source Context Architecture

**Status**: Planning  
**Priority**: High  
**Owner**: Architecture  
**Estimated Scope**: 3–4 sprints  
**Related Epics**: [Epic: Chat Session Lifecycle Refactor], [Epic: Kanban API Separation]

---

## Overview

Implement a **pluggable, extensible context injection system** that aggregates information from multiple sources (projects, kanban work items, agent memories, capabilities, constraints, etc.) and prepends it as structured system context to every chat session. This enables agents to operate with rich, unified context without tight coupling between APIs or knowledge silos.

### Why This Matters

1. **Cross-API Awareness**: Agents in chat need visibility into orchestration state (project phase, work items, approvals) without hardcoding dependencies on kanban API.
2. **Extensibility**: Future sources (agent memories, team policies, external integrations) should plug in without refactoring the core service.
3. **Consistency**: All chat sessions get the same context discovery and injection flow, reducing boilerplate and bugs.
4. **Performance**: Context is cached and refreshed selectively, avoiding repeated expensive queries.
5. **Auditability**: Context snapshots are stored, enabling post-hoc analysis of what information agents saw at session start.

---

## Architecture

### High-Level Flow

```
ChatSessionContextService (orchestrator)
├── ProjectContextProvider     → Local DB (projects, orchestrations)
├── KanbanContextProvider      → Kanban API or shared DB (work items, phases)
├── AgentMemoryProvider        → Agent memory store (future)
├── CapabilitiesProvider       → IAM + tool registry (future)
├── ConstraintsProvider        → System settings + policies (future)
└── CustomProvider (user-defined)
    ↓
    Aggregate by priority + Format into markdown blocks
    ↓
    Prepend as SYSTEM message to chat_messages
    ↓
    Optional: Snapshot context_metadata in chat_sessions
    ↓
    Expose refresh endpoint for mid-session updates
```

### Core Components

#### 1. Provider Interface

```typescript
// apps/api/src/session/chat-context-providers/chat-context.provider.interface.ts

interface IChatContextProvider {
  /**
   * Determines if this provider is applicable to the given session.
   * E.g., ProjectContextProvider only loads if session.project_id is set.
   */
  canProvide(session: ChatSession): Promise<boolean>;

  /**
   * Load and format context.
   * Returns a block with title, content, and priority.
   */
  getContext(session: ChatSession): Promise<ChatContextBlock>;

  /**
   * Optional: Priority determines display order (higher = first).
   * Default: 100
   */
  priority?: number;

  /**
   * Optional: Cache TTL in seconds. null = no caching.
   * E.g., 300 = cache for 5 minutes
   */
  cacheTtlSeconds?: number | null;

  /**
   * Provider name for logging and metadata.
   */
  name: string;
}

interface ChatContextBlock {
  /**
   * Section title, e.g., "Project Context", "Active Work Items"
   */
  title: string;

  /**
   * Markdown-formatted content block.
   */
  content: string;

  /**
   * Display priority (higher = earlier in final message).
   */
  priority: number;

  /**
   * Optional: metadata for auditing or future refresh decisions.
   */
  metadata?: Record<string, unknown>;
}
```

#### 2. Concrete Providers

##### ProjectContextProvider (Local, Fast)

**Source**: `projects` + `project_orchestrations` tables  
**Cache TTL**: 5 minutes  
**Applicability**: `session.project_id != null`

**Example Output**:
```
**Project Context**

- **ID**: d4b8300b-3456-47cb-9107-a2651fd565f8
- **Name**: A todo app
- **Description**: Simple task management app with real-time sync
- **Current Phase**: SPEC_DRAFTING
- **Status**: On Track
- **Created**: 2026-04-10
- **Orchestration State**:
  - Last activity: Phase transitioned SPEC_DRAFTING (2 hours ago)
  - Active workflows: 1 (spec-generation)
  - Container tier: light
- **Team**:
  - PM: alice@example.com
  - Architect: bob@example.com
  - Developers: charlie@example.com, diana@example.com
```

**Implementation Notes**:
- Loads minimal project metadata + orchestration snapshot
- Does not load full work-item list (delegated to KanbanContextProvider)
- Captures phase, team ownership, and status

##### KanbanContextProvider (Remote or Local, Moderate)

**Source**: Kanban API endpoint or shared `work_items` table  
**Cache TTL**: 10 minutes  
**Applicability**: `session.project_id != null && kanban_enabled`

**Example Output**:
```
**Active Work**

- **[WI-001]** API Design (APPROVED, dev: charlie@example.com)
  - Status: Approved by PM, awaiting dev start
  - Est. duration: 3 days
  - Depends on: None
  - Blocks: WI-002, WI-003

- **[WI-002]** DB Schema (BLOCKED, awaiting spec)
  - Status: Blocked since 2026-04-16 18:30 (waiting for API spec finalization)
  - Est. duration: 2 days
  - Blocked by: WI-001 (API Design)
  - Blocks: WI-003

- **[WI-003]** Frontend (NOT_STARTED, unassigned)
  - Status: Not started (depends on WI-001, WI-002)
  - Est. duration: 5 days

**Summary**:
- Total items: 3
- In progress: 0
- Blocked: 1
- Next actions:
  - Publish API design spec (unblocks WI-002, WI-003)
  - Assign dev to WI-002 after WI-001 published
```

**Implementation Notes**:
- If kanban API is separate, make HTTP call with fallback (if API unreachable, skip this block)
- If shared DB, query directly
- Prioritizes blocked items and shows critical path
- Includes estimated time to completion

##### CapabilitiesContextProvider (Future, Moderate)

**Source**: IAM policy + Tool registry for agent profile  
**Cache TTL**: 30 minutes (policies change infrequently)  
**Applicability**: Always applicable

**Example Output**:
```
**Available Actions**

- **Publish Work Item**: ✓ Allowed (phase=SPEC_DRAFTING)
- **Create Work Item**: ✓ Allowed (5 remaining in quota)
- **Transition Work Item**: ✓ Allowed (requires PM approval for phase changes)
- **Merge Code**: ✗ Not allowed (dev-only tool, agent has read-only role)
- **Approve Spec**: ✓ Allowed (agent has architect role)
- **Access Logs**: ✓ Allowed (read-only)
- **Invoke Workflow**: ✓ Allowed (up to 3 concurrent)

**Constraints**:
- Max concurrent workflows: 3 (current: 1)
- Max work items per project: 20 (current: 3)
- Approval SLA: 3 days for PM review
```

**Implementation Notes**:
- Integrates with `IAMService` and `ToolRegistryService`
- Surfaces constraints early (e.g., quota limits, approval gates)
- Helps agent avoid attempted actions that will fail

##### AgentMemoryContextProvider (Future, Variable)

**Source**: Agent memory store (not yet implemented)  
**Cache TTL**: Session duration (memories don't change mid-session)  
**Applicability**: `session.agent_profile?.memory_enabled === true`

**Example Output**:
```
**Agent Context & Memories**

- **Last Session**: Spec Review phase (2026-04-16 18:34)
  - Task: Review API design spec from dev
  - Outcome: Approved with minor feedback (2 items)
  - Duration: 1 hour 15 minutes

- **Learned Patterns**:
  - PM approval typically takes 1–2 hours
  - Architecture review can be done async via comments
  - Dev prefers iterative feedback vs. big-bang rewrites

- **Open Blockers**:
  - Awaiting PM sign-off on scope (flagged 2026-04-16 14:00)
  - Missing deployment strategy discussion

- **Key Decisions**:
  - Architecture: REST + PostgreSQL (vs. GraphQL) — decided 2026-04-12
  - Framework: NestJS for backend (decided 2026-04-10)
```

**Implementation Notes**:
- Requires agent memory persistence (future work)
- Helps agent maintain continuity across sessions
- Surfaces learned constraints and patterns

##### ConstraintsContextProvider (Future, Moderate)

**Source**: System settings, project policy, team configuration  
**Cache TTL**: 30 minutes  
**Applicability**: Always applicable

**Example Output**:
```
**Team Constraints & Policies**

- **Approval Chain**: PM → Architect → Tech Lead (for phase changes)
- **Scope Boundary**: ±20% of original estimate requires PM review
- **Budget**: $8,000 remaining / $50,000 total (16%)
- **Concurrent Limits**:
  - Max workflows per project: 5 (current: 1)
  - Max workers per workflow: 4 (current: 2)
- **Review SLAs**:
  - PM approval: 3 days
  - Architecture review: 5 days
  - Security review: 7 days
- **Escalation**: Critical path delays need Tech Lead approval
```

**Implementation Notes**:
- Helps agent understand organizational constraints early
- Can prevent wasted effort on scope creep
- Surfaces cost/budget implications

---

## Implementation

### 1. Core Service: ChatSessionContextService

**File**: `apps/api/src/session/chat-session-context.service.ts`

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ChatSessionRepository } from './repositories/chat-session.repository';
import { ChatMessagesRepository } from '../chat/repositories/chat-messages.repository';
import { IChatContextProvider, ChatContextBlock } from './chat-context-providers/chat-context.provider.interface';
import { ProjectContextProvider } from './chat-context-providers/project-context.provider';
import { KanbanContextProvider } from './chat-context-providers/kanban-context.provider';

@Injectable()
export class ChatSessionContextService implements OnModuleInit {
  private providers: Map<string, IChatContextProvider> = new Map();
  private contextCache: Map<string, { blocks: ChatContextBlock[]; expiresAt: number }> = new Map();

  constructor(
    private chatSessionRepo: ChatSessionRepository,
    private chatMessagesRepo: ChatMessagesRepository,
    private projectContextProvider: ProjectContextProvider,
    private kanbanContextProvider: KanbanContextProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    // Register all built-in providers
    this.registerProvider('project', this.projectContextProvider);
    this.registerProvider('kanban', this.kanbanContextProvider);
    // Future providers registered here
  }

  /**
   * Register a context provider (built-in or custom).
   */
  registerProvider(name: string, provider: IChatContextProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Build full context message: gather blocks from applicable providers,
   * sort by priority, and format as markdown.
   */
  async buildContextMessage(chatSessionId: string): Promise<string> {
    const session = await this.chatSessionRepo.findById(chatSessionId);
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`);
    }

    const blocks = await this.getContextBlocks(session);
    return this.formatContextMessage(blocks);
  }

  /**
   * Inject context as the first system message in the session.
   * Called after container starts, before agent begins.
   */
  async injectContextMessage(chatSessionId: string): Promise<string> {
    const contextText = await this.buildContextMessage(chatSessionId);

    // Create system message
    await this.chatMessagesRepo.create({
      id: generateUUID(),
      chat_session_id: chatSessionId,
      direction: 'system',
      sender: 'system',
      channel: 'api',
      event_type: 'context_injected',
      text: contextText,
      timestamp: new Date(),
      metadata: {
        auto_generated: true,
        version: 'v1',
      },
    });

    // Store snapshot in chat_sessions
    const blocks = await this.getContextBlocks(
      await this.chatSessionRepo.findById(chatSessionId),
    );
    await this.chatSessionRepo.update(chatSessionId, {
      context_metadata: {
        injected_at: new Date(),
        providers_used: Array.from(this.providers.keys()).filter(
          (name) => blocks.some((b) => b.metadata?.provider === name),
        ),
        block_count: blocks.length,
        version: 'v1',
      },
    });

    return contextText;
  }

  /**
   * Refresh context mid-session (e.g., after phase change, new work item published).
   * Called by event listeners.
   */
  async refreshContextMessage(chatSessionId: string): Promise<void> {
    // Clear cache
    this.contextCache.delete(chatSessionId);

    const newContextText = await this.buildContextMessage(chatSessionId);

    // Log refresh as separate system message
    await this.chatMessagesRepo.create({
      id: generateUUID(),
      chat_session_id: chatSessionId,
      direction: 'system',
      sender: 'system',
      channel: 'api',
      event_type: 'context_refreshed',
      text: newContextText,
      timestamp: new Date(),
      metadata: {
        auto_generated: true,
        reason: 'orchestration state change',
      },
    });
  }

  /**
   * Internal: gather context blocks from applicable providers.
   */
  private async getContextBlocks(session: ChatSession): Promise<ChatContextBlock[]> {
    const cacheKey = session.id;
    const cached = this.contextCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.blocks;
    }

    // Collect applicable providers
    const applicableProviders = await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => ({
        name,
        provider,
        applicable: await provider.canProvide(session),
      })),
    );

    const activeProviders = applicableProviders
      .filter((p) => p.applicable)
      .map((p) => p.provider)
      .sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));

    // Load blocks in parallel
    const blocks = await Promise.all(activeProviders.map((p) => p.getContext(session)));

    // Cache with minimum TTL
    const minTtl = Math.min(
      ...(blocks.map((b) => b.metadata?.cacheTtlSeconds ?? 300) as number[]),
    );
    this.contextCache.set(cacheKey, {
      blocks,
      expiresAt: Date.now() + minTtl * 1000,
    });

    return blocks;
  }

  /**
   * Format blocks into markdown message.
   */
  private formatContextMessage(blocks: ChatContextBlock[]): string {
    const header = `# Session Context

This context was automatically assembled at session start and reflects the current state of your project and work items. Refer to it for decision-making, but always verify critical information with the user or system before taking action.

---
`;

    const body = blocks
      .sort((a, b) => b.priority - a.priority)
      .map((block) => `## ${block.title}\n\n${block.content}`)
      .join('\n\n');

    return `${header}\n${body}`;
  }
}
```

### 2. ProjectContextProvider

**File**: `apps/api/src/session/chat-context-providers/project-context.provider.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../../project/repositories/project.repository';
import { ProjectOrchestrationRepository } from '../../orchestration/repositories/project-orchestration.repository';
import { ChatSession } from '../entities/chat-session.entity';
import { IChatContextProvider, ChatContextBlock } from './chat-context.provider.interface';

@Injectable()
export class ProjectContextProvider implements IChatContextProvider {
  name = 'project';
  priority = 200;
  cacheTtlSeconds = 300; // 5 minutes

  constructor(
    private projectRepo: ProjectRepository,
    private orchestrationRepo: ProjectOrchestrationRepository,
  ) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    return !!session.project_id;
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    const project = await this.projectRepo.findById(session.project_id);
    const orchestration = await this.orchestrationRepo.findByProjectId(session.project_id);

    if (!project) {
      return {
        title: 'Project Context',
        content: '*Project not found*',
        priority: this.priority,
      };
    }

    const content = `
- **ID**: ${project.id}
- **Name**: ${project.name}
- **Description**: ${project.description || '*(no description)*'}
- **Current Phase**: ${orchestration?.phase || 'UNKNOWN'}
- **Status**: ${orchestration?.status || 'UNKNOWN'}
- **Created**: ${project.created_at.toISOString().split('T')[0]}
- **Team**: ${project.team_members?.map((m) => m.email).join(', ') || '*(empty)*'}
${orchestration ? this.formatOrchestration(orchestration) : ''}
`.trim();

    return {
      title: 'Project Context',
      content,
      priority: this.priority,
      metadata: {
        provider: 'project',
        cacheTtlSeconds: this.cacheTtlSeconds,
      },
    };
  }

  private formatOrchestration(orch: ProjectOrchestration): string {
    return `- **Last Activity**: ${orch.updated_at.toISOString()}
- **Container Tier**: ${orch.container_tier || 'unset'}`;
  }
}
```

### 3. KanbanContextProvider

**File**: `apps/api/src/session/chat-context-providers/kanban-context.provider.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ChatSession } from '../entities/chat-session.entity';
import { IChatContextProvider, ChatContextBlock } from './chat-context.provider.interface';

@Injectable()
export class KanbanContextProvider implements IChatContextProvider {
  name = 'kanban';
  priority = 150;
  cacheTtlSeconds = 600; // 10 minutes

  private readonly logger = new Logger(KanbanContextProvider.name);

  constructor(
    private http: HttpService,
    private config: ConfigService,
  ) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    return !!session.project_id && this.config.get('KANBAN_API_ENABLED') === 'true';
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    try {
      const kanbanUrl = this.config.get('KANBAN_API_URL') || 'http://localhost:3011';
      const endpoint = `${kanbanUrl}/api/projects/${session.project_id}/chat-context`;

      const response = await this.http.get(endpoint).toPromise();
      const { workItems, summary } = response.data;

      const content = this.formatWorkItems(workItems, summary);

      return {
        title: 'Active Work Items',
        content,
        priority: this.priority,
        metadata: {
          provider: 'kanban',
          cacheTtlSeconds: this.cacheTtlSeconds,
          itemCount: workItems?.length ?? 0,
        },
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch kanban context for project ${session.project_id}: ${error.message}`,
      );
      return {
        title: 'Active Work Items',
        content: '*Kanban data unavailable (API unreachable)*',
        priority: this.priority,
        metadata: {
          provider: 'kanban',
          error: error.message,
        },
      };
    }
  }

  private formatWorkItems(items: any[], summary: any): string {
    if (!items || items.length === 0) {
      return '*No work items*';
    }

    const itemLines = items
      .map(
        (item) =>
          `- **[${item.id}]** ${item.title} (${item.status})` +
          (item.assigned_to ? `\n  Assigned: ${item.assigned_to}` : '') +
          (item.blocked_by ? `\n  Blocked by: ${item.blocked_by}` : '') +
          (item.duration_est ? `\n  Est: ${item.duration_est}` : ''),
      )
      .join('\n\n');

    const summaryLine = summary
      ? `\n\n**Summary**: ${summary.total} total, ${summary.in_progress} in progress, ${summary.blocked} blocked`
      : '';

    return itemLines + summaryLine;
  }
}
```

### 4. Module Registration

**File**: `apps/api/src/session/chat-session-context.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChatSessionContextService } from './chat-session-context.service';
import { ProjectContextProvider } from './chat-context-providers/project-context.provider';
import { KanbanContextProvider } from './chat-context-providers/kanban-context.provider';
import { ProjectModule } from '../project/project.module';
import { OrchestrationModule } from '../orchestration/orchestration.module';

@Module({
  imports: [HttpModule, ProjectModule, OrchestrationModule],
  providers: [ChatSessionContextService, ProjectContextProvider, KanbanContextProvider],
  exports: [ChatSessionContextService],
})
export class ChatSessionContextModule {}
```

### 5. Data Schema Changes

**Add to `ChatSession` entity** (`apps/api/src/chat/entities/chat-session.entity.ts`):

```typescript
@Column({ type: 'jsonb', nullable: true })
context_metadata?: {
  injected_at: Date;
  providers_used: string[];
  block_count: number;
  version: string;
};
```

**Migration**:

```typescript
// apps/api/src/migrations/202604XX_add_chat_session_context_metadata.migration.ts
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddChatSessionContextMetadata202604XX implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'chat_sessions',
      new TableColumn({
        name: 'context_metadata',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('chat_sessions', 'context_metadata');
  }
}
```

---

## Integration Points

### At Session Creation (ChatExecutionService)

```typescript
// In ChatExecutionService.startSession()
async startSession(request: StartChatSessionRequest): Promise<ChatSession> {
  const session = await this.createAndPersistSession(request);

  // Inject context immediately after container starts
  await this.chatSessionContextService.injectContextMessage(session.id);

  return session;
}
```

### On Orchestration Events (Event Listeners)

```typescript
// apps/api/src/session/event-listeners/context-refresh.listener.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ChatSessionContextService } from '../chat-session-context.service';
import { WorkItemPublishedEvent } from '../../work-item/events/work-item-published.event';
import { ProjectPhaseChangedEvent } from '../../project/events/project-phase-changed.event';

@Injectable()
export class ContextRefreshListener {
  constructor(private contextService: ChatSessionContextService) {}

  @OnEvent(WorkItemPublishedEvent.eventName)
  async onWorkItemPublished(event: WorkItemPublishedEvent): Promise<void> {
    // Refresh context for all active chat sessions in this project
    const sessions = await this.chatSessionRepo.findByProjectId(event.projectId);
    for (const session of sessions) {
      if (session.status === 'active') {
        await this.contextService.refreshContextMessage(session.id);
      }
    }
  }

  @OnEvent(ProjectPhaseChangedEvent.eventName)
  async onPhaseChanged(event: ProjectPhaseChangedEvent): Promise<void> {
    const sessions = await this.chatSessionRepo.findByProjectId(event.projectId);
    for (const session of sessions) {
      if (session.status === 'active') {
        await this.contextService.refreshContextMessage(session.id);
      }
    }
  }
}
```

### Controller Endpoint (Manual Refresh)

```typescript
// POST /api/sessions/chat/:sessionId/refresh-context
@Post(':sessionId/refresh-context')
async refreshContext(@Param('sessionId') sessionId: string): Promise<void> {
  await this.chatSessionContextService.refreshContextMessage(sessionId);
}
```

---

## Kanban API Integration

### Option A: HTTP Call (Recommended for Distributed)

- Kanban API exposes `GET /api/projects/:projectId/chat-context`
- Returns: `{ workItems: [...], summary: { total, in_progress, blocked, ... } }`
- Chat API makes HTTP call with 5s timeout + fallback to skip block if unreachable

### Option B: Shared DB Query (Recommended for Monolithic)

- If both APIs share same DB (current architecture), query `work_items` directly
- No HTTP overhead, strong consistency
- Requires coordination on schema changes

**Recommendation**: Implement **Option B** initially (shared DB query), add **Option A** (HTTP) as fallback for resilience.

---

## File Structure

```
apps/api/src/session/
├── chat-session-context.service.ts                    # Main orchestrator
├── chat-session-context.module.ts                     # DI & registration
├── chat-context.types.ts                              # Interfaces & types
├── chat-context-providers/
│   ├── chat-context.provider.interface.ts             # IChatContextProvider
│   ├── project-context.provider.ts                    # Project info
│   ├── kanban-context.provider.ts                     # Work items (HTTP or DB)
│   ├── capabilities-context.provider.ts               # (stub, future)
│   ├── agent-memory-context.provider.ts               # (stub, future)
│   ├── constraints-context.provider.ts                # (stub, future)
│   └── index.ts                                       # Re-export
├── event-listeners/
│   ├── context-refresh.listener.ts                    # Listen for events
│   └── index.ts
└── repositories/
    └── chat-session-context.repository.ts             # (if caching layer needed)
```

---

## Extensibility Roadmap

### Phase 1: MVP (Now)
- ✅ ProjectContextProvider
- ✅ KanbanContextProvider
- ✅ Core service + provider registration
- ✅ Injection at session start
- ✅ Schema changes

### Phase 2: Capabilities & Constraints (Sprint N+1)
- ⏳ CapabilitiesContextProvider (IAM + tool registry)
- ⏳ ConstraintsContextProvider (policies + limits)
- ⏳ Event-driven refresh on policy changes

### Phase 3: Agent Memory (Sprint N+2)
- ⏳ AgentMemoryContextProvider
- ⏳ Memory persistence layer
- ⏳ Cross-session context continuity

### Phase 4: Extensibility & Custom Providers (Sprint N+3)
- ⏳ Plugin/custom provider registration via config
- ⏳ External system integration (Jira, Linear, Slack)
- ⏳ War room & multi-participant contexts

### Phase 5: Advanced Features (Future)
- ⏳ Selective context refresh (only update changed blocks)
- ⏳ Context summarization (compress blocks for token savings)
- ⏳ Context versioning (track changes across session lifetime)
- ⏳ Post-session context analysis (what context did agent see at key decision points?)

---

## Acceptance Criteria

### Functional
- [ ] `ChatSessionContextService` successfully discovers and loads all applicable providers
- [ ] Context is injected as first system message in every new chat session
- [ ] Context includes project, work items, and (if available) capabilities info
- [ ] Kanban provider gracefully handles unreachable API (fallback to skip block)
- [ ] Context blocks are cached with appropriate TTLs
- [ ] Manual refresh endpoint works (POST `/api/sessions/chat/:id/refresh-context`)
- [ ] Event listeners trigger refresh on orchestration state changes
- [ ] `chat_sessions.context_metadata` is populated at session start
- [ ] All tests pass (unit + E2E)

### Non-Functional
- [ ] Context injection takes < 500ms (no blocking delays at session start)
- [ ] Kanban API calls timeout after 5s (don't hang chat session startup)
- [ ] Cache reduces repeated provider calls by 80%+
- [ ] No lint errors or type violations
- [ ] Documentation complete (architecture + usage)

### Architecture
- [ ] Provider interface is clean and easy to implement
- [ ] Adding a new provider requires < 50 lines of code
- [ ] Service has no knowledge of specific provider implementations
- [ ] Context refresh is idempotent (safe to call multiple times)

---

## Related Epics & Dependencies

- **[Epic: Chat Session Lifecycle Refactor]** — Refactor `ChatExecutionService` to use context service at startup
- **[Epic: Kanban API Separation]** — Define `/api/projects/:id/chat-context` endpoint in kanban API
- **[Epic: Event-Driven Orchestration]** — Ensure project/work-item events are emitted consistently
- **[Epic: Agent Memory System]** — Implement memory persistence (prerequisite for AgentMemoryContextProvider)

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Kanban API unreachable blocks chat startup | High | Timeout (5s) + fallback (skip block) |
| Context too verbose, wastes tokens | Medium | Phase 2: add context summarization |
| Provider adds circular dependency | Medium | Strict module boundaries + DI review |
| Cache invalidation bugs | Medium | Comprehensive cache tests + clear TTL policy |
| Schema migration fails in production | High | Test migration on staging first, rollback plan |

---

## Success Metrics

1. **Adoption**: Agents reference injected context in explanations (qualitative)
2. **Quality**: Agent decisions improve with context availability (via review)
3. **Performance**: Context injection adds < 500ms overhead (quantitative)
4. **Maintainability**: New providers added in < 2 hours (development velocity)
5. **Extensibility**: 0 changes needed to core service for new providers (architecture goal)

---

## Notes

- **Config**: Kanban API URL should be configurable (env var `KANBAN_API_URL`)
- **Logging**: Provider load failures should be logged at WARN level, not ERROR
- **Testing**: Mock all providers in unit tests; use real DB for integration tests
- **Documentation**: Add "Provider Development Guide" to help future contributors

