# EPIC-201: Agent Skill Search Enhancement — Semantic, Fuzzy, and Relevance-Ranked Retrieval

**Status:** Partially Implemented
**Priority:** P2
**Created:** 2026-06-03
**Updated:** 2026-06-09
**Owner:** AI Config / Agent Skills Platform
**Parent:** None
**Depends on:** None
**Related:** EPIC-168 (Advisor-Led Startup Orchestration and Skill Discovery), EPIC-142 (Skill Proposal Quality and Governance)

## Summary

Replace the current literal-substring-token matching in `AgentSkillsService.searchSkills()` with a multi-strategy retrieval pipeline that supports tokenized word matching (already done), fuzzy/typo-tolerant matching, relevance scoring, embedding-based semantic search, and category-aware ranking. Agents issuing natural-language queries should find the most relevant skills even when query phrasing does not exactly match skill names or descriptions.

This epic extends the fix applied in `18334ade` (tokenized word matching) to a full-featured retrieval layer.

## Problem Statement

The `search_skills` tool is the primary discovery mechanism for agents to find relevant skills at runtime. The current implementation (`apps/api/src/ai-config/services/agent-skills.service.ts:51-61`) uses `String.includes()` against tokenized query words. This works for simple queries but falls short:

1. **No typo tolerance**: `"orchestration"` vs `"orchestartion"` fails silently.
2. **No semantic understanding**: `"advisor discovery tools implementation"` should match a skill with description `"Collection entrypoint for CEO orchestration playbooks covering first-run discovery"` because "discovery" is semantically relevant even when the full phrase differs.
3. **No relevance ranking**: All matches are returned equally; there is no way to surface the best match first.
4. **No weighted fields**: A match in the skill `name` should rank higher than a match in `description` or `tags`.
5. **No caching or index**: Every `searchSkills` call reads the filesystem, filters in-memory, and scans linearly through all skills.
6. **No multi-field scoring**: Tags, category, name, and description are all treated as equal binary filters rather than contributing to a relevance score.

As the skill library grows (28+ skills and growing), agents need better retrieval precision to discover the right skill without trial-and-error query reformulation.

## Goals

- Keep the current `searchSkills` API contract (`query`, `category`, `tags`) stable.
- Add fuzzy matching so minor typos and near-matches still return results.
- Add configurable relevance scoring (name match > description match > tag match).
- Integrate embedding-based semantic search as an optional complementary strategy.
- Build a read-through in-memory index so repeated searches don't re-read the filesystem on every call.
- Return results ranked by relevance score, not filesystem order.
- Make the search strategy pluggable (literal → tokenized → fuzzy → semantic) so individual strategies can be tuned or replaced independently.
- Surface score metadata in search results so callers can inspect match quality.
- Keep the solution API/core-neutral — no Kanban-specific identifiers or semantics.

## Non-Goals

- Do not change the `searchSkills` input schema or break existing callers.
- Do not require vector database infrastructure in the first iteration — start with in-process TF-IDF or lightweight embeddings.
- Do not replace the filesystem skill library with a database-backed store.
- Do not add skill content (markdown body) to the searchable fields in this epic — keep to metadata fields (name, description, tags, category).
- Do not implement collaborative filtering or agent-preference learning.
- Do not change the skill YAML frontmatter schema.

## Current-State Baseline

### What Exists Today

| Component | Location | Behavior |
|-----------|----------|----------|
| `searchSkills()` | `agent-skills.service.ts:33-61` | category exact filter → AND tags filter → tokenized word substring match |
| `listSkills()` | `agent-skill-library.service.ts` | Reads from filesystem, returns all active skills |
| `SearchSkillsTool` | `workflow-internal-tools/tools/skill/search-skills.tool.ts` | Thin wrapper calling `searchSkills()` |
| `search_skills` capability | `workflow-context-capability.provider.ts:222` | Registered capability exposing `searchSkills` to agents |
| `SearchPlaybooksTool` | `workflow-internal-tools/tools/playbook/search-playbooks.tool.ts` | Delegates to `searchSkills` with `category: playbook` |

### Recent Improvement

Commit `18334ade` (2026-06-03) changed the query filter from a full-phrase literal substring match to tokenized word matching (`String.includes()` per word). This was the minimal fix to address the immediate problem of multi-word queries returning empty results. This epic builds on that foundation.

### Gaps This Epic Closes

| Gap | Current | Target |
|-----|---------|--------|
| Typo tolerance | None — `orchestation` misses `orchestration` | Levenshtein/fuzzy matching within configurable threshold |
| Semantic matching | Substring only | Embedding cosine similarity or TF-IDF as optional layer |
| Relevance ranking | Return order = filesystem order | Score-ranked with tunable field weights |
| Index | Re-reads filesystem per call | In-memory index with invalidation on skill changes |
| Score transparency | No score in output | Optional score field on result items |
| Strategy composability | Monolithic filter chain | Pluggable strategy pipeline |

## Architecture

### Module Location

Enhancements stay within the existing AI Config module boundary:

```text
apps/api/src/ai-config/
├── services/
│   ├── agent-skills.service.ts          ← searchSkills() becomes pipeline orchestrator
│   ├── agent-skill-library.service.ts   ← may gain index/invalidation hooks
│   └── skill-search/                    ← NEW: search strategy implementations
│       ├── skill-search-strategy.interface.ts
│       ├── skill-search-pipeline.service.ts
│       ├── strategies/
│       │   ├── token-match.strategy.ts       ← current behavior, extracted
│       │   ├── fuzzy-match.strategy.ts        ← Levenshtein/Damerau
│       │   ├── tfidf-match.strategy.ts        ← in-process TF-IDF
│       │   └── embedding-match.strategy.ts    ← optional, gated by config
│       └── skill-index.service.ts             ← read-through in-memory index
```

### Strategy Pipeline

Searches flow through a configurable pipeline:

```
query → [Tokenizer] → [Fuzzy Preprocessor] → [Strategy Chain] → [Ranker] → results
```

1. **Tokenizer**: Split query into words (already done).
2. **Fuzzy Preprocessor**: Optional — expand query words with near neighbors within threshold.
3. **Strategy Chain**: Each strategy produces scored candidates. Strategies compose via union/intersection/max-score.
4. **Ranker**: Merge, deduplicate, sort by composite score, truncate to limit.

### Search Strategy Interface

```typescript
interface ISkillSearchStrategy {
  readonly name: string;
  search(query: string, skills: SkillLibraryRecord[]): ScoredSkillResult[];
}

interface ScoredSkillResult {
  skill: SkillLibraryRecord;
  score: number;        // 0.0 - 1.0
  matchDetails: {
    strategy: string;
    matchedFields: string[];
    highlights?: string[];
  };
}
```

### Index Design

```typescript
class SkillIndexService {
  private index: Map<string, IndexedSkill>;  // skill name → preprocessed data
  private invertedIndex: Map<string, Set<string>>; // word → skill names
  private embeddings: Map<string, Float32Array>;   // skill name → embedding

  build(skills: SkillLibraryRecord[]): void;
  invalidate(skillName: string): void;
  invalidateAll(): void;
  searchTokens(words: string[]): Set<string>;       // inverted index lookup
  getEmbedding(skillName: string): Float32Array | null;
}
```

Invalidation hooks: `writeSkillMarkdown`, `renameSkill`, `deleteSkill` in `AgentSkillLibraryService` should call `SkillIndexService.invalidate()`.

### Scoring Formula (Initial)

```
score = (nameMatchWeight * nameScore)
      + (descMatchWeight * descScore)
      + (tagMatchWeight * tagScore)
      + (categoryMatchWeight * categoryScore)
      + (semanticScore * semanticWeight)

nameMatchWeight   = 0.40
descMatchWeight   = 0.25
tagMatchWeight    = 0.20
categoryMatchWeight = 0.10
semanticWeight    = 0.05  (0.0 if embeddings disabled)
```

Exact match → 1.0, fuzzy match → 1.0 - (editDistance / maxLen), substring → 0.7, word match → 0.5.

## Implementation Progress

| Workstream | Status | Notes |
|-----------|--------|-------|
| W1: Extract Strategy Interface and Token Match Strategy | ✅ Done | `ISkillSearchStrategy`, `tokenize()`, `TokenMatchStrategy` — merged |
| W2: Relevance Scoring and Ranking | ✅ Done | `ScoredSkillResult`, field-weighted scoring, max-score merge in pipeline |
| W3: Fuzzy Matching Strategy | ✅ Done | `FuzzyMatchStrategy` with Levenshtein distance |
| W4: In-Memory Skill Index | ✅ Done | `SkillIndexService` with lazy build, invalidation hooks on every skill write/rename/delete |
| W5: TF-IDF Strategy | ✅ Partial | `TfIdfMatchStrategy` implemented; embedding strategy not yet built |
| W6: Pipeline Composition and Configuration | ❌ Not started | DB-stored strategy config and admin API for tuning not implemented |

All three implemented strategies (token, fuzzy, TF-IDF) are wired in `SkillSearchPipelineService` using max-score merging. `AgentSkillsService.searchSkills()` delegates entirely to the pipeline. Invalidation hooks are registered on `writeSkillMarkdown`, `renameSkill`, and `deleteSkill`.

The embedding strategy and DB-driven configuration (W5 embeddings + W6) remain outstanding. See `apps/api/src/ai-config/services/skill-search/` for the implementation.

---

## Workstreams

### W1: Extract Strategy Interface and Token Match Strategy

Extract current tokenized-word-matching logic into a `TokenMatchStrategy` implementing `ISkillSearchStrategy`. No behavior change — pure refactor. Update `searchSkills()` to delegate to the strategy.

*Acceptance:* All existing `searchSkills` tests pass unchanged.

### W2: Relevance Scoring and Ranking

Add `ScoredSkillResult` with composite scoring formula. Rank results by score descending. Surface score in output if requested (`includeScores?: boolean`).

*Acceptance:* Tests verify higher score for name match vs description match; exact match scores higher than partial.

### W3: Fuzzy Matching Strategy

Implement `FuzzyMatchStrategy` using Levenshtein distance with configurable threshold (default: max edit distance of 2 for words ≥ 5 chars, 0 for words ≤ 3 chars). Combine with token strategy via max-score merging.

*Acceptance:* `"orchestartion"` matches skills with `"orchestration"` in name/description. `"debug"` still matches `"debugging"` via token match.

### W4: In-Memory Skill Index

Build `SkillIndexService` with inverted index (word → skill names) and read-through population. Integrate invalidation hooks into skill CRUD operations.

*Acceptance:* First search populates index; subsequent searches use index without filesystem reads. Skill rename/delete invalidates index entries.

### W5: TF-IDF and Embedding Strategies (Optional / Gated)

- **TF-IDF**: Lightweight in-process vectorization using term frequency across the skill corpus. Requires no external dependencies beyond a tokenizer.
- **Embedding**: Optional integration with a local embedding model (e.g., through the provider layer). Gated behind `NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED` environment variable or DB config.

*Acceptance:* When enabled, semantic queries return skills that are conceptually related even without word overlap.

### W6: Pipeline Composition and Configuration

Wire strategies into a `SkillSearchPipelineService` with DB-stored configuration for strategy selection, weights, and thresholds. Provide admin API for tuning without redeploy.

*Acceptance:* Changing `skill_search_strategy` config updates search behavior within the next search invocation.

## Implementation Order

```
W1 (refactor, no behavior change)
  → W2 (scoring/ranking)
  → W3 (fuzzy matching)
  → W4 (index)
  → W5 (TF-IDF → embeddings, gated)
  → W6 (pipeline config)
```

Each workstream is independently testable and shippable. W1-W3 are the minimum viable enhancement; W4-W6 deepen the capability.

## API Impact

### Schema Additions (backward-compatible)

```typescript
// Optional additions to searchSkills input
interface SearchSkillsParams {
  query?: string;
  category?: string;
  tags?: string[];
  includeScores?: boolean;    // NEW — return score metadata
  minScore?: number;          // NEW — filter below threshold
  limit?: number;             // NEW — cap result count
}

// Optional additions to SkillLibraryRecord (read-only projection)
interface SkillLibraryRecord {
  // ... existing fields
  _score?: number;            // NEW — set when includeScores=true
  _matchDetails?: {           // NEW
    strategy: string;
    matchedFields: string[];
  };
}
```

### No Breaking Changes

- `includeScores`, `minScore`, `limit` are optional with sensible defaults.
- `_score` and `_matchDetails` are prefixed with underscore to avoid collision with filesystem-derived fields.
- Existing callers (search tools, playbook tools, capability providers) need zero changes.

## Dependencies and Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Index drift after file write | Medium | Invalidate on every `writeSkillMarkdown`/`renameSkill`/`deleteSkill`; short TTL fallback |
| Embedding model not available in all environments | Medium | Feature-gate behind env var; graceful degradation to token strategy |
| Fuzzy matching produces too many false positives for short words | High | Skip fuzzy expansion for words ≤ 3 chars; configurable threshold |
| Strategy chain adds latency | Low | In-memory index makes each strategy fast; embedding calls are async and optional |
| Memory pressure from embedding vectors | Low | Only load embeddings for active skills; lazy population |

## Related Artifacts

- Implementation: `apps/api/src/ai-config/services/agent-skills.service.ts:51-61`
- Tests: `apps/api/src/ai-config/services/agent-skills.service.spec.ts:214-250`
- Callers: `search-skills.tool.ts`, `search-playbooks.tool.ts`, `workflow-context-capability.provider.ts`
- Root cause analysis: `docs/plans/2026-06-03-subagent-session-streaming-observability.md` (search_skills returning empty for multi-word queries)
- Fix commit: `18334ade`
