"""
Runtime contract test for CEO cycle mandatory backlog promotion.

This test validates the ZERO-TODO BACKLOG PROMOTION MANDATE from the CEO cycle prompt.
When autonomous mode has 0 todo items and unblocked backlog exists, the CEO MUST
take one of four actions and must NOT produce a bare `repeat` with no mutation.

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed - a protocol violation.

Valid outcomes for 0 todo + unblocked backlog:
  (a) Promote at least one safe backlog item to todo
  (b) Patch execution config to make a candidate safe, then promote
  (c) Create scoped missing work item and promote it
  (d) Structured `repeat` decision with per-item `blockedReason` fields

Invalid: bare `repeat` with no mutation and no per-item blocked reasons.
"""
import pytest
from typing import Dict, Any, List, Optional


class BoardState:
    """Mock board state for simulating CEO cycle scenarios."""
    
    def __init__(
        self,
        todo_count: int,
        backlog_count: int,
        unblocked_backlog_ids: List[str],
        is_autonomous: bool = True,
    ):
        self.todo_count = todo_count
        self.backlog_count = backlog_count
        self.unblocked_backlog_ids = unblocked_backlog_ids
        self.is_autonomous = is_autonomous
    
    def has_zero_todo_with_unblocked_backlog(self) -> bool:
        """Check if the mandate conditions are met."""
        return (
            self.todo_count == 0 and
            self.backlog_count > 0 and
            self.is_autonomous and
            len(self.unblocked_backlog_ids) > 0
        )
    
    def to_project_state_dict(self) -> Dict[str, Any]:
        """Convert to project_state dict format."""
        backlog_items = []
        for i in range(self.backlog_count):
            item_id = f"BACKLOG-{i+1:03d}"
            backlog_items.append({
                "id": item_id,
                "title": f"Backlog Item {i+1}",
                "status": "backlog",
                "blocked": item_id not in self.unblocked_backlog_ids,
            })
        
        return {
            "workItems": backlog_items,
            "todo_count": self.todo_count,
            "backlog_count": self.backlog_count,
            "is_autonomous_mode": self.is_autonomous,
        }


class CEOCycleDecision:
    """Represents a CEO cycle decision output with mutation tracking."""
    
    def __init__(
        self,
        decision: str,
        reason: str,
        mutations: List[Dict[str, Any]] = None,
        blocked_items: List[Dict[str, Any]] = None,
        blocker: Optional[str] = None,
    ):
        self.decision = decision
        self.reason = reason
        self.mutations = mutations or []
        self.blocked_items = blocked_items or []
        self.blocker = blocker
    
    @classmethod
    def from_kanban_result(cls, result: Dict[str, Any]) -> "CEOCycleDecision":
        """Parse from kanban.complete_orchestration_cycle_decision result."""
        return cls(
            decision=result.get("decision", ""),
            reason=result.get("reason", ""),
            mutations=result.get("mutations", []),
            blocked_items=result.get("blockedItems", []),
            blocker=result.get("blocker"),
        )
    
    def is_bare_repeat(self) -> bool:
        """
        Check if this is a BARE repeat - the protocol violation we reject.
        
        A bare repeat has:
        - decision == "repeat"
        - NO mutations (no board changes)
        - NO blockedItems with per-item blockedReason fields
        """
        return (
            self.decision == "repeat" and
            len(self.mutations) == 0 and
            len(self.blocked_items) == 0
        )
    
    def outcome_a_promote_to_todo(self) -> bool:
        """Outcome (a): Promote backlog item to todo."""
        for mutation in self.mutations:
            if (
                mutation.get("type") == "patch_work_item_status" and
                mutation.get("from_status") == "backlog" and
                mutation.get("to_status") == "todo"
            ):
                return True
        return False
    
    def outcome_b_patch_config_then_promote(self) -> bool:
        """Outcome (b): Patch execution config, then promote."""
        has_patch = any(m.get("type") == "patch_execution_config" for m in self.mutations)
        has_promote = self.outcome_a_promote_to_todo()
        return has_patch and has_promote
    
    def outcome_c_create_and_promote(self) -> bool:
        """Outcome (c): Create work item via delegation, then promote."""
        has_create = any(
            m.get("type") == "delegate_work_item_generation" for m in self.mutations
        )
        has_promote = self.outcome_a_promote_to_todo()
        return has_create and has_promote
    
    def outcome_d_structured_repeat(self) -> bool:
        """
        Outcome (d): Structured repeat with per-item blockedReason fields.
        
        This is valid ONLY when:
        - decision == "repeat"
        - blockedItems array exists with at least one item
        - Each blocked item has a non-empty blockedReason field
        """
        if self.decision != "repeat":
            return False
        if len(self.blocked_items) == 0:
            return False
        return all(item.get("blockedReason") for item in self.blocked_items)
    
    def is_valid_zero_todo_decision(self) -> bool:
        """
        Check if decision is valid under the ZERO-TODO BACKLOG PROMOTION MANDATE.
        
        Invalid: bare repeat with no mutation and no per-item blockedReasons
        Valid: any of the four outcomes (a), (b), (c), or (d)
        """
        if self.decision == "blocked":
            # Outcome: blocked decision with explicit ticket-level blocker
            return self.blocker is not None and len(self.blocker) > 0
        
        if self.decision != "repeat":
            return False
        
        # Reject bare repeat (the protocol violation)
        if self.is_bare_repeat():
            return False
        
        # Accept any of the four valid outcomes
        return (
            self.outcome_a_promote_to_todo() or
            self.outcome_b_patch_config_then_promote() or
            self.outcome_c_create_and_promote() or
            self.outcome_d_structured_repeat()
        )


class TestCEOZeroTodoBacklogPromotionContract:
    """Contract tests for CEO cycle mandatory backlog promotion."""
    
    def test_rejects_bare_repeat_with_zero_todo_and_unblocked_backlog(self):
        """
        CRITICAL CONTRACT TEST: CEO must NOT produce bare repeat in this scenario.
        
        Scenario: 0 todo + 33 unblocked backlog items (evidence from 2026-05-15)
        Invalid output: decision="repeat", reason="No board action available"
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_ids=[f"BACKLOG-{i+1:03d}" for i in range(33)],
        )
        
        assert board.has_zero_todo_with_unblocked_backlog()
        
        # Simulate the protocol violation from live evidence
        decision = CEOCycleDecision(
            decision="repeat",
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_zero_todo_decision(), (
            "Bare repeat is a PROTOCOL VIOLATION when 0 todo + unblocked backlog exists"
        )
    
    def test_rejects_generic_repeat_without_per_item_evidence(self):
        """
        Test that generic "checked board state" repeats are rejected.
        
        Invalid: decision="repeat", reason="Checked board state, will retry later"
        Valid: decision="repeat", reason="... blockedItems: [...]"
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_ids=["BACKLOG-001", "BACKLOG-002", "BACKLOG-003"],
        )
        
        invalid_decisions = [
            CEOCycleDecision(
                decision="repeat",
                reason="Checked board state, will retry later",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision="repeat",
                reason="Backlog items not ready for dispatch",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision="repeat",
                reason="All items have issues, will monitor",
                mutations=[],
                blocked_items=[],
            ),
        ]
        
        for decision in invalid_decisions:
            assert decision.is_bare_repeat()
            assert not decision.is_valid_zero_todo_decision(), (
                f"Invalid: {decision.reason}"
            )
    
    def test_accepts_outcome_a_promote_to_todo(self):
        """Outcome (a): Promote safe backlog item to todo."""
        decision = CEOCycleDecision(
            decision="repeat",
            reason="Promoted 1 safe unblocked backlog item to todo. Board has BACKLOG-001 ready for dispatch. 2 additional unblocked backlog candidates remain.",
            mutations=[
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "BACKLOG-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
                {
                    "type": "dispatch_selected_work_items",
                    "work_item_ids": ["BACKLOG-001"],
                },
            ],
        )
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_zero_todo_decision()
    
    def test_accepts_outcome_b_patch_config_then_promote(self):
        """Outcome (b): Patch execution config to make candidate safe, then promote."""
        decision = CEOCycleDecision(
            decision="repeat",
            reason="Patched execution_config on BACKLOG-002 to fix missing DATABASE_URL. Promoted to todo and dispatched. Item is now safe.",
            mutations=[
                {
                    "type": "patch_execution_config",
                    "work_item_id": "BACKLOG-002",
                    "patch": {"env": {"DATABASE_URL": "postgres://..."}},
                },
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "BACKLOG-002",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
        )
        
        assert decision.outcome_b_patch_config_then_promote()
        assert decision.is_valid_zero_todo_decision()
    
    def test_accepts_outcome_c_create_and_promote(self):
        """Outcome (c): Create missing work item and promote."""
        decision = CEOCycleDecision(
            decision="repeat",
            reason="No suitable backlog item existed for 'Implement auth service'. Created new work item BACKLOG-NEW via delegate_work_item_generation, promoted to todo, and dispatched.",
            mutations=[
                {
                    "type": "delegate_work_item_generation",
                    "scope": "Implement auth service",
                    "result_id": "BACKLOG-NEW",
                },
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "BACKLOG-NEW",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
        )
        
        assert decision.outcome_c_create_and_promote()
        assert decision.is_valid_zero_todo_decision()
    
    def test_accepts_outcome_d_structured_repeat_with_blocked_reasons(self):
        """Outcome (d): Structured repeat with per-item blockedReason fields."""
        decision = CEOCycleDecision(
            decision="repeat",
            reason="Zero todo items and backlog exists, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: 'BACKLOG-001', workItemTitle: 'Implement auth service', blockedReason: 'Requires upstream API credentials that are not yet provisioned and no workaround exists'}, {workItemId: 'BACKLOG-002', workItemTitle: 'Write tests', blockedReason: 'Blocked by BACKLOG-001 which cannot be dispatched'}]. Manual intervention required.",
            blocked_items=[
                {
                    "workItemId": "BACKLOG-001",
                    "workItemTitle": "Implement auth service",
                    "blockedReason": "Requires upstream API credentials that are not yet provisioned and no workaround exists",
                },
                {
                    "workItemId": "BACKLOG-002",
                    "workItemTitle": "Write tests",
                    "blockedReason": "Blocked by BACKLOG-001 which cannot be dispatched",
                },
            ],
        )
        
        assert decision.outcome_d_structured_repeat()
        assert decision.is_valid_zero_todo_decision()
    
    def test_accepts_blocked_decision_with_ticket_level_blocker(self):
        """Blocked decision with explicit ticket-level blocker is valid."""
        decision = CEOCycleDecision(
            decision="blocked",
            reason="Cannot proceed: Architecture documentation for core services is missing and required before any backend work can begin",
            blocker="Missing: Architecture documentation for core services",
        )
        
        assert decision.decision == "blocked"
        assert decision.blocker is not None
        assert decision.is_valid_zero_todo_decision()
    
    def test_rejects_patch_without_promote(self):
        """
        A config patch without promotion is NOT sufficient for zero-todo mandate.
        
        Outcome (b) requires both patch AND promote.
        """
        decision = CEOCycleDecision(
            decision="repeat",
            reason="Patched execution_config on BACKLOG-001",
            mutations=[
                {
                    "type": "patch_execution_config",
                    "work_item_id": "BACKLOG-001",
                    "patch": {"env": {"MISSING_VAR": "value"}},
                },
            ],
            blocked_items=[],
        )
        
        # Config patch alone is insufficient - must also promote
        assert not decision.outcome_b_patch_config_then_promote()
        assert not decision.is_valid_zero_todo_decision()
    
    def test_rejects_structured_repeat_without_blocked_reasons(self):
        """
        blockedItems array without per-item blockedReason fields is insufficient.
        
        Each item in blockedItems must have a non-empty blockedReason.
        """
        decision = CEOCycleDecision(
            decision="repeat",
            reason="Some backlog items blocked",
            blocked_items=[
                {"workItemId": "BACKLOG-001", "workItemTitle": "Item 1"},
                # Missing blockedReason field
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()
        assert not decision.is_valid_zero_todo_decision()
    
    def test_valid_deterministic_scenario_33_backlog_items(self):
        """
        Deterministic contract test with 33 backlog items (evidence scenario).
        
        Given: 0 todo + 33 unblocked backlog items (autonomous mode)
        Then: Bare `repeat` is NOT valid; valid outcomes are (a), (b), (c), or (d)
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_ids=[f"BACKLOG-{i+1:03d}" for i in range(33)],
        )
        
        assert board.has_zero_todo_with_unblocked_backlog()
        
        # Invalid: The observed protocol violation from live evidence
        invalid_decision = CEOCycleDecision(
            decision="repeat",
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        assert invalid_decision.is_bare_repeat()
        assert not invalid_decision.is_valid_zero_todo_decision()
        
        # Valid alternatives that WOULD satisfy the mandate
        valid_alternatives = [
            # Outcome (a): Promote
            CEOCycleDecision(
                decision="repeat",
                reason="Promoted BACKLOG-001 to todo, dispatched. 32 additional unblocked candidates remain.",
                mutations=[{
                    "type": "patch_work_item_status",
                    "work_item_id": "BACKLOG-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                }],
            ),
            # Outcome (d): Structured repeat
            CEOCycleDecision(
                decision="repeat",
                reason="All 33 items have capacity constraints: only 2 concurrent work items allowed. blockedItems: " + ", ".join([
                    f"{{workItemId: 'BACKLOG-{i+1:03d}', blockedReason: 'Capacity limit reached; 2 items currently executing'}}"
                    for i in range(33)
                ]),
                blocked_items=[
                    {
                        "workItemId": f"BACKLOG-{i+1:03d}",
                        "workItemTitle": f"Item {i+1}",
                        "blockedReason": "Capacity limit reached; 2 items currently executing",
                    }
                    for i in range(33)
                ],
            ),
        ]
        
        for alt in valid_alternatives:
            assert alt.is_valid_zero_todo_decision(), (
                f"Alternative {alt.decision} should be valid for zero-todo + unblocked backlog"
            )
    
    def test_scenario_mixed_blocked_and_unblocked_backlog(self):
        """
        Scenario: Some backlog items blocked, some unblocked.
        
        CEO must either:
        - Promote the unblocked items (outcome a), OR
        - Provide structured repeat with blockedReasons for ALL items (outcome d)
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_ids=["BACKLOG-001", "BACKLOG-002"],
            # BACKLOG-003, 004, 005 are blocked
        )
        
        # Valid: Promote unblocked items
        decision_promote = CEOCycleDecision(
            decision="repeat",
            reason="Promoted 2 unblocked backlog items to todo. 3 blocked items remain: BLOCKED-001 (missing config), BLOCKED-002 (dependency), BLOCKED-003 (dependency).",
            mutations=[
                {"type": "patch_work_item_status", "work_item_id": "BACKLOG-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "BACKLOG-002", "from_status": "backlog", "to_status": "todo"},
            ],
        )
        
        assert decision_promote.outcome_a_promote_to_todo()
        assert decision_promote.is_valid_zero_todo_decision()
        
        # Invalid: Bare repeat with no explanation
        decision_bare = CEOCycleDecision(
            decision="repeat",
            reason="Checked board",
            mutations=[],
            blocked_items=[],
        )
        
        assert decision_bare.is_bare_repeat()
        assert not decision_bare.is_valid_zero_todo_decision()


class TestCEOZeroTodoBacklogPromotionEdgeCases:
    """Edge case tests for the zero-todo backlog promotion mandate."""
    
    def test_non_autonomous_mode_does_not_trigger_mandate(self):
        """
        The mandate only applies in autonomous mode.
        
        In manual/supervised mode, different rules may apply.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_ids=["BACKLOG-001"],
            is_autonomous=False,
        )
        
        # In non-autonomous mode, bare repeat may be acceptable
        # The mandate check should be skipped
        assert not board.is_autonomous
        # No assertion about is_valid_zero_todo_decision - different rules apply
    
    def test_todo_count_zero_but_backlog_count_zero(self):
        """
        When both todo and backlog are 0, different rules apply.
        
        This is a bootstrap gap, not a promotion mandate scenario.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=0,
            unblocked_backlog_ids=[],
        )
        
        assert not board.has_zero_todo_with_unblocked_backlog()
    
    def test_todo_exists_with_backlog(self):
        """
        When todo items exist, the promotion mandate does NOT apply.
        
        The CEO may choose to add more work or leave things as-is.
        """
        board = BoardState(
            todo_count=2,
            backlog_count=10,
            unblocked_backlog_ids=["BACKLOG-001"],
        )
        
        assert board.todo_count > 0
        assert not board.has_zero_todo_with_unblocked_backlog()
        
        # Bare repeat might be acceptable when todo exists
        # But still good practice to be specific


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])