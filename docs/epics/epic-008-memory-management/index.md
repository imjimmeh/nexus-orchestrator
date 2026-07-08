# Epic 008: Memory & Token Distillation Management

## Overview

**Epic ID**: 008
**Layer**: Core Services
**Status**: Not Started
**Priority**: Medium (P2)
**Estimated Timeline**: 1 week

## Context

Implement the persistent memory system for long-running agents and the token distillation pipeline that recursively summarizes JSONL conversation trees when they approach model token limits. This system enables agents to maintain context across multiple sessions and prevents context overflow errors in long conversations.

Memory management is essential for production AI systems - without it, agents lose context after rehydration and long conversations hit token limits.

## Dependencies

**Upstream Dependencies**:
- Epic 002 (Core Infrastructure) - for MemorySegments table and BullMQ

**Downstream Dependencies**:
- Epic 010 (Pi Agent Integration) - agents query memory via tools
- Epic 006 (Session Hydration) - distillation modifies session JSONL

**Can Run Independently**: YES (after Epic 002)

## Scope

### Included in This Epic

- **MemoryManagerService Implementation**
  - Memory segment CRUD operations
  - Entity-scoped memory (User, Project, System)
  - Memory querying and retrieval
  - Token counting and threshold detection

- **Persistent Memory Storage**
  - Store memory segments by entity type and ID
  - Support multiple memory types (preferences, facts, history)
  - Version memory segments on updates
  - Search memory by keywords or semantic similarity

- **query_memory Tool**
  - Expose to Pi Agents as a tool
  - Query memory by entity (User ID, Project ID)
  - Return relevant memory summaries
  - Support filtering by memory type

- **Token Distillation System**
  - Detect when JSONL tree reaches 80% of token limit
  - Background job to summarize conversation nodes
  - LLM API integration (use cheaper model like gpt-4o-mini)
  - Recursive summarization (older nodes compressed more)
  - Update JSONL in PiSessionTrees table

- **DistillationConsumer (BullMQ Worker)**
  - Process distillation jobs asynchronously
  - Call LLM API for summarization
  - Update session JSONL with summaries
  - Track distillation metrics (tokens before/after)

- **Token Counting**
  - Integrate tiktoken library for accurate token counts
  - Count tokens in JSONL trees
  - Per-model token limits (GPT-4: 128k, Claude: 200k)
  - Threshold alerting (80% of limit)

### Out of Scope

- Session dehydration/rehydration (Epic 006)
- Workflow execution (Epic 005)
- WebSocket communication (Epic 007)
- Semantic search (use simple keyword search for MVP)
- Memory visualization/analytics (Epic 013)

## Tasks

### MemoryManagerService Core
- [ ] Create MemoryManagerService class
- [ ] Implement createMemorySegment(entityType, entityId, content, type) method
  - Store in MemorySegments table
  - Support entity types: User, Project, System
  - Support memory types: preference, fact, history
- [ ] Implement getMemorySegments(entityType, entityId, filters) method
  - Retrieve all memory for entity
  - Filter by memory type
  - Order by created_at (most recent first)
- [ ] Implement updateMemorySegment(id, content) method
  - Version the memory (increment version number)
  - Track updated_at timestamp
- [ ] Implement deleteMemorySegment(id) method (soft delete)
- [ ] Implement searchMemory(entityType, entityId, query) method
  - Simple keyword search (PostgreSQL LIKE)
  - Return matching memory segments
- [ ] Test CRUD operations with database

### query_memory Tool
- [ ] Create query_memory tool definition
  - Tool name: "query_memory"
  - Parameters: entity_type, entity_id, query (optional)
  - Returns: Array of memory segments
- [ ] Implement tool execution logic
  - Call MemoryManagerService.searchMemory()
  - Format results for agent consumption
  - Limit results (max 10 segments)
- [ ] Register tool in ToolRegistry (Epic 004)
- [ ] Make available to all agent tiers (Light, Heavy, Admin)
- [ ] Test tool execution with mock agent

### Token Counting System
- [ ] Install tiktoken library (for OpenAI models) or anthropic tokenizer
- [ ] Create TokenCounterService
- [ ] Implement countTokens(text, model) method
  - Support multiple models (gpt-4, claude-3, etc.)
  - Use appropriate tokenizer per model
  - Return accurate token count
- [ ] Implement countJSONLTokens(jsonl, model) method
  - Parse JSONL into nodes
  - Count tokens for each node
  - Sum total tokens
- [ ] Define token limits per model
  - GPT-4: 128,000 tokens
  - GPT-4o: 128,000 tokens
  - Claude 3 Opus: 200,000 tokens
  - Claude 3.5 Sonnet: 200,000 tokens
- [ ] Test token counting with sample JSONL

### Token Threshold Detection
- [ ] Implement detectThreshold(jsonl, model) method
  - Count total tokens in JSONL
  - Get model's token limit
  - Calculate percentage (tokens / limit)
  - Return true if > 80%
- [ ] Integrate with SessionHydrationService (Epic 006)
  - Check threshold on dehydration
  - Enqueue distillation job if threshold exceeded
- [ ] Add threshold metrics (Prometheus)
- [ ] Test threshold detection with large JSONL

### Distillation Job Enqueuing
- [ ] Create DistillationJobService
- [ ] Implement enqueueDistillation(sessionTreeId, model) method
  - Create BullMQ job with session tree ID
  - Set job priority (low - background task)
  - Set job timeout (10 minutes)
- [ ] Add job deduplication (don't distill same session twice)
- [ ] Test job enqueuing

### DistillationConsumer (BullMQ Worker)
- [ ] Create DistillationConsumer class
- [ ] Register BullMQ processor for distillation queue
- [ ] Implement processDistillation(job) method
  - Extract sessionTreeId from job data
  - Retrieve JSONL from PiSessionTrees
  - Identify nodes to summarize (older than 10 turns)
  - Call LLM API for each node summary
  - Replace node content with summary
  - Update JSONL in PiSessionTrees
  - Track tokens before/after
  - Log distillation metrics
- [ ] Add retry logic (3 retries on LLM API failure)
- [ ] Add error handling (mark job as failed if all retries fail)
- [ ] Test consumer with sample JSONL

### LLM API Integration
- [ ] Install OpenAI SDK (openai package) or Anthropic SDK
- [ ] Create LLMService for summarization
- [ ] Implement summarizeNode(nodeContent, context) method
  - Build summarization prompt
  - Call LLM API (gpt-4o-mini for cost efficiency)
  - Extract summary from response
  - Return summary text
- [ ] Define summarization prompt template
  - "Summarize the following conversation node concisely while preserving key information"
  - Include context from surrounding nodes
- [ ] Add API key configuration (environment variable)
- [ ] Add rate limiting (respect LLM API limits)
- [ ] Test summarization with sample nodes

### Recursive Summarization
- [ ] Implement stratified summarization
  - Nodes 10-20 turns old: Summarize to 70% of original
  - Nodes 20-50 turns old: Summarize to 50% of original
  - Nodes 50+ turns old: Summarize to 30% of original
- [ ] Preserve critical nodes (tool_use, tool_result)
  - Don't summarize tool executions
  - Preserve exact tool parameters and results
- [ ] Implement batch summarization (multiple nodes per API call)
  - Reduce API calls by batching
  - Max 10 nodes per batch
- [ ] Test recursive summarization with 100-node tree

### Distillation Metrics
- [ ] Track tokens before distillation
- [ ] Track tokens after distillation
- [ ] Calculate compression ratio (before/after)
- [ ] Track distillation duration
- [ ] Log metrics to database
- [ ] Expose metrics via Prometheus (Epic 013)
- [ ] Test metrics collection

### Testing & Documentation
- [ ] Write unit tests for MemoryManagerService CRUD
- [ ] Write unit tests for TokenCounterService
- [ ] Write unit tests for threshold detection
- [ ] Write integration tests for query_memory tool
- [ ] Write integration tests for distillation consumer
  - Mock LLM API responses
  - Verify JSONL is updated correctly
  - Verify token count reduced
- [ ] Write end-to-end test for full distillation pipeline
- [ ] Document memory segment schema
- [ ] Document query_memory tool usage
- [ ] Document distillation process
- [ ] Create troubleshooting guide for distillation failures

## Key Deliverables

1. **MemoryManagerService**
   - CRUD for memory segments
   - Entity-scoped memory storage
   - Keyword search

2. **query_memory Tool**
   - Exposed to Pi Agents
   - Query memory by entity
   - Filtered results

3. **Token Counting System**
   - Accurate token counting (tiktoken)
   - Multi-model support
   - Threshold detection (80%)

4. **Distillation Pipeline**
   - BullMQ job enqueuing
   - Background worker (DistillationConsumer)
   - LLM API integration
   - JSONL summarization

5. **Metrics & Monitoring**
   - Tokens before/after
   - Compression ratio
   - Distillation duration

6. **Documentation**
   - Memory segment guide
   - query_memory tool reference
   - Distillation process docs

## Acceptance Criteria

- [ ] Memory segments can be created for Users and Projects
- [ ] Memory segments support multiple types (preference, fact, history)
- [ ] query_memory tool retrieves relevant memory summaries
- [ ] query_memory tool limits results to 10 segments
- [ ] Token counting is accurate (within 1% of actual tokens)
- [ ] Token counting supports GPT-4 and Claude models
- [ ] Token threshold detection triggers at 80% of model limit
- [ ] Distillation job is enqueued when threshold exceeded
- [ ] Distillation job is not duplicated (idempotency check)
- [ ] DistillationConsumer calls LLM API for summarization
- [ ] JSONL tree nodes are recursively summarized
- [ ] Older nodes are compressed more aggressively (30% for 50+ turns old)
- [ ] Tool execution nodes are preserved (not summarized)
- [ ] Compressed JSONL is stored back in PiSessionTrees
- [ ] Token count is reduced by at least 30% after distillation
- [ ] Distillation metrics are logged (tokens before/after)
- [ ] Unit tests mock LLM API responses
- [ ] Integration tests verify end-to-end distillation pipeline
- [ ] Distillation job retries on LLM API failure (up to 3 times)
- [ ] Failed distillation jobs are marked as failed (not stuck)

## Technical Notes

### Technology Stack
- **Token Counting**: tiktoken (OpenAI) or anthropic tokenizer
- **LLM API**: OpenAI SDK or Anthropic SDK
- **Queue**: BullMQ (from Epic 002)
- **ORM**: TypeORM/Prisma (from Epic 002)

### Memory Segment Schema
```typescript
interface MemorySegment {
  id: string;
  entity_type: 'User' | 'Project' | 'System';
  entity_id: string;
  memory_type: 'preference' | 'fact' | 'history';
  content: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}
```

### query_memory Tool Schema
```json
{
  "name": "query_memory",
  "description": "Query persistent memory for an entity",
  "parameters": {
    "type": "object",
    "properties": {
      "entity_type": {
        "type": "string",
        "enum": ["User", "Project", "System"]
      },
      "entity_id": {
        "type": "string"
      },
      "query": {
        "type": "string",
        "description": "Optional search query"
      }
    },
    "required": ["entity_type", "entity_id"]
  }
}
```

### Summarization Prompt Template
```
You are a conversation summarizer. Summarize the following conversation node concisely while preserving all key information, decisions, and context.

Original content:
{node_content}

Context from surrounding nodes:
{context}

Provide a concise summary (target: {target_percentage}% of original length):
```

### Token Limits by Model
```typescript
const TOKEN_LIMITS = {
  'gpt-4': 128000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-3-opus': 200000,
  'claude-3.5-sonnet': 200000,
};

const DISTILLATION_THRESHOLD = 0.8; // 80%
```

### Distillation Strategy
```
Age of Node         | Target Compression
--------------------|-------------------
0-10 turns old      | No compression (preserve recent context)
10-20 turns old     | 70% of original
20-50 turns old     | 50% of original
50+ turns old       | 30% of original

Special Cases:
- tool_use nodes    | Never summarize (preserve exact parameters)
- tool_result nodes | Never summarize (preserve exact results)
```

### Cost Optimization
- **Model Choice**: Use gpt-4o-mini for summarization (20x cheaper than gpt-4)
- **Batch Summarization**: Batch multiple nodes per API call
- **Caching**: Cache summaries to avoid re-summarizing same content

### Security Considerations
- **API Keys**: Store in environment variables, never in code
- **Memory Access**: Validate entity_id belongs to requesting user
- **Rate Limiting**: Respect LLM API rate limits
- **Cost Alerts**: Alert if distillation costs exceed threshold

### Testing Strategy
- **Unit Tests**: Memory CRUD, token counting, threshold detection
- **Integration Tests**: Full distillation pipeline with mocked LLM API
- **E2E Tests**: Real distillation with cheap LLM model
- **Load Tests**: Distillation with 1000-node JSONL tree

## Risks & Mitigation

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| LLM API failures during distillation | Medium | Medium | Retry logic (3 attempts), graceful degradation |
| Summarization loses critical context | High | Medium | Preserve tool nodes, test thoroughly |
| Distillation costs exceed budget | Medium | Low | Use cheaper model (gpt-4o-mini), monitoring |
| Token counting inaccurate | Medium | Low | Use official tokenizers (tiktoken), validation |
| Distillation too slow (blocks workflows) | Low | Low | Background job, timeout (10 min) |

## Parallel Development

**Can Run in Parallel**: YES (after Epic 002 completes)
**Can Run Alongside**: All other epics (independent feature)

## Related ADRs

- Create ADR-021: Memory storage strategy (PostgreSQL vs. vector DB)
- Create ADR-022: Token distillation model choice (gpt-4o-mini)
- Create ADR-023: Summarization strategy (recursive vs. sliding window)

## Notes

- Memory and distillation are independent features - can be developed separately
- Token distillation is critical for long-running agents (prevent context overflow)
- Start with simple keyword search for memory (semantic search is future enhancement)
- Monitor distillation costs closely (LLM API calls can be expensive)
- Consider adding memory analytics later (Epic 013)
- Distillation should be transparent to agents (they don't know their context was compressed)
