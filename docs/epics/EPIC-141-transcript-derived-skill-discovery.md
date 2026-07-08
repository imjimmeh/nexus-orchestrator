# EPIC-141: Transcript-Derived Skill Discovery

Status: Implemented
Priority: P1
Beads: kanban-zag
Depends On: EPIC-084, EPIC-139
Last Updated: 2026-04-28

---

## 1. Summary

Extend the existing autonomous memory learning loop so it can learn from successful agent session transcripts, not only retrospectives and workflow events.

The system already persists Pi agent session JSONL in `pi_session_trees` and exposes manual retrieval through the `retrieve-session-logs` skill. This epic turns that stored transcript data into a governed learning source for repeated high-quality patterns.

---

## 2. Problem

Current skill self-improvement is implemented through `LearningMemoryService` and `SkillImprovementProposalService`, but the sweep input currently comes from retrospective observations and orchestration events.

Missing pieces:

1. successful session transcript mining,
2. pattern extraction from tool usage and agent behavior,
3. source evidence linking candidates back to session trees,
4. transcript-specific quality controls to avoid noisy skill proposals.

---

## 3. Goals

1. Decode recent successful `pi_session_trees` records during memory learning sweeps.
2. Extract bounded learning observations from repeated high-quality transcript patterns.
3. Feed transcript observations into the existing learning candidate aggregation path.
4. Preserve existing skill proposal governance: no direct skill file mutation without approval.
5. Record enough source evidence for reviewers to understand why a candidate was generated.

## 4. Non-Goals

1. Replacing retrospective-based learning.
2. Automatically creating or editing skill files without human approval.
3. Storing full transcript contents in proposal rows.
4. Mining failed sessions for this first slice.

---

## 5. Architecture

### 5.1 Transcript Collector

Add a collector near the existing learning sweep pipeline that:

1. queries recent successful workflow and chat session trees,
2. decodes the base64 gzip JSONL payload,
3. parses agent SDK events into normalized transcript observations,
4. redacts or drops sensitive content before scoring,
5. returns `LearningObservation` records to the existing aggregator.

### 5.2 Pattern Sources

Initial extractors should focus on low-risk structural signals:

1. repeated tool-call sequences that end in successful completion,
2. repeated recovery patterns after test or validation failures,
3. repeated project-convention checks performed before implementation,
4. repeated planning or verification steps that correlate with accepted work.

### 5.3 Governance

Transcript-derived candidates must flow through the existing candidate and proposal lifecycle:

1. ranked candidate creation,
2. promotion thresholding,
3. optional skill-improvement proposal generation,
4. explicit approval before skill mutation.

---

## 6. Workstreams

1. Add session transcript query and decode support for learning sweeps.
2. Add transcript pattern extraction helpers.
3. Extend `LearningObservation` diagnostics with source session evidence.
4. Add tests for decoding, filtering, scoring, and no-secret persistence.
5. Update memory learning status/reporting to include transcript scan counts.

---

## 7. Backlog

- [x] E141-001 Add recent successful session-tree query support.
- [x] E141-002 Add safe transcript decoder and event normalizer.
- [x] E141-003 Add transcript pattern extractors for successful tool sequences.
- [x] E141-004 Feed transcript observations into learning sweep aggregation.
- [x] E141-005 Add source evidence and diagnostics to candidates.
- [x] E141-006 Add unit coverage for sanitization and candidate generation.

---

## 8. Acceptance Criteria

1. Manual or scheduled memory learning sweeps can scan successful session transcripts.
2. Transcript-derived candidates appear through `GET /memory/learning/candidates`.
3. Generated candidates include source session identifiers and scoring diagnostics.
4. Transcript learning never writes directly to skill files.
5. Tests prove failed, malformed, or sensitive transcripts do not create unsafe proposals.

---

## 9. Risks and Mitigation

1. Noisy or generic patterns create low-value proposals.
   - Mitigate with conservative thresholds, dedupe, and evidence requirements.
2. Session transcripts may contain sensitive information.
   - Mitigate by reusing redaction boundaries and storing references, not full transcript bodies.
3. Large transcript scans may be expensive.
    - Mitigate with lookback windows, scan limits, and incremental bookkeeping.

---

## 10. Implementation Notes (2026-04-28)

Implemented in branch `epic-141-transcript-learning`:

1. **Session-tree query** (`pi-session-tree.repository.ts`): `findRecentSuccessfulForLearning()` joins `workflow_runs` and `chat_sessions` on completed status, returns `LearningSessionTreeSource` rows with project IDs.

2. **Safe decoder** (`learning-memory-transcript.decoder.ts`): gzip/base64 JSONL decoding with rejection paths (`missing_payload`, `decode_failed`, `parse_failed`) and a 500-node cap.

3. **Event normalizer** (`learning-memory-transcript.normalizer.ts`): Extracts structural events (`tool_call`, `tool_result`, `validation_failure`, `verification_step`, `completion`) from decoded nodes, skips secret-like values, never preserves content.

4. **Pattern extractor** (`learning-memory-transcript.extractor.ts`): Two conservative patterns — `transcript_tool_sequence` (3+ tool calls ending in success) and `transcript_recovery_pattern` (validation failure followed by verification success). Produces `LearningObservation` records with `sourceEvidence`.

5. **Transcript collector** (`learning-memory-transcript.collector.ts`): Orchestrates decode → normalize → extract, tracks `scannedSessionTrees` and `rejectedSessionTrees`.

6. **Sweep integration** (`learning-memory.sweep.ts`): `prepareLearningSweepInputs` calls both retrospective and transcript collectors in parallel, merges observations, returns scan counts.

7. **Service wiring** (`learning-memory.service.ts`): `PiSessionTreeRepository` injected, new summary fields (`scannedSessionTrees`, `rejectedSessionTrees`, `scannedTranscriptObservations`) populated.

8. **Source evidence**: Aggregation buckets carry `sourceEvidence` arrays capped at 10, propagated through to `AggregatedLearningCandidate.diagnostics.source_evidence`.

9. **Config**: `MEMORY_LEARNING_TRANSCRIPT_SCAN_LIMIT` with default 100.

10. **Tests**: 84 tests total across 9 test files, including safety boundary tests for no-secret persistence, failed-session exclusion, and secret-skipping normalization.
