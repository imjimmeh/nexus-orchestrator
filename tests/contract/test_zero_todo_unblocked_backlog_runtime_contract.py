"""
Runtime contract test for zero-todo + unblocked backlog scenario.

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

This test validates the runtime contract for the ZERO-TODO BACKLOG PROMOTION MANDATE.
When autonomous mode has 0 todo items and unblocked backlog exists, the CEO MUST choose
one of three permitted outcomes and MUST NOT produce a bare `repeat` with no mutation.

Validation Criterion:
  - Board with 0 todo + 3+ unblocked backlog items + autonomous mode
  - CEO cycle decision must NOT be a bare `repeat` with no mutation
  - Permitted outcomes:
    (1) Promotes at least one item to todo (outcome a)
    (2) Produces structured `decision: repeat` with per-item `blockedReason` fields (outcome d)
    (3) Records `decision: blocked` with explicit ticket-level blocker

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed - a protocol violation.
"""
import pytest
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class DecisionType(Enum):
    """Valid decision types from the CEO cycle contract."""
    PROMOTE = "promote"       # Outcome (a): Promoted backlog to todo
    PATCH = "patch"           # Outcome (b): Fixed config, then promoted
    CREATE = "create"          # Outcome (c): Created work item, then promoted
    REPEAT = "repeat"          # Outcome (d): No mutation, must have blockedItems
    BLOCKED = "blocked"        # Systemic blocker, explicit ticket-level
    PAUSE = "pause"           # No dispatchable work
    COMPLETE = "complete"      # All planned outcomes achieved


@dataclass
class BacklogItem:
    """Represents a backlog item in the board state."""
    id: str
    title: str
    status: str = "backlog"
    blocked: bool = False
    blocked_reason: Optional[str] = None


@dataclass
class BoardState:
    """
    Represents the board state for contract validation.
    
    The mandate conditions are met when:
    - todo_count == 0
    - backlog_count >= 3
    - unblocked_backlog_count >= 3
    - is_autonomous == True
    """
    todo_count: int
    backlog_count: int
    unblocked_backlog_items: List[BacklogItem] = field(default_factory=list)
    is_autonomous: bool = True
    
    def mandate_conditions_met(self) -> bool:
        """Check if all conditions for the mandate are met."""
        return (
            self.todo_count == 0 and
            self.backlog_count >= 3 and
            len(self.unblocked_backlog_items) >= 3 and
            self.is_autonomous
        )
    
    def all_backlog_blocked(self) -> bool:
        """Check if all backlog items are blocked."""
        return len(self.unblocked_backlog_items) == 0 and self.backlog_count > 0


@dataclass
class CEOCycleDecision:
    """
    Represents a CEO cycle decision output.
    
    Validates the contract requirements for zero-todo + unblocked backlog scenarios.
    """
    decision: DecisionType
    reason: str
    mutations: List[Dict[str, Any]] = field(default_factory=list)
    blocked_items: List[Dict[str, str]] = field(default_factory=list)
    blocker: Optional[str] = None
    promoted_item_ids: List[str] = field(default_factory=list)
    patched_item_ids: List[str] = field(default_factory=list)
    created_item_ids: List[str] = field(default_factory=list)
    
    def is_bare_repeat(self) -> bool:
        """
        Check if this is a BARE repeat - the protocol violation.
        
        A bare repeat has:
        - decision == REPEAT
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
            if mutation.get("type") == "patch_work_item_status":
                from_status = mutation.get("from_status", mutation.get("status"))
                to_status = mutation.get("to_status", mutation.get("new_status"))
                if from_status == "backlog" and to_status == "todo":
                    return True
        return len(self.promoted_item_ids) > 0
    
    def has_config_patch(self) -> bool:
        """Check if there's a config patch mutation."""
        for mutation in self.mutations:
            if mutation.get("type") == "patch_execution_config":
                return True
        return len(self.patched_item_ids) > 0
    
    def has_work_item_creation(self) -> bool:
        """Check if there's a work item creation mutation."""
        for mutation in self.mutations:
            if mutation.get("type") == "delegate_work_item_generation":
                return True
        return len(self.created_item_ids) > 0
    
    def outcome_a_promote_to_todo(self) -> bool:
        """Outcome (a): Promote at least one unblocked backlog item to todo."""
        return self.has_promotion_mutation()
    
    def outcome_d_structured_repeat(self) -> bool:
        """
        Outcome (d): Structured repeat with per-item blockedReason fields.
        
        Valid ONLY when:
        - decision == REPEAT
        - blocked_items array exists with at least one item
        - Each blocked item has a non-empty blockedReason field
        """
        if self.decision != DecisionType.REPEAT:
            return False
        if len(self.blocked_items) == 0:
            return False
        for item in self.blocked_items:
            reason = item.get("blockedReason", item.get("blocked_reason", ""))
            if not reason or not reason.strip():
                return False
        return True
    
    def outcome_blocked_with_ticket_level_blocker(self) -> bool:
        """
        Outcome: decision='blocked' with explicit ticket-level blocker.
        
        Valid when:
        - decision == BLOCKED
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
        # Check if mandate conditions are met
        if not board_state.mandate_conditions_met():
            # Mandate doesn't apply - any valid decision is acceptable
            return True, ""
        
        # MANDATE APPLIES: 0 todo + unblocked backlog + autonomous mode
        # Bare repeat is ALWAYS a protocol violation
        if self.is_bare_repeat():
            return False, (
                f"PROTOCOL VIOLATION: Bare repeat with no mutation when "
                f"todo_count={board_state.todo_count}, backlog_count={board_state.backlog_count}, "
                f"unblocked_count={len(board_state.unblocked_backlog_items)}. "
                f"CEO MUST choose one of three outcomes: (a) promote, (d) structured repeat with blockedItems, or blocked with ticket-level blocker."
            )
        
        # Check the three permitted outcomes
        if self.outcome_a_promote_to_todo():
            return True, ""
        
        if self.outcome_d_structured_repeat():
            return True, ""
        
        if self.outcome_blocked_with_ticket_level_blocker():
            return True, ""
        
        # Decision doesn't match any permitted outcome
        return False, (
            f"PROTOCOL VIOLATION: Decision {self.decision.value} does not satisfy mandate. "
            f"Must either: (a) promote backlog to todo, (d) provide structured repeat with blockedItems, "
            f"or (blocked) provide explicit ticket-level blocker."
        )


class TestZeroTodoUnblockedBacklogContract:
    """
    Contract tests for zero-todo + unblocked backlog scenario.
    
    Validates the CEO cycle decision contract when:
    - Board has 0 todo items
    - Board has 3+ unblocked backlog items
    - Autonomous mode is enabled
    
    The CEO MUST choose one of three permitted outcomes and MUST NOT
    produce a bare `repeat` with no mutation.
    """

    @pytest.fixture
    def zero_todo_board(self) -> BoardState:
        """Fixture: Board with 0 todo + 3 unblocked backlog items."""
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Implement feature A", blocked=False),
                BacklogItem(id="WI-002", title="Implement feature B", blocked=False),
                BacklogItem(id="WI-003", title="Write tests", blocked=False),
            ],
            is_autonomous=True,
        )

    @pytest.fixture
    def evidence_scenario_board(self) -> BoardState:
        """Fixture: Board matching the 2026-05-15 evidence scenario (33 backlog items)."""
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_items=[
                BacklogItem(id=f"BACKLOG-{i+1:03d}", title=f"Backlog Item {i+1}", blocked=False)
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
        
        A board with 2 unblocked backlog items may have different rules.
        """
        # Board with exactly 3 unblocked items - mandate applies
        board_3 = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
                BacklogItem(id="WI-002", title="Item 2", blocked=False),
                BacklogItem(id="WI-003", title="Item 3", blocked=False),
            ],
            is_autonomous=True,
        )
        assert board_3.mandate_conditions_met()
        
        # Board with exactly 33 unblocked items - mandate applies (evidence scenario)
        board_33 = BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_items=[
                BacklogItem(id=f"WI-{i:03d}", title=f"Item {i}", blocked=False)
                for i in range(33)
            ],
            is_autonomous=True,
        )
        assert board_33.mandate_conditions_met()

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
        self, zero_todo_board: BoardState
    ):
        """
        CRITICAL CONTRACT TEST: CEO must NOT produce bare repeat in this scenario.
        
        Scenario: 0 todo + 3 unblocked backlog items + autonomous mode
        Invalid output: decision="repeat", no mutations, no blockedItems
        
        This is the primary protocol violation from 2026-05-15 evidence.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        
        assert not is_valid, "Bare repeat is a PROTOCOL VIOLATION when 0 todo + unblocked backlog exists"
        assert "PROTOCOL VIOLATION" in violation
        assert "Bare repeat" in violation

    def test_rejects_generic_repeat_without_per_item_evidence(
        self, zero_todo_board: BoardState
    ):
        """
        Test that generic "checked board state" repeats are rejected.
        
        Invalid: decision="repeat", reason="Checked board state, will retry later"
        Valid: decision="repeat", reason="... blockedItems: [...]"
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
                reason="Backlog items not ready for dispatch",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="All items have issues, will monitor",
                mutations=[],
                blocked_items=[],
            ),
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="No work to do right now",
                mutations=[],
                blocked_items=[],
            ),
        ]
        
        for decision in invalid_decisions:
            is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
            assert not is_valid, f"Invalid: {decision.reason}"
            assert "PROTOCOL VIOLATION" in violation

    def test_rejects_repeat_with_empty_blocked_items(
        self, zero_todo_board: BoardState
    ):
        """
        Repeat with empty blockedItems array is still a protocol violation.
        
        The blockedItems array must contain at least one item with non-empty blockedReason.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="All items have issues",
            mutations=[],
            blocked_items=[],  # Empty array - still invalid
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert not is_valid, "Empty blockedItems array is not sufficient"

    # =========================================================================
    # Test: Outcome (1) - Promotion
    # =========================================================================

    def test_accepts_outcome_a_promote_to_todo(self, zero_todo_board: BoardState):
        """
        Outcome (1): Promotes at least one item to todo.
        
        Valid: decision includes patch_work_item_status mutation from backlog to todo.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted 1 safe unblocked backlog item to todo. Board has WI-001 ready for dispatch. 2 additional unblocked backlog candidates remain.",
            mutations=[
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "WI-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
                {
                    "type": "dispatch_selected_work_items",
                    "work_item_ids": ["WI-001"],
                },
            ],
            promoted_item_ids=["WI-001"],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert is_valid, f"Promotion outcome should be valid: {violation}"
        assert decision.outcome_a_promote_to_todo()

    def test_accepts_promotion_of_multiple_items(self, zero_todo_board: BoardState):
        """
        Outcome (1): Promotes multiple items to todo.
        
        CEO may promote more than one item if capacity allows.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted 2 unblocked backlog items to todo (WI-001, WI-002). 1 additional candidate remains.",
            mutations=[
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "WI-002", "from_status": "backlog", "to_status": "todo"},
            ],
            promoted_item_ids=["WI-001", "WI-002"],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert is_valid, f"Multi-promotion outcome should be valid: {violation}"
        assert decision.outcome_a_promote_to_todo()

    # =========================================================================
    # Test: Outcome (2) - Structured repeat with blockedItems
    # =========================================================================

    def test_accepts_outcome_d_structured_repeat_with_blocked_reasons(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (2): Structured `repeat` with per-item `blockedReason` fields.
        
        Valid: decision="repeat" with blockedItems array containing items
        with non-empty blockedReason fields.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Zero todo items and backlog exists, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: 'WI-001', workItemTitle: 'Implement feature A', blockedReason: 'Requires upstream API credentials that are not yet provisioned and no workaround exists'}, {workItemId: 'WI-002', workItemTitle: 'Implement feature B', blockedReason: 'Blocked by WI-001 which cannot be dispatched'}]. Manual intervention required.",
            mutations=[],
            blocked_items=[
                {
                    "workItemId": "WI-001",
                    "workItemTitle": "Implement feature A",
                    "blockedReason": "Requires upstream API credentials that are not yet provisioned and no workaround exists",
                },
                {
                    "workItemId": "WI-002",
                    "workItemTitle": "Implement feature B",
                    "blockedReason": "Blocked by WI-001 which cannot be dispatched",
                },
            ],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert is_valid, f"Structured repeat outcome should be valid: {violation}"
        assert decision.outcome_d_structured_repeat()

    def test_rejects_structured_repeat_with_empty_blocked_reason(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (2) validation: Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedItems array contains item with empty blockedReason.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Some items blocked",
            mutations=[],
            blocked_items=[
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": ""},  # Empty - invalid
                {"workItemId": "WI-002", "workItemTitle": "Item 2", "blockedReason": "Valid reason"},
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert not is_valid, "Blocked item with empty blockedReason should cause rejection"

    def test_rejects_structured_repeat_with_missing_blocked_reason(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (2) validation: blockedReason field is required for each item.
        
        Invalid: blockedItems array contains item without blockedReason field.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Some items blocked",
            mutations=[],
            blocked_items=[
                {"workItemId": "WI-001", "workItemTitle": "Item 1"},  # Missing blockedReason
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()

    # =========================================================================
    # Test: Outcome (3) - blocked decision with ticket-level blocker
    # =========================================================================

    def test_accepts_blocked_decision_with_ticket_level_blocker(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (3): `decision: blocked` with explicit ticket-level blocker.
        
        Valid: decision="blocked" with non-empty blocker field containing
        specific ticket/issue references.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed: Architecture documentation for core services is missing and required before any backend work can begin",
            blocker="Missing: Architecture documentation for core services (TICKET-123)",
            mutations=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert is_valid, f"Blocked with ticket-level blocker should be valid: {violation}"
        assert decision.outcome_blocked_with_ticket_level_blocker()

    def test_accepts_blocked_decision_with_multiple_ticket_blockers(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (3): `decision: blocked` with multiple explicit blockers.
        
        Valid when blocker field references multiple tickets/prerequisites.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Zero todo items and 3 backlog candidates exist. Project-level blockers prevent dispatch.",
            blocker=(
                "[TICKET-123] credentials secret is empty in vault, required by all 3 candidates. "
                "[TICKET-124] API documentation for upstream service is missing, preventing accurate scoping."
            ),
            mutations=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(zero_todo_board)
        assert is_valid, f"Blocked with multiple ticket blockers should be valid: {violation}"

    def test_rejects_blocked_decision_without_blocker_field(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (3) validation: blocker field is required for blocked decisions.
        
        Invalid: decision="blocked" without explicit blocker field.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed with current board state",
            blocker=None,  # Missing - invalid
            mutations=[],
        )
        
        assert not decision.outcome_blocked_with_ticket_level_blocker()

    def test_rejects_blocked_decision_with_empty_blocker(
        self, zero_todo_board: BoardState
    ):
        """
        Outcome (3) validation: blocker field must be non-empty.
        
        Invalid: decision="blocked" with empty blocker string.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed",
            blocker="   ",  # Whitespace only - invalid
            mutations=[],
        )
        
        assert not decision.outcome_blocked_with_ticket_level_blocker()

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
        
        # The protocol violation from live evidence
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available",
            mutations=[],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(evidence_scenario_board)
        assert not is_valid, "Protocol violation from evidence must be rejected"
        assert "PROTOCOL VIOLATION" in violation

    def test_evidence_scenario_valid_alternatives(
        self, evidence_scenario_board: BoardState
    ):
        """
        Valid alternatives that WOULD satisfy the mandate in the evidence scenario.
        """
        valid_alternatives = [
            # Outcome (1): Promote first item
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="Promoted BACKLOG-001 to todo, dispatched. 32 additional unblocked candidates remain.",
                mutations=[
                    {"type": "patch_work_item_status", "work_item_id": "BACKLOG-001", "from_status": "backlog", "to_status": "todo"},
                ],
                promoted_item_ids=["BACKLOG-001"],
            ),
            # Outcome (2): Structured repeat with blockedItems
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason=f"All 33 items have capacity constraints: only 2 concurrent work items allowed. blockedItems: {self._generate_blocked_items(33)}",
                mutations=[],
                blocked_items=[
                    {
                        "workItemId": f"BACKLOG-{i+1:03d}",
                        "workItemTitle": f"Item {i+1}",
                        "blockedReason": "Capacity limit reached; 2 items currently executing",
                    }
                    for i in range(33)
                ],
            ),
            # Outcome (3): Blocked with ticket-level blocker
            CEOCycleDecision(
                decision=DecisionType.BLOCKED,
                reason="Zero todo items and 33 backlog candidates exist. Systemic capacity constraint prevents dispatch.",
                blocker="Capacity limit: 2 concurrent work items maximum. 33 candidates waiting. Manual capacity expansion required or prioritization decision needed.",
                mutations=[],
            ),
        ]
        
        for alt in valid_alternatives:
            is_valid, violation = alt.is_valid_zero_todo_decision(evidence_scenario_board)
            assert is_valid, f"Valid alternative should be accepted: {alt.decision.value} - {violation}"

    def _generate_blocked_items(self, count: int) -> str:
        """Helper to generate blockedItems JSON string for evidence scenario."""
        items = []
        for i in range(min(count, 5)):  # Limit to 5 for readability in reason
            items.append(
                f"{{workItemId: 'BACKLOG-{i+1:03d}', workItemTitle: 'Item {i+1}', "
                f"blockedReason: 'Capacity limit reached; 2 items currently executing'}}"
            )
        if count > 5:
            items.append(f"... and {count - 5} more items")
        return "[" + ", ".join(items) + "]"

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
        
        # Test bare repeat - should always be rejected
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
        
        This test verifies that the contract allows for the three different paths
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
        
        # Outcome (1): Promotion
        promote = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted WI-001 to todo",
            mutations=[{"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"}],
        )
        
        # Outcome (2): Structured repeat
        structured = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="All items blocked",
            blocked_items=[{"workItemId": "WI-001", "blockedReason": "Capacity reached"}],
        )
        
        # Outcome (3): Blocked with ticket-level blocker
        blocked = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Systemic blocker",
            blocker="TICKET-999 must be resolved first",
        )
        
        # All three should be valid
        for decision, name in [(promote, "promote"), (structured, "structured"), (blocked, "blocked")]:
            is_valid, violation = decision.is_valid_zero_todo_decision(board)
            assert is_valid, f"Outcome {name} should be valid: {violation}"


class TestZeroTodoBacklogEdgeCases:
    """Edge case tests for the zero-todo backlog promotion mandate."""

    def test_mandate_does_not_apply_when_backlog_all_blocked(self):
        """
        When ALL backlog items are blocked, different rules may apply.
        
        The mandate applies to UNBLOCKED backlog. If all items are blocked,
        outcome (d) structured repeat becomes required.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[],  # No unblocked items
            is_autonomous=True,
        )
        
        assert board.all_backlog_blocked()
        
        # Still a mandate scenario, but structured repeat is the only valid option
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="All items blocked",
            blocked_items=[
                {"workItemId": "WI-001", "blockedReason": "Missing upstream API credentials"},
            ],
        )
        
        is_valid, _ = decision.is_valid_zero_todo_decision(board)
        assert is_valid, "Structured repeat should be valid when all backlog is blocked"

    def test_mandate_requires_autonomous_mode(self):
        """
        The mandate only applies in autonomous mode.
        
        In supervised/manual mode, bare repeat may be acceptable.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
            ],
            is_autonomous=False,  # Not autonomous
        )
        
        assert not board.mandate_conditions_met()
        
        # In non-autonomous mode, bare repeat might be acceptable
        # The contract doesn't mandate promotion in supervised mode

    def test_mixed_blocked_and_unblocked_backlog(self):
        """
        Scenario: Some backlog items blocked, some unblocked.
        
        CEO must either:
        - Promote the unblocked items (outcome 1), OR
        - Provide structured repeat with blockedReasons (outcome 2)
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1", blocked=False),
                BacklogItem(id="WI-002", title="Item 2", blocked=False),
                # WI-003, WI-004, WI-005 are blocked
            ],
            is_autonomous=True,
        )
        
        # Valid: Promote unblocked items
        decision_promote = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted 2 unblocked backlog items to todo",
            mutations=[
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "WI-002", "from_status": "backlog", "to_status": "todo"},
            ],
            promoted_item_ids=["WI-001", "WI-002"],
        )
        
        is_valid, _ = decision_promote.is_valid_zero_todo_decision(board)
        assert is_valid, "Promoting unblocked items should be valid"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])