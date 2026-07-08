"""
Runtime contract test for autonomous cycle behavior.

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

This test validates the runtime contract for autonomous cycle behavior when the board
has zero todo items and unblocked backlog. The CEO cycle MUST NOT produce a bare
`repeat` decision with no mutation and no per-item explanation.

Test Assertions:
  Given a board with:
    - todo_count == 0
    - backlog_count >= 3
    - unblocked backlog items exist (at least 3)
    - is_autonomous == True

  The CEO cycle decision MUST NOT be a bare `repeat` with no mutation.
  
  The CEO cycle MUST choose one of these outcomes:
    (a) Promote: At least one item promoted from backlog to todo
    (b) Structured repeat: decision="repeat" with per-item blockedReason fields
    (c) Blocked: decision="blocked" with explicit ticket-level blocker

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed—a protocol violation.

Dependencies:
  - seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md
  - seed/workflows/project-orchestration-cycle-ceo.workflow.yaml
"""
import pytest
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


class DecisionType:
    """Valid decision types from the CEO cycle contract."""
    PROMOTE = "promote"       # Outcome (a): Promoted backlog to todo
    PATCH = "patch"          # Outcome (b): Fixed config, then promoted
    CREATE = "create"         # Outcome (c): Created work item, then promoted
    REPEAT = "repeat"         # Outcome (d): No mutation, must have blockedItems
    BLOCKED = "blocked"       # Systemic blocker, explicit ticket-level
    PAUSE = "pause"          # No dispatchable work
    COMPLETE = "complete"    # All planned outcomes achieved


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
        # Parse blockedItems
        blocked_items = []
        for item in output.get("blockedItems", []) or []:
            blocked_items.append(BlockedItem(
                work_item_id=item.get("workItemId", ""),
                work_item_title=item.get("workItemTitle", ""),
                blocked_reason=item.get("blockedReason", ""),
            ))
        
        # Parse mutations
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
        Outcome (d): Structured repeat with per-item blockedReason fields.
        
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
    
    def outcome_blocked_with_ticket_level_blocker(self) -> bool:
        """
        Outcome: decision='blocked' with explicit ticket-level blocker.
        
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
        
        if self.outcome_b_patch_and_promote():
            return True, ""
        
        if self.outcome_c_create_and_promote():
            return True, ""
        
        if self.outcome_d_structured_repeat():
            return True, ""
        
        if self.outcome_blocked_with_ticket_level_blocker():
            return True, ""
        
        # Decision doesn't match any permitted outcome
        return False, (
            f"PROTOCOL VIOLATION: Decision {self.decision} does not satisfy mandate. "
            f"Must either: (a) promote backlog to todo, (d) provide structured repeat with blockedItems, "
            f"or (blocked) provide explicit ticket-level blocker."
        )


class TestAutonomousCycleBehavior:
    """
    Contract tests for autonomous cycle behavior with zero-todo boards.
    
    These tests validate that the CEO cycle follows the mandatory backlog
    promotion protocol when running in autonomous mode with zero todo items
    and unblocked backlog available.
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
        
        # Board with 33 unblocked items - mandate applies (evidence scenario)
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

    def test_mandate_does_not_apply_when_backlog_all_blocked(self):
        """The mandate does not apply when all backlog items are blocked."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_backlog_items=[],  # All blocked
            is_autonomous=True,
        )
        assert board.all_backlog_blocked()
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
        - "Board is idle, will check again later"
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
            CEOCycleDecision(
                decision=DecisionType.REPEAT,
                reason="Board is idle, will check again later",
                mutations=[],
                blocked_items=[],
            ),
        ]
        
        for decision in invalid_decisions:
            is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
            assert not is_valid, f"Invalid: {decision.reason}"
            assert "PROTOCOL VIOLATION" in violation

    def test_rejects_repeat_with_empty_blocked_items(
        self, mandate_board_state: BoardState
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
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert not is_valid, "Empty blockedItems array is not sufficient"
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
                Mutation(
                    type="dispatch_selected_work_items",
                    work_item_id="WI-001",
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

    def test_accepts_decision_promote(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): decision="promote" explicitly.
        
        Valid: decision field is "promote" - no need to parse reason.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.PROMOTE,
            reason="Promoted WI-001 to todo and dispatched.",
            mutations=[
                Mutation(type="patch_work_item_status", work_item_id="WI-001", from_status="backlog", to_status="todo"),
            ],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"decision='promote' should be valid: {violation}"

    # =========================================================================
    # Test: Outcome (b) - Structured repeat with blockedItems
    # =========================================================================

    def test_accepts_outcome_d_structured_repeat_with_blocked_reasons(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (d): Structured `repeat` with per-item `blockedReason` fields.
        
        Valid: decision="repeat" with blockedItems array containing items
        with non-empty blockedReason fields.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Zero todo items and backlog exists, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: 'WI-001', workItemTitle: 'Implement feature A', blockedReason: 'Requires upstream API credentials that are not yet provisioned and no workaround exists'}, {workItemId: 'WI-002', workItemTitle: 'Implement feature B', blockedReason: 'Blocked by WI-001 which cannot be dispatched'}]. Manual intervention required.",
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
        Outcome (d) validation: Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedItems array contains item with empty blockedReason.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Some items blocked",
            mutations=[],
            blocked_items=[
                BlockedItem(work_item_id="WI-001", work_item_title="Item 1", blocked_reason=""),  # Empty - invalid
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert not is_valid, "Blocked item with empty blockedReason should cause rejection"

    def test_rejects_structured_repeat_with_whitespace_blocked_reason(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (d) validation: blockedReason must be non-empty (not just whitespace).
        
        Invalid: blockedReason exists but contains only whitespace.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Some items blocked",
            mutations=[],
            blocked_items=[
                BlockedItem(work_item_id="WI-001", work_item_title="Item 1", blocked_reason="   "),  # Whitespace - invalid
            ],
        )
        
        assert not decision.outcome_d_structured_repeat()

    # =========================================================================
    # Test: Outcome (c) - Blocked decision with ticket-level blocker
    # =========================================================================

    def test_accepts_blocked_decision_with_ticket_level_blocker(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome: `decision: blocked` with explicit ticket-level blocker.
        
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
        assert decision.outcome_blocked_with_ticket_level_blocker()

    def test_accepts_blocked_decision_with_multiple_ticket_blockers(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome: `decision: blocked` with multiple explicit blockers.
        
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
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert is_valid, f"Blocked with multiple ticket blockers should be valid: {violation}"

    def test_rejects_blocked_decision_without_blocker_field(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome validation: blocker field is required for blocked decisions.
        
        Invalid: decision="blocked" without explicit blocker field.
        """
        decision = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Cannot proceed with current board state",
            blocker=None,  # Missing - invalid
            mutations=[],
        )
        
        assert not decision.outcome_blocked_with_ticket_level_blocker()
        
        is_valid, violation = decision.is_valid_zero_todo_decision(mandate_board_state)
        assert not is_valid, "Missing blocker should cause rejection"

    def test_rejects_blocked_decision_with_empty_blocker(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome validation: blocker field must be non-empty.
        
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

    def test_evidence_scenario_valid_outcome_d(
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
        
        # Outcome (d): Structured repeat
        structured = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="All items blocked",
            blocked_items=[BlockedItem(work_item_id="WI-001", work_item_title="Item 1", blocked_reason="Capacity reached")],
        )
        
        # Outcome: Blocked with ticket-level blocker
        blocked = CEOCycleDecision(
            decision=DecisionType.BLOCKED,
            reason="Systemic blocker",
            blocker="TICKET-999 must be resolved first",
        )
        
        # All three should be valid
        for decision, name in [(promote, "promote"), (structured, "structured"), (blocked, "blocked")]:
            is_valid, violation = decision.is_valid_zero_todo_decision(board)
            assert is_valid, f"Outcome {name} should be valid: {violation}"

    # =========================================================================
    # Test: Non-contagion rule
    # =========================================================================

    def test_human_decision_blockers_do_not_block_unrelated_items(self):
        """
        NON-CONTAGION RULE: Human-decision blockers do NOT propagate.
        
        Scenario: 3 human-decision items in 33-item backlog
        Correct: 30 items are UNBLOCKED and eligible for promotion
        Incorrect: Treat human-decision items as blocking entire board
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_items=[
                BacklogItem(id=f"WI-{i:03d}", title=f"Item {i}", blocked=False)
                for i in range(33)
            ],
            is_autonomous=True,
        )
        
        assert board.mandate_conditions_met()
        assert board.todo_count == 0
        assert len(board.unblocked_backlog_items) == 33
        
        # The board has 33 unblocked items, even if 3 have human_decision blockers
        # Bare repeat is still a violation
        
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="No board action available. 3 human-decision items pending.",
            mutations=[],
            blocked_items=[],
        )
        
        is_valid, violation = decision.is_valid_zero_todo_decision(board)
        assert not is_valid, "Human-decision items do not block entire board"
        assert "PROTOCOL VIOLATION" in violation

    # =========================================================================
    # Test: Mixed blocked/unblocked scenario
    # =========================================================================

    def test_mixed_scenario_valid_outcome_a_promote_unblocked(self):
        """
        Scenario: Some items blocked, some unblocked.
        
        CEO must promote the unblocked items (outcome a).
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
                BacklogItem(id="WI-003", title="Item 3"),
            ],
            is_autonomous=True,
        )
        
        assert board.mandate_conditions_met()
        
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Promoted WI-001, WI-002 to todo. 3 additional items blocked by human-decision.",
            mutations=[
                Mutation(type="patch_work_item_status", work_item_id="WI-001", from_status="backlog", to_status="todo"),
                Mutation(type="patch_work_item_status", work_item_id="WI-002", from_status="backlog", to_status="todo"),
            ],
            blocked_items=[],
        )
        
        is_valid, _ = decision.is_valid_zero_todo_decision(board)
        assert is_valid, "Promoting unblocked items should satisfy mandate"

    def test_mixed_scenario_valid_outcome_d_with_capacity_constraint(self):
        """
        Scenario: Some items blocked, some unblocked.
        
        CEO may use outcome (d) if they document WHY the unblocked items
        cannot be promoted (e.g., capacity constraint).
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_backlog_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )
        
        decision = CEOCycleDecision(
            decision=DecisionType.REPEAT,
            reason="Capacity limit reached; only 2 concurrent items allowed.",
            mutations=[],
            blocked_items=[
                BlockedItem(work_item_id="WI-001", work_item_title="Item 1", blocked_reason="Capacity limit reached"),
                BlockedItem(work_item_id="WI-002", work_item_title="Item 2", blocked_reason="Capacity limit reached"),
            ],
        )
        
        is_valid, _ = decision.is_valid_zero_todo_decision(board)
        assert is_valid, "Capacity constraint is valid reason for blockedItems"


class TestAutonomousCycleFromOutput:
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

    def test_handles_null_blocked_items(self):
        """Output with null blockedItems should be handled gracefully."""
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "blockedItems": None,
        }
        decision = CEOCycleDecision.from_output(output)
        assert len(decision.blocked_items) == 0

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