# EPIC-142: Skill Proposal Quality and Governance

Status: Implemented
Priority: P1
Beads: kanban-hrr
Depends On: EPIC-141
Last Updated: 2026-04-28

---

## 1. Summary

Improve the quality, evidence, reviewability, and safety of autonomous skill-improvement proposals before approved proposals modify the active skill library.

This builds on the existing `skill_improvement_proposals` approval workflow and the transcript-derived learning introduced by EPIC-141.

---

## 2. Problem

The current skill proposal flow can generate and apply patch markdown, but reviewers need stronger context before trusting autonomous skill changes.

Missing pieces:

1. clear evidence for why a proposal exists,
2. source session and learning candidate lineage,
3. better target-skill rationale,
4. stronger duplicate and conflict detection,
5. safer patch preview and approval ergonomics.

---

## 3. Goals

1. Add reviewer-friendly evidence to each proposal.
2. Explain target skill selection and score drivers.
3. Make proposal patch previews precise and auditable.
4. Preserve explicit approval and rejection before mutation.
5. Reduce duplicate, stale, or low-value skill proposals.

## 4. Non-Goals

1. Removing human approval from skill changes.
2. Replacing the filesystem skill library.
3. Introducing direct LLM-authored filesystem writes outside the current service path.

---

## 5. Architecture

### 5.1 Proposal Evidence

Extend proposal metadata and API views with evidence such as:

1. source learning candidate ID,
2. source session tree IDs or workflow run IDs,
3. recurrence and score diagnostics,
4. target skill matching rationale,
5. related prior proposal IDs when dedupe detects overlap.

### 5.2 Patch Review

Improve the patch workflow so reviewers can inspect:

1. current skill markdown,
2. proposed markdown insertion,
3. resulting markdown preview,
4. validation warnings before approval.

### 5.3 Governance Events

Emit audit events for proposal creation, approval, rejection, validation failure, and application failure with enough detail to reconstruct reviewer decisions.

---

## 6. Workstreams

1. Extend proposal persistence or diagnostics shape for evidence metadata.
2. Improve target skill matching and rationale generation.
3. Add proposal preview and validation APIs.
4. Update UI review surfaces for evidence and patch preview.
5. Add tests for approval, rejection, dedupe, and validation failure paths.

---

## 7. Backlog

- [x] E142-001 Add proposal evidence metadata and API projection.
- [x] E142-002 Add target-skill rationale and score diagnostics.
- [x] E142-003 Add safe patch preview generation.
- [x] E142-004 Add proposal validation before approval applies changes.
- [x] E142-005 Update learning proposal UI review surface.
- [x] E142-006 Add governance event and unit coverage.

---

## 8. Acceptance Criteria

1. Reviewers can see why a skill proposal was generated.
2. Reviewers can inspect source candidate/session evidence without exposing full transcript bodies.
3. Approval validates the target skill and patch before applying changes.
4. Rejections preserve reviewer rationale.
5. Duplicate or conflicting proposals are suppressed or clearly linked.

---

## 9. Risks and Mitigation

1. Proposal metadata may become too noisy.
   - Mitigate with concise summaries and expandable diagnostics.
2. Patch application may drift as skill files change.
   - Mitigate with validation against current skill content at approval time.
3. Reviewers may over-trust autonomous proposals.
    - Mitigate with explicit evidence, warnings, and human approval gates.

---

## 10. Implementation Notes (2026-04-28)

1. **Proposal diagnostics**: Added `diagnostics_json` column (nullable jsonb) to `skill_improvement_proposals`. Stores immutable `ProposalDiagnostics` with target-skill match, source evidence, related proposals, and validation result — captured at creation time.

2. **Target skill rationale**: `resolveTargetSkillMatch()` returns structured match result with `target_skill_name`, `matched_rule_keywords`, `matched_rule_name`, and human-readable `rationale` string. `resolveTargetSkillName()` delegates to it for backward compatibility.

3. **Dedupe and related proposals**: `findRelatedByTargetSkill()` query returns up to 5 recent proposals targeting the same skill. Related proposal IDs stored in `diagnostics_json.related_proposals.related_proposal_ids`. Exact pending duplicates suppressed.

4. **Patch preview API**: `GET /skills/proposals/:id/preview` returns `current_markdown`, `proposed_patch`, `resulting_markdown`, `is_valid`, and `warnings`. Reviewers can see exactly what a proposal would change.

5. **Approval validation**: `approveProposal()` calls `validatePreview()` before mutation. Validates that the target skill exists, the patch is not empty, and the patch is not already applied. If validation fails, proposal is marked `failed` with the warning stored in `error_message`, and a `skill_proposal_validation_failed` governance event is emitted.

6. **Governance events**: Extended `skill_proposal_created` payload with `match_rationale` and `related_proposal_count`. Added `skill_proposal_validation_failed` event type. Approval and rejection events already existed.

7. **UI**: Proposals card now shows expandable evidence section (target match, source candidate, score, recurrence, last seen), validation warnings before approve/reject, and a "Preview Patch" toggle that shows current/resulting markdown.

8. **Tests**: 11 tests in `skill-improvement-proposal.service.spec.ts` covering creation with diagnostics, target skill match, related proposals, validation warnings, preview generation, approval validation failure, duplicate patch rejection, and governance events.
