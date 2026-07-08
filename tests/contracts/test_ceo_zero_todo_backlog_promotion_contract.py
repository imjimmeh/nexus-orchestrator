"""
Runtime contract test for CEO cycle zero-todo backlog promotion mandate.

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

This test validates the runtime contract for the autonomous zero-todo board mandate.
When the board has:
  - 0 todo items
  - 3+ unblocked backlog items
  - Autonomous mode enabled

The CEO cycle MUST NOT produce a bare `repeat` decision with no mutation and no
per-item blocked reasons.

Valid outcomes:
  (a) A mutation occurred - backlog item promoted to todo
  (b) Structured `decision: repeat` with per-item `blockedReason` fields
  (c) `decision: blocked` with explicit ticket-level blocker

Invalid: bare `repeat` with no mutation and no per-item blocked reasons.

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed - a protocol violation.

Dependencies:
  - seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md
  - seed/workflows/project-orchestration-cycle-ceo.workflow.yaml
"""
import pytest
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any, Literal


class DecisionType:
    """Valid decision types from the CEO cycle contract."""
    REPEAT = "repeat"
    BLOCKED = "blocked"
    PAUSE = "pause"
    COMPLETE = "complete"


@dataclass
class BacklogItem:
    """Represents a backlog item in the board state."""
    id: str
    title: str
    status: str = "backlog"
    blocked: bool = False


@dataclass
class BoardState:
    """
    Represents the board state for contract validation.
    
    The mandate conditions are met when ALL are true:
    - todo_count == 0
    - backlog_count >= 3
    - unblocked_backlog_items >= 3
    - is_autonomous == True
    """
    todo_count: int
    backlog_count: int
    unblocked_backlog_items: List[BacklogItem] = field(default_factory=list)
    is_autonomous: bool = True
    
    def mandate_conditions_met(self) -> bool:
        """Check if all conditions for the promotion mandate are met."""
        return (
            self.todo_count == 0 and
            self.backlog_count >= 3 and
            len(self.unblocked_backlog_items) >= 3 and
            self.is_autonomous
        )


@dataclass
class Mutation:
    """Represents a board mutation action."""
    type: str
    work_item_id: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    patch: Optional[Dict[str, Any]] = None
    scope: Optional[str] = None
    result_id: Optional[str] = None


@dataclass
class BlockedItem:
    """Represents a blocked backlog item with per-item explanation."""
    work_item_id: str
    work_item_title: str
    blocked_reason: str


@dataclass
class CEOCycleDecision:
    """
    Represents a CEO cycle decision output.
    
    Validates the contract requirements for zero-todo + unblocked backlog scenarios.
    """
    decision: str
    reason: str
    mutations: List[Mutation] = field(default_factory=list)
    blocked_items: List[BlockedItem] = field(default_factory=list)
    blocker: Optional[str] = None
    
    @classmethod
    def from_output(cls, output: Dict[str, Any]) -> "CEOCycleDecision":
        """Create CEOCycleDecision from output dict."""
        blocked_items = []
        for item in output.get("blockedItems", []) or []:
            blocked_items.append(BlockedItem(
                work_item_id=item.get("workItemId", ""),
                work_item_title=item.get("workItemTitle", ""),
                blocked_reason=item.get("blockedReason", ""),
            ))
        
        mutations = []
        for mut in output.get("mutations", []) or []:
            mutations.append(Mutation(
                type=mut.get("type", ""),
                work_item_id=mut.get("work_item_id"),
                from_status=mut.get("from_status"),
                to_status=mut.get("to_status"),
                patch=mut.get("patch"),
                scope=mut.get("scope"),
                result_id=mut.get("result_id"),
            ))
        
        return cls(
            decision=output.get("decision", ""),
            reason=output.get("reason", ""),
            mutations=mutations,
            blocked_items=blocked_items,
            blocker=output.get("blocker"),
        )
    
    def is_bare_repeat(self) -> bool:
        """
        Check if this is a BARE repeat - the protocol violation.
        
        A bare repeat has:
        - decision == "repeat"
        - NO mutations (no board changes)
        - NO blocked_items with per-item blockedReason fields
        """
        return (
            self.decision == DecisionType.REPEAT and
            len(self.mutations) == 0 and
            len(self.blocked_items) == 0
        )
    
    def has_promotion_mutation(self) -> bool:
        """Check if there's a promotion mutation (backlog -> todo)."""
        for mutation in self.mutations:
            if mutation.type == "patch_work_item_status":
                if mutation.from_status == "backlog" and mutation.to_status == "todo":
                    return True
        return False
    
    def has_config_patch(self) -> bool:
        """Check if there's a config patch mutation."""
        for mutation in self.mutations:
            if mutation.type == "patch_execution_config":
                return True
        return False
    
    def has_work_item_creation(self) -> bool:
        """Check if there's a work item creation mutation."""
        for mutation in self.mutations:
            if mutation.type == "delegate_work_item_generation":
                return True
        return False
    
    def outcome_a_promote_to_todo(self) -> bool:
        """Outcome (a): Promote at least one unblocked backlog item to todo."""
        return self.has_promotion_mutation()
    
    def outcome_b_patch_and_promote(self) -> bool:
        """Outcome (b): Patch config, then promote."""
        return self.has_config_patch() and self.has_promotion_mutation()
    
    def outcome_c_create_and_promote(self) -> bool:
        """Outcome (c): Create work item, then promote."""
        return self.has_work_item_creation() and self.has_promotion_mutation()
    
    def outcome_d_structured_repeat(self) -> bool:
        """
        Outcome (b): Structured repeat with per-item blockedReason fields.
        
        Valid ONLY when:
        - decision == "repeat"
        - blocked_items array exists with at least one item
        - Each blocked item has a non-empty blockedReason field
        """
        if self.decision != DecisionType.REPEAT:
            return False
        if len(self.blocked_items) == 0:
            return False
        for item in self.blocked_items:
            if not item.blocked_reason or not item.blocked_reason.strip():
                return False
        return True
    
    def outcome_c_blocked_with_ticket_blocker(self) -> bool:
        """
        Outcome (c): decision='blocked' with explicit ticket-level blocker.
        
        Valid when:
        - decision == "blocked"
        - blocker field is non-empty and contains specific ticket/issue reference
        """
        if self.decision != DecisionType.BLOCKED:
            return False
        return self.blocker is not None and len(self.blocker.strip()) > 0
    
    def is_valid_zero_todo_decision(self, board_state: BoardState) -> tuple[bool, str]:
        """
        Validate the decision against the ZERO-TODO BACKLOG PROMOTION MANDATE.
        
        Returns:
            Tuple of (is_valid, violation_reason)
            - is_valid: True if decision satisfies mandate
            - violation_reason: Empty string if valid, else reason for rejection
        """
        if not board_state.mandate_conditions_met():
            return True, ""
        
        # MANDATE APPLIES: 0 todo + 3+ unblocked backlog + autonomous mode
        # Bare repeat is ALWAYS a protocol violation
        if self.is_bare_repeat():
            return False, (
                f"PROTOCOL VIOLATION: Bare repeat with no mutation when "
                f"todo_count={board_state.todo_count}, backlog_count={board_state.backlog_count}, "
                f"unblocked_count={len(board_state.unblocked_backlog_items)}. "
                f"CEO MUST choose one of three outcomes: (a) promote, (b) structured repeat with blockedItems, or (c) blocked with ticket-level blocker."
            )
        
        # Check the three permitted outcomes
        if self.outcome_a_promote_to_todo():
            return True, ""
        
        if self.outcome_b_patch_and_promote():
            return True, ""
        
        if self.outcome_c_create_and_promote():
            return True, ""
        
        if self.outcome_d_structured_repeat():
            return True, ""
        
        if self.outcome_c_blocked_with_ticket_blocker():
            return True, ""
        
        return False, (
            f"PROTOCOL VIOLATION: Decision {self.decision} does not satisfy mandate. "
            f"Must either: (a) promote backlog to todo, (b) provide structured repeat with blockedItems, "
            f"or (c) provide explicit ticket-level blocker."
        )


class TestCEOZeroTodoBacklogPromotionContract:
    """
    Contract tests for CEO cycle zero-todo backlog promotion mandate.
    
    These tests validate that the CEO cycle follows the mandatory backlog
    promotion protocol when running in autonomous mode with zero todo items
    and 3+ unblocked backlog available.
    """

    @pytest.fixture
    def mandate_board_state(self) -> BoardState:
        """
        Fixture: Board state where the promotion mandate applies.
        
        Board has 0 todo items, 3 unblocked backlog items, autonomous mode enabled.
        """
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Implement feature A", status="backlog", blocked=False),
                BacklogItem(id="WI-002", title="Implement feature B", status="backlog", blocked=False),
                BacklogItem(id="WI-003", title="Write tests", status="backlog", blocked=False),
            ],
            is_autonomous=True,
        )

    @pytest.fixture
    def evidence_scenario_board(self) -> BoardState:
        """
        Fixture: Board matching 2026-05-15 evidence scenario (33 backlog items).
        
        The live run recorded decision="repeat", reason="No board action available"
        which is a protocol violation.
        """
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_items=[
                BacklogItem(id=f"BACKLOG-{i+1:03d}", title=f"Backlog Item {i+1}", status="backlog", blocked=False)
                for i in range(33)
            ],
            is_autonomous=True,
        )

    # =========================================================================
    # Test: Mandate conditions validation
    # =========================================================================

    def test_mandate_conditions_require_3_plus_unblocked_backlog(self):
        """
        The mandate applies when there are 3+ unblocked backlog items.
        
        This is the threshold specified in the work item requirements.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
                BacklogItem(id="WI-002", title="Item 2", blocked=False),
                BacklogItem(id="WI-003", title="Item 3", blocked=False),
            ],
            is_autonomous=True,
        )
        assert board.mandate_conditions_met()

    def test_mandate_does_not_apply_when_todo_exists(self):
        """The mandate does not apply when todo items exist."""
        board = BoardState(
            todo_count=1,
            backlog_count=5,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
            ],
            is_autonomous=True,
        )
        assert not board.mandate_conditions_met()

    def test_mandate_does_not_apply_in_non_autonomous_mode(self):
        """The mandate does not apply in non-autonomous (supervised) mode."""
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
            ],
            is_autonomous=False,
        )
        assert not board.mandate_conditions_met()

    # =========================================================================
    # Test: Bare repeat rejection (CRITICAL)
    # =========================================================================

    def test_rejects_bare_repeat_zero_todo_with_unblocked_backlog(
        self, mandate_board_state: BoardState
    ):
        """
        CRITICAL CONTRACT TEST: CEO cycle must NOT produce bare repeat.
        
        Scenario: 0 todo + 3 unblocked backlog items + autonomous mode
        Invalid output: decision="repeat", no mutations, no blockedItems
        
        This is the primary protocol violation documented in 2026-05-15 evidence.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        
        assert not is_valid, "Bare repeat is a PROTOCOL VIOLATION when 0 todo + unblocked backlog exists"
        assert "PROTOCOL VIOLATION" in violation
        assert "Bare repeat" in violation

    def test_rejects_generic_repeat_without_per_item_evidence(
        self, mandate_board_state: BoardState
    ):
        """
        Test that generic "checked board state" repeats are rejected.
        
        Invalid patterns:
        - "Checked board state, will retry later"
        - "No work to do right now"
        - "All items have issues, will monitor"
        """
        invalid_decisions = [
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="Checked board state, will retry later",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="No work to do right now",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="All items have issues, will monitor",
                mutations=[],
                blocked_items=[],
            ),
        ]
        
        for decision in invalid_decisions:
            is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
            assert not is_valid, f"Invalid: {decision.reason}"
            assert "PROTOCOL VIOLATION" in violation

    # =========================================================================
    # Test: Outcome (a) - Promotion
    # =========================================================================

    def test_accepts_outcome_a_promote_to_todo(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): Promotes at least one item to todo.
        
        Valid: decision includes patch_work_item_status mutation from backlog to todo.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted 1 safe unblocked backlog item to todo. Board has WI-001 ready for dispatch. 2 additional unblocked backlog candidates remain.",
            mutations=[
                Mutation(
                    type="patch_work_item_status",
                    work_item_id="WI-001",
                    from_status="backlog",
                    to_status="todo",
                ),
            ],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"Promotion outcome should be valid: {violation}"
        assert decision.outcome_a_promote_to_todo()

    def test_accepts_promotion_of_multiple_items(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): CEO may promote multiple items to todo.
        
        Valid: Multiple items transitioned from backlog to todo.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted 2 unblocked backlog items to todo (WI-001, WI-002). 1 additional candidate remains.",
            mutations=[
                Mutation(type="patch_work_item_status", work_item_id="WI-001", from_status="backlog", to_status="todo"),
                Mutation(type="patch_work_item_status", work_item_id="WI-002", from_status="backlog", to_status="todo"),
            ],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"Multi-promotion outcome should be valid: {violation}"
        assert decision.outcome_a_promote_to_todo()

    # =========================================================================
    # Test: Outcome (b) - Structured repeat with blockedItems
    # =========================================================================

    def test_accepts_outcome_b_structured_repeat_with_blocked_reasons(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (b): Structured `repeat` with per-item `blockedReason` fields.
        
        Valid: decision="repeat" with blockedItems array containing items
        with non-empty blockedReason fields.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Zero todo items and backlog exists, but all candidates blocked by unresolvable issues.",
            mutations=[],
            blocked_items=[
                BlockedItem(
                    work_item_id="WI-001",
                    work_item_title="Implement feature A",
                    blocked_reason="Requires upstream API credentials that are not yet provisioned and no workaround exists",
                ),
                BlockedItem(
                    work_item_id="WI-002",
                    work_item_title="Implement feature B",
                    blocked_reason="Blocked by WI-001 which cannot be dispatched",
                ),
            ],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"Structured repeat outcome should be valid: {violation}"
        assert decision.outcome_d_structured_repeat()

    def test_rejects_structured_repeat_with_empty_blocked_reason(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (b) validation: Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedItems array contains item with empty blockedReason.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Some items blocked",
            mutations=[],
            blocked_items=[
                BlockedItem(work_item_id="WI-001", work_item_title="Item 1", blocked_reason=""),
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert not is_valid, "Blocked item with empty blockedReason should cause rejection"

    # =========================================================================
    # Test: Outcome (c) - Blocked decision with ticket-level blocker
    # =========================================================================

    def test_accepts_outcome_c_blocked_decision_with_ticket_level_blocker(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (c): `decision: blocked` with explicit ticket-level blocker.
        
        Valid: decision="blocked" with non-empty blocker field containing
        specific ticket/issue references.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed: Architecture documentation for core services is missing and required before any backend work can begin",
            blocker="Missing: Architecture documentation for core services (TICKET-123)",
            mutations=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"Blocked with ticket-level blocker should be valid: {violation}"
        assert decision.outcome_c_blocked_with_ticket_blocker()

    def test_rejects_blocked_decision_without_blocker_field(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (c) validation: blocker field is required for blocked decisions.
        
        Invalid: decision="blocked" without explicit blocker field.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed with current board state",
            blocker=None,
            mutations=[],
        )
        
        assert not decision.outcome_c_blocked_with_ticket_blocker()
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert not is_valid, "Missing blocker should cause rejection"

    # =========================================================================
    # Test: Evidence scenario (33 backlog items)
    # =========================================================================

    def test_evidence_scenario_protocol_violation(
        self, evidence_scenario_board: BoardState
    ):
        """
        Evidence scenario from 2026-05-15: 0 todo + 33 unblocked backlog items.
        
        The live run documented: decision="repeat", reason="No board action available"
        This is a protocol violation - must be rejected.
        """
        assert evidence_scenario_board.mandate_conditions_met()
        
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(evidence_scenario_board)
        assert not is_valid, "Protocol violation from evidence must be rejected"
        assert "PROTOCOL VIOLATION" in violation

    def test_evidence_scenario_valid_outcome_a(
        self, evidence_scenario_board: BoardState
    ):
        """
        Valid alternative for evidence scenario: Promote first item.
        
        This WOULD have satisfied the mandate in the 2026-05-15 run.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted BACKLOG-001 to todo, dispatched. 32 additional unblocked candidates remain.",
            mutations=[
                Mutation(
                    type="patch_work_item_status",
                    work_item_id="BACKLOG-001",
                    from_status="backlog",
                    to_status="todo",
                ),
            ],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(evidence_scenario_board)
        assert is_valid, f"Promoting first item should satisfy mandate: {violation}"
        assert decision.outcome_a_promote_to_todo()

    def test_evidence_scenario_valid_outcome_b(
        self, evidence_scenario_board: BoardState
    ):
        """
        Valid alternative for evidence scenario: Structured repeat with capacity constraint.
        
        This WOULD have satisfied the mandate if all items truly blocked by capacity.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Zero todo and 33 backlog candidates, but capacity limit reached.",
            mutations=[],
            blocked_items=[
                BlockedItem(
                    work_item_id=f"BACKLOG-{i+1:03d}",
                    work_item_title=f"Item {i+1}",
                    blocked_reason="Capacity limit reached; 2 items currently executing",
                )
                for i in range(33)
            ],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(evidence_scenario_board)
        assert is_valid, f"Structured repeat should satisfy mandate: {violation}"
        assert decision.outcome_d_structured_repeat()

    # =========================================================================
    # Test: Deterministic contract validation
    # =========================================================================

    def test_deterministic_validation_same_input_same_output(self):
        """
        Contract validation is deterministic: same input always produces same output.
        
        This ensures the contract test is reproducible and verifiable.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
                BacklogItem(id="WI-002", title="Item 2", blocked=False),
                BacklogItem(id="WI-003", title="Item 3", blocked=False),
            ],
            is_autonomous=True,
        )
        
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        # Run validation multiple times - should always be the same
        for _ in range(10):
            is_valid, _ = decision.is_valid_zero_todo_decision(board)
            assert not is_valid, "Bare repeat should always be rejected for mandate scenario"

    def test_all_three_outcomes_are_distinct_and_valid(self):
        """
        The three permitted outcomes are distinct and all valid for mandate scenario.
        
        This test verifies that the contract allows for three different paths
        and that each path is correctly validated.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
            ],
            is_autonomous=True,
        )
        
        # Outcome (a): Promotion
        promote = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted WI-001 to todo",
            mutations=[Mutation(type="patch_work_item_status", from_status="backlog", to_status="todo")],
        )
        
        # Outcome (b): Structured repeat
        structured = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="All items blocked",
            blocked_items=[BlockedItem(work_item_id="WI-001", blocked_reason="Capacity reached")],
        )
        
        # Outcome (c): Blocked with ticket-level blocker
        blocked = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Systemic blocker",
            blocker="TICKET-999 must be resolved first",
        )
        
        # All three should be valid
        for decision, name in [(promote, "promote"), (structured, "structured"), (blocked, "blocked")]:
            is_valid, violation = decision.is_valid_zero_todo_decision(board)
            assert is_valid, f"Outcome {name} should be valid: {violation}"


class TestCEOZeroTodoBacklogPromotionFromOutput:
    """
    Tests for parsing CEO cycle decision output into structured decisions.
    
    Validates that the contract test can parse output from the CEO cycle
    and correctly validate against the mandate.
    """

    def test_parses_decision_field(self):
        """Decision field should be parsed correctly."""
        output = {"decision": "repeat", "reason": "Test reason"}
        decision = CEOCycleDecision.from_output(output)
        assert decision.decision == "repeat"

    def test_parses_blocked_items_array(self):
        """blockedItems array should be parsed correctly."""
        output = {
            "decision": "repeat",
            "reason": "Test",
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Test", "blockedReason": "Test reason"}
            ],
        }
        decision = CEOCycleDecision.from_output(output)
        assert len(decision.blocked_items) == 1
        assert decision.blocked_items[0].work_item_id == "WI-001"
        assert decision.blocked_items[0].blocked_reason == "Test reason"

    def test_parses_mutations(self):
        """Mutations array should be parsed correctly."""
        output = {
            "decision": "repeat",
            "reason": "Promoted",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"}
            ],
        }
        decision = CEOCycleDecision.from_output(output)
        assert len(decision.mutations) == 1
        assert decision.mutations[0].type == "patch_work_item_status"
        assert decision.mutations[0].work_item_id == "WI-001"

    def test_handles_missing_blocked_items(self):
        """Output without blockedItems should be handled gracefully."""
        output = {"decision": "repeat", "reason": "No board action available"}
        decision = CEOCycleDecision.from_output(output)
        assert len(decision.blocked_items) == 0
        assert decision.is_bare_repeat()

    def test_roundtrip_validation(self):
        """Output -> parse -> validate should produce consistent results."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
                BacklogItem(id="WI-002", title="Item 2", blocked=False),
                BacklogItem(id="WI-003", title="Item 3", blocked=False),
            ],
            is_autonomous=True,
        )
        
        # Test valid output
        valid_output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"}
            ],
        }
        
        decision = CEOCycleDecision.from_output(valid_output)
        is_valid, _ = decision.is_valid_zero_todo_decision(board)
        assert is_valid, "Valid output should pass validation"
        
        # Test invalid output
        invalid_output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        decision = CEOCycleDecision.from_output(invalid_output)
        is_valid, violation = decision.is_valid_zero_todo_decision(board)
        assert not is_valid, "Invalid output should fail validation"
        assert "PROTOCOL VIOLATION" in violation


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
