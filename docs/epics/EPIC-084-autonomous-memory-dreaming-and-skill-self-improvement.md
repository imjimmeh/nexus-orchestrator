# EPIC-084: Autonomous Memory Dreaming and Skill Self-Improvement

Status: Implemented
Priority: P1
Depends On: EPIC-067, EPIC-057, EPIC-078
Last Updated: 2026-04-12

---

## 1. Summary

Extend current retrospective and distillation capabilities into a generalized self-improvement loop with:

1. periodic memory consolidation sweeps,
2. promotion scoring for durable lessons,
3. optional agent-authored skill improvements under governance.

This targets parity with Hermes and OpenClaw learning loops while staying compatible with existing memory and skill systems.

---

## 2. Problem

Current learning is project-retrospective-centric. Missing pieces:

1. no generalized periodic memory consolidation pipeline,
2. no explainable candidate promotion model,
3. no governed pathway for runtime-generated skill refinements.

---

## 3. Goals

1. Introduce periodic memory sweep jobs across selected scopes.
2. Generate and rank candidate lessons with explicit scoring signals.
3. Promote high-confidence candidates into durable memory.
4. Add controlled skill-improvement proposals from execution outcomes.

## 4. Non-Goals

1. Unrestricted autonomous editing of production prompts and skills.
2. Replacing current retrospective APIs.

---

## 5. Architecture

### 5.1 Memory Sweep Pipeline

Phases:

1. Collect recent signals from workflow events and retrospective output.
2. Build candidate entries with dedupe and recurrence checks.
3. Rank candidates using weighted scoring.
4. Promote accepted candidates into persistent memory segments.

### 5.2 Promotion Scoring

Signals:

1. recurrence frequency,
2. stage diversity,
3. failure-reduction relevance,
4. recency decay,
5. confidence from source quality.

### 5.3 Skill Self-Improvement

1. Convert repeated successful remediation patterns into skill patch proposals.
2. Store proposals as reviewable artifacts.
3. Require explicit approval workflow before publishing to active skill set.

### 5.4 API

1. GET /memory/learning/status
2. POST /memory/learning/run
3. GET /memory/learning/candidates
4. POST /skills/proposals/:id/approve
5. POST /skills/proposals/:id/reject

---

## 6. Workstreams

1. Learning candidate schema and persistence.
2. Periodic memory sweep worker.
3. Ranking and promotion engine.
4. Skill-improvement proposal generator.
5. Governance workflow and UI for approvals.

---

## 7. Backlog

- [x] E084-001 Add learning_candidate entity and migration.
- [x] E084-002 Add periodic memory sweep queue and worker.
- [x] E084-003 Implement candidate dedupe and recurrence analysis.
- [x] E084-004 Implement weighted ranking and promotion thresholding.
- [x] E084-005 Add promotion audit events and diagnostics.
- [x] E084-006 Add skill proposal entity and approval workflow.
- [x] E084-007 Add proposal-to-skill patch generator.
- [x] E084-008 Add API surfaces for candidate and proposal review.
- [x] E084-008 Add dedicated UI review surfaces for learning candidates/proposals.
- [x] E084-009 Add evaluation tests for quality and false-positive control.

---

## 8. Acceptance Criteria

1. Periodic learning runs produce ranked candidate lessons with diagnostics.
2. Approved candidates are promoted into durable memory reliably.
3. Skill proposals are generated but cannot publish without approval.
4. Learning impact is measurable via regression metrics and acceptance tracking.

---

## 9. Risks and Mitigation

1. Low-quality or noisy memory promotions.
   - Mitigate with conservative thresholds and review gates.
2. Unsafe autonomous skill changes.
   - Mitigate with mandatory approval path and diff-based validation.

---

## 10. Implementation Notes (2026-04-12)

Implemented delivery:

1. New persistence models for `learning_candidates` and `skill_improvement_proposals` with repositories, indexes, and migration.
2. Autonomous periodic memory learning sweep via BullMQ queue (`memory-learning`) with repeat scheduling and worker processing.
3. Candidate pipeline with dedupe, recurrence aggregation, weighted signal scoring, thresholded promotion, and event-ledger audit emission.
4. Governed skill-improvement proposal lifecycle with explicit approve/reject endpoints and approval-gated skill patch publication.
5. Delivered API endpoints:
   - `GET /memory/learning/status`
   - `POST /memory/learning/run`
   - `GET /memory/learning/candidates`
   - `GET /skills/proposals`
   - `POST /skills/proposals/:id/approve`
   - `POST /skills/proposals/:id/reject`
6. Added unit/controller coverage for learning helper logic, sweep orchestration, proposal service, and new controllers.
7. Added dedicated web review surfaces under project workspace Learning tab for memory-learning status, candidate review, and proposal governance actions.
8. Learning candidate review is scope-aware and supports non-project learning contexts (`project`, `user`, `agent`, `general`) rather than restricting visibility to a single project.

Runtime knobs:

1. `MEMORY_LEARNING_ENABLED` (default true)
2. `MEMORY_LEARNING_INTERVAL_SECONDS` (default 21600)
3. `MEMORY_LEARNING_PROMOTION_THRESHOLD` (default 0.72)
4. `MEMORY_LEARNING_PROPOSAL_THRESHOLD` (default 0.84)
5. `MEMORY_LEARNING_PROMOTION_ENTITY_ID` (default `global-learning`)
