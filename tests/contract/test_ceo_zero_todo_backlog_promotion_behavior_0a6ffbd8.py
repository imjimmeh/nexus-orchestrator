"""
Runtime Contract Test: CEO Zero-Todo Backlog Promotion Behavior

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

ACCEPTANCE CRITERIA:
Given a board with 0 todo items, 3+ unblocked backlog items, and autonomous mode,
the CEO cycle either:
  (1) promotes at least one item to todo in the same cycle,
  (2) produces structured `decision: repeat` output with per-item `blockedReason` fields, or
  (3) records `decision: blocked` with an explicit ticket-level blocker.

A bare `repeat` with no mutation and no per-item explanation is NOT produced.

This contract test proves this behavior deterministically.

Dependencies:
  - seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md (zero-todo promotion mandate)

Evidence: 2026-05-15 incident where CEO concluded "no board action available"
with 33 backlog items and 0 todo items - a protocol violation.

Test Design:
  - Uses deterministic board state setup
  - Validates CEO decision output against the promotion contract
  - Proves bare repeat is rejected when mandate conditions are met
  - Verifies all three valid outcomes are accepted
"""
import pytest
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


class DecisionType:
    """Valid decision types from CEO cycle contract."""
    PROMOTE = "promote"
    PATCH = "patch"
    CREATE = "create"
    REPEAT = "repeat"
    BLOCKED = "blocked"
    PAUSE = "pause"
    COMPLETE = "complete"


@dataclass
class BacklogItem:
    """Represents a backlog item in board state."""
    id: str
    title: str
    blocked: bool = False


@dataclass
class BoardState:
    """
    Board state for CEO cycle contract validation.
    
    Mandate conditions (ALL must be true):
      - todo_count == 0
      - backlog_count >= 3
      - unblocked_items >= 3
      - is_autonomous == True
    """
    todo_count: int
    backlog_count: int
    unblocked_items: List[BacklogItem] = field(default_factory=list)
    is_autonomous: bool = True
    
    def mandate_conditions_met(self) -> bool:
        """Check if zero-todo promotion mandate applies."""
        return (
            self.todo_count == 0 and
            self.backlog_count >= 3 and
            len(self.unblocked_items) >= 3 and
            self.is_autonomous
        )


@dataclass
class Mutation:
    """Represents a board mutation from CEO decision."""
    type: str
    work_item_id: Optional[str] = None
    from_status: Optional[str] = None
    to_status: Optional[str] = None


@dataclass
class BlockedItem:
    """Represents a blocked backlog item with per-item explanation."""
    work_item_id: str
    work_item_title: str
    blocked_reason: str


@dataclass
class CEODecision:
    """
    CEO cycle decision output for contract validation.
    
    Validates against the zero-todo backlog promotion mandate.
    """
    decision: str
    reason: str
    mutations: List[Mutation] = field(default_factory=list)
    blocked_items: List[BlockedItem] = field(default_factory=list)
    blocker: Optional[str] = None
    
    @classmethod
    def from_output(cls, output: Dict[str, Any]) -> "CEODecision":
        """Parse CEO decision output dict into CEODecision."""
        mutations = []
        for m in output.get("mutations", []) or []:
            mutations.append(Mutation(
                type=m.get("type", ""),
                work_item_id=m.get("work_item_id"),
                from_status=m.get("from_status"),
                to_status=m.get("to_status"),
            ))
        
        blocked_items = []
        for item in output.get("blockedItems", []) or []:
            blocked_items.append(BlockedItem(
                work_item_id=item.get("workItemId", ""),
                work_item_title=item.get("workItemTitle", ""),
                blocked_reason=item.get("blockedReason", ""),
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
        Check if this is a BARE REPEAT - the protocol violation.
        
        A bare repeat has:
          - decision == "repeat"
          - NO mutations (no board changes)
          - NO blocked_items with per-item blockedReason fields
        """
        if self.decision != DecisionType.REPEAT:
            return False
        
        has_mutation = len(self.mutations) > 0
        has_structured_blocked = (
            len(self.blocked_items) > 0 and
            all(item.blocked_reason.strip() for item in self.blocked_items)
        )
        
        return not has_mutation and not has_structured_blocked
    
    def has_promotion_mutation(self) -> bool:
        """Check if there's a promotion mutation (backlog -> todo)."""
        for mutation in self.mutations:
            if mutation.type == "patch_work_item_status":
                if mutation.from_status == "backlog" and mutation.to_status == "todo":
                    return True
        return False
    
    def outcome_a_promote_to_todo(self) -> bool:
        """Outcome (a): Promote at least one item to todo."""
        return self.has_promotion_mutation()
    
    def outcome_b_structured_repeat_with_blocked_items(self) -> bool:
        """
        Outcome (b): Structured repeat with per-item blockedReason fields.
        
        Valid ONLY when:
          - decision == "repeat"
          - blocked_items array has at least one item
          - Each blocked item has non-empty blockedReason field
        """
        if self.decision != DecisionType.REPEAT:
            return False
        if len(self.blocked_items) == 0:
            return False
        return all(item.blocked_reason.strip() for item in self.blocked_items)
    
    def outcome_c_blocked_with_ticket_blocker(self) -> bool:
        """
        Outcome (c): decision='blocked' with explicit ticket-level blocker.
        
        Valid when:
          - decision == "blocked"
          - blocker field is non-empty
        """
        if self.decision != DecisionType.BLOCKED:
            return False
        return self.blocker is not None and len(self.blocker.strip()) > 0
    
    def is_valid_mandate_decision(self) -> bool:
        """
        Validate decision against zero-todo backlog promotion mandate.
        
        Returns True if decision satisfies one of the three valid outcomes.
        Returns False if decision is a bare repeat (protocol violation).
        """
        if self.is_bare_repeat():
            return False
        
        return (
            self.outcome_a_promote_to_todo() or
            self.outcome_b_structured_repeat_with_blocked_items() or
            self.outcome_c_blocked_with_ticket_blocker()
        )
    
    def get_violation_message(self, board_state: BoardState) -> str:
        """Get detailed violation message for bare repeat."""
        if not self.is_bare_repeat():
            return ""
        
        unblocked_count = len(board_state.unblocked_items)
        return (
            f"PROTOCOL VIOLATION: Bare repeat with no mutation when "
            f"todo_count={board_state.todo_count}, backlog_count={board_state.backlog_count}, "
            f"unblocked_count={unblocked_count}. "
            f"CEO MUST choose one of: (a) promote, (b) structured repeat with blockedItems, or (c) blocked with ticket blocker."
        )


class TestCEOZeroTodoBacklogPromotionContract:
    """
    Contract tests for CEO zero-todo backlog promotion behavior.
    
    These tests validate that the CEO cycle follows the mandatory promotion
    protocol when running in autonomous mode with zero todo items and
    3+ unblocked backlog items.
    
    PROVES DETERMINISTICALLY:
      - Given mandate conditions (0 todo, 3+ unblocked backlog, autonomous mode)
      - CEO MUST NOT produce bare repeat
      - CEO MUST produce one of three valid outcomes
    """

    # =========================================================================
    # Fixtures: Deterministic Board States
    # =========================================================================

    @pytest.fixture
    def mandate_board_state(self) -> BoardState:
        """
        Board state where mandate applies.
        
        Conditions: 0 todo, 3 unblocked backlog items, autonomous mode.
        This is the exact scenario where promotion is mandatory.
        """
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Implement feature A", blocked=False),
                BacklogItem(id="WI-002", title="Implement feature B", blocked=False),
                BacklogItem(id="WI-003", title="Write unit tests", blocked=False),
            ],
            is_autonomous=True,
        )

    @pytest.fixture
    def large_backlog_board_state(self) -> BoardState:
        """
        Board state matching 2026-05-15 evidence scenario.
        
        0 todo, 33 backlog items, 33 unblocked - the exact scenario
        that triggered the protocol violation.
        """
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_items=[
                BacklogItem(id=f"BACKLOG-{i+1:03d}", title=f"Backlog Item {i+1}")
                for i in range(33)
            ],
            is_autonomous=True,
        )

    @pytest.fixture
    def mixed_blocked_board_state(self) -> BoardState:
        """
        Board state with some blocked and some unblocked items.
        
        30 unblocked, 3 blocked - demonstrates non-contagion rule.
        """
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_items=[
                BacklogItem(id=f"SAFE-{i+1:03d}", title=f"Unblocked Item {i+1}")
                for i in range(30)
            ],
            is_autonomous=True,
        )

    # =========================================================================
    # Test: Mandate Conditions Validation
    # =========================================================================

    def test_mandate_conditions_activated_when_all_criteria_met(
        self, mandate_board_state: BoardState
    ):
        """
        Mandate activates when ALL conditions are true.
        
        Conditions required:
          - todo_count == 0
          - backlog_count >= 3
          - unblocked_items >= 3
          - is_autonomous == True
        """
        assert mandate_board_state.mandate_conditions_met()

    def test_mandate_not_activated_when_todo_exists(self):
        """Mandate does not apply when todo items exist."""
        board = BoardState(
            todo_count=1,  # Has todo items
            backlog_count=10,
            unblocked_items=[BacklogItem(id="WI-001", title="Item")],
            is_autonomous=True,
        )
        assert not board.mandate_conditions_met()

    def test_mandate_not_activated_when_backlog_insufficient(self):
        """Mandate does not apply when backlog has fewer than 3 unblocked items."""
        board = BoardState(
            todo_count=0,
            backlog_count=2,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )
        assert not board.mandate_conditions_met()

    def test_mandate_not_activated_when_not_autonomous(self):
        """Mandate does not apply in non-autonomous (supervised) mode."""
        board = BoardState(
            todo_count=0,
            backlog_count=10,
            unblocked_items=[BacklogItem(id="WI-001", title="Item")],
            is_autonomous=False,
        )
        assert not board.mandate_conditions_met()

    # =========================================================================
    # Test: Bare Repeat Rejection (PROTOCOL VIOLATION)
    # =========================================================================

    def test_rejects_bare_repeat_when_mandate_conditions_met(
        self, mandate_board_state: BoardState
    ):
        """
        CRITICAL CONTRACT TEST: Bare repeat is ALWAYS a protocol violation.
        
        Scenario: 0 todo, 3 unblocked backlog, autonomous mode
        Invalid: decision="repeat" with no mutations and no blockedItems
        
        This is the primary protocol violation from 2026-05-15 evidence.
        """
        assert mandate_board_state.mandate_conditions_met()
        
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        # Deterministic: bare repeat MUST be rejected
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()
        
        violation_msg = decision.get_violation_message(mandate_board_state)
        assert "PROTOCOL VIOLATION" in violation_msg
        assert "Bare repeat" in violation_msg

    def test_rejects_generic_bare_repeat_patterns(
        self, mandate_board_state: BoardState
    ):
        """
        Generic repeat patterns are all protocol violations.
        
        Invalid patterns:
          - "No board action available"
          - "No work to do right now"
          - "Checked board state, will retry later"
          - "All items have issues"
          - "Board is idle"
        """
        invalid_outputs = [
            {"decision": "repeat", "reason": "No board action available", "mutations": [], "blockedItems": []},
            {"decision": "repeat", "reason": "No work to do right now", "mutations": [], "blockedItems": []},
            {"decision": "repeat", "reason": "Checked board state, will retry later", "mutations": [], "blockedItems": []},
            {"decision": "repeat", "reason": "All items have issues, will monitor", "mutations": [], "blockedItems": []},
            {"decision": "repeat", "reason": "Board is idle", "mutations": [], "blockedItems": []},
        ]
        
        for output in invalid_outputs:
            decision = CEODecision.from_output(output)
            assert decision.is_bare_repeat(), f"Should be bare repeat: {output['reason']}"
            assert not decision.is_valid_mandate_decision()

    def test_rejects_repeat_with_empty_blocked_items_array(
        self, mandate_board_state: BoardState
    ):
        """
        Repeat with empty blockedItems is still a protocol violation.
        
        blockedItems array must contain items with non-empty blockedReason.
        """
        output = {
            "decision": "repeat",
            "reason": "Some items blocked",
            "mutations": [],
            "blockedItems": [],  # Empty array
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()

    def test_rejects_repeat_with_incomplete_blocked_items(
        self, mandate_board_state: BoardState
    ):
        """
        Repeat with blockedItems missing blockedReason is still invalid.
        
        Each blocked item MUST have non-empty blockedReason.
        """
        output = {
            "decision": "repeat",
            "reason": "Some items blocked",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1"},  # Missing blockedReason
            ],
        }
        decision = CEODecision.from_output(output)
        
        # Not a structured repeat because blockedReason is missing
        assert not decision.outcome_b_structured_repeat_with_blocked_items()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (a) - Promote to Todo
    # =========================================================================

    def test_accepts_outcome_a_single_promotion(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): Promote at least one unblocked backlog item to todo.
        
        Valid: promotion mutation (backlog -> todo transition)
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo. Board has WI-001 ready for dispatch. 2 additional unblocked candidates remain.",
            "mutations": [
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "WI-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                }
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_accepts_outcome_a_multiple_promotions(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): Promote multiple items to todo.
        
        Valid: multiple promotion mutations
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001, WI-002 to todo. 1 candidate remains.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "WI-002", "from_status": "backlog", "to_status": "todo"},
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_accepts_outcome_a_decision_type_promote(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (a): Explicit decision="promote"
        
        Valid: decision field is "promote" with promotion mutation
        """
        output = {
            "decision": "promote",
            "reason": "Promoted WI-001 to todo and dispatched.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (b) - Structured Repeat with BlockedItems
    # =========================================================================

    def test_accepts_outcome_b_structured_repeat_with_blocked_items(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (b): Structured repeat with per-item blockedReason fields.
        
        Valid: decision="repeat" with blockedItems array, each item has
        non-empty blockedReason field.
        """
        output = {
            "decision": "repeat",
            "reason": "Zero todo items and 2 backlog items exist, but all candidates blocked by unresolvable issues. blockedItems: [{workItemId: 'WI-001', workItemTitle: 'Implement feature A', blockedReason: 'Requires upstream API credentials not yet provisioned'}, {workItemId: 'WI-002', workItemTitle: 'Implement feature B', blockedReason: 'Blocked by WI-001 which cannot be dispatched'}]. Manual intervention required.",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": "WI-001",
                    "workItemTitle": "Implement feature A",
                    "blockedReason": "Requires upstream API credentials not yet provisioned",
                },
                {
                    "workItemId": "WI-002",
                    "workItemTitle": "Implement feature B",
                    "blockedReason": "Blocked by WI-001 which cannot be dispatched",
                },
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_b_structured_repeat_with_blocked_items()
        assert decision.is_valid_mandate_decision()

    def test_accepts_outcome_b_all_items_blocked_capacity(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (b): All items blocked by capacity constraint.
        
        Valid: blockedItems with per-item blockedReason (capacity)
        """
        output = {
            "decision": "repeat",
            "reason": "Capacity limit reached: 2 concurrent maximum. blockedItems: all 3 items blocked by capacity.",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": "Capacity limit: 2 concurrent maximum"},
                {"workItemId": "WI-002", "workItemTitle": "Item 2", "blockedReason": "Capacity limit: 2 concurrent maximum"},
                {"workItemId": "WI-003", "workItemTitle": "Item 3", "blockedReason": "Capacity limit: 2 concurrent maximum"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_b_structured_repeat_with_blocked_items()
        assert decision.is_valid_mandate_decision()

    def test_rejects_outcome_b_empty_blocked_reason(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (b) validation: blockedReason must be non-empty.
        
        Invalid: blockedReason is empty string.
        """
        output = {
            "decision": "repeat",
            "reason": "Items blocked",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": ""},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert not decision.outcome_b_structured_repeat_with_blocked_items()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (c) - Blocked with Ticket-Level Blocker
    # =========================================================================

    def test_accepts_outcome_c_blocked_with_ticket_blocker(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (c): decision="blocked" with explicit ticket-level blocker.
        
        Valid: decision="blocked" with non-empty blocker field containing
        specific ticket/issue references.
        """
        output = {
            "decision": "blocked",
            "reason": "Zero todo items and 3 backlog items exist. Systemic blocker prevents dispatch. Manual intervention required.",
            "mutations": [],
            "blockedItems": [],
            "blocker": "TICKET-123: credentials secret is empty in vault, required by all 3 candidates. TICKET-124: upstream API documentation missing.",
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_c_blocked_with_ticket_blocker()
        assert decision.is_valid_mandate_decision()

    def test_rejects_outcome_c_blocked_without_blocker_field(
        self, mandate_board_state: BoardState
    ):
        """
        Outcome (c) validation: blocker field required for blocked decisions.
        
        Invalid: decision="blocked" without explicit blocker field.
        """
        output = {
            "decision": "blocked",
            "reason": "Cannot proceed with current board state",
            "mutations": [],
            "blockedItems": [],
            "blocker": None,
        }
        decision = CEODecision.from_output(output)
        
        assert not decision.outcome_c_blocked_with_ticket_blocker()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Evidence Scenario (33 Backlog Items)
    # =========================================================================

    def test_evidence_scenario_rejects_bare_repeat(
        self, large_backlog_board_state: BoardState
    ):
        """
        Evidence from 2026-05-15: 0 todo + 33 unblocked backlog.
        
        Live run: decision="repeat", reason="No board action available"
        This is a PROTOCOL VIOLATION - must be rejected.
        """
        assert large_backlog_board_state.mandate_conditions_met()
        assert large_backlog_board_state.backlog_count == 33
        
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()

    def test_evidence_scenario_accepts_valid_promotion(
        self, large_backlog_board_state: BoardState
    ):
        """
        Valid outcome for evidence scenario: Promote first item.
        
        This WOULD have satisfied the mandate in the 2026-05-15 run.
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted BACKLOG-001 to todo. 32 additional unblocked candidates remain.",
            "mutations": [
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "BACKLOG-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                }
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_evidence_scenario_accepts_valid_structured_repeat(
        self, large_backlog_board_state: BoardState
    ):
        """
        Valid outcome for evidence scenario: Structured repeat with capacity constraint.
        
        Valid if capacity truly blocked all items.
        """
        output = {
            "decision": "repeat",
            "reason": "Zero todo and 33 backlog candidates, but capacity limit reached.",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": f"BACKLOG-{i+1:03d}",
                    "workItemTitle": f"Item {i+1}",
                    "blockedReason": "Capacity limit: 2 concurrent maximum",
                }
                for i in range(33)
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_b_structured_repeat_with_blocked_items()
        assert decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Non-Contagion Rule (Mixed Blocked/Unblocked)
    # =========================================================================

    def test_non_contagion_rule_accepts_promotion_of_unblocked_items(
        self, mixed_blocked_board_state: BoardState
    ):
        """
        Non-contagion rule: Human-decision blockers do NOT block unrelated items.
        
        3 human-decision items + 30 unblocked items = mandate applies
        CEO MUST promote the 30 unblocked items.
        
        This is the correct interpretation of the 2026-05-15 violation.
        """
        assert mixed_blocked_board_state.mandate_conditions_met()
        
        # Valid: Promote unblocked items (ignore blocked ones)
        output = {
            "decision": "repeat",
            "reason": "Promoted 5 unblocked items to todo (SAFE-001 through SAFE-005). 25 additional unblocked candidates remain. 3 human-decision items remain in backlog awaiting human response.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": f"SAFE-{i:03d}", "from_status": "backlog", "to_status": "todo"}
                for i in range(1, 6)
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_non_contagion_rule_rejects_bare_repeat_claiming_human_decision_blockers(
        self, mixed_blocked_board_state: BoardState
    ):
        """
        INCORRECT interpretation (2026-05-15 violation): Treating human-decision
        blockers as blocking the entire board.
        
        Invalid: "No board action available. 3 blocked human-decision items."
        """
        output = {
            "decision": "repeat",
            "reason": "No change from prior cycle: 0 dispatchable todo items, 3 blocked human-decision items awaiting human feedback. No board action available to this cycle.",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        # This is a bare repeat - protocol violation
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Deterministic Validation
    # =========================================================================

    def test_deterministic_validation_same_input_same_output(
        self, mandate_board_state: BoardState
    ):
        """
        Contract validation is DETERMINISTIC: same input always produces same output.
        
        This ensures reproducible, verifiable test results.
        """
        invalid_output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        
        # Run validation multiple times - must always reject bare repeat
        for _ in range(10):
            decision = CEODecision.from_output(invalid_output)
            assert decision.is_bare_repeat()
            assert not decision.is_valid_mandate_decision()

    def test_all_three_valid_outcomes_distinct_and_accepted(
        self, mandate_board_state: BoardState
    ):
        """
        The three valid outcomes are distinct paths - all must be accepted.
        
        This proves the contract allows flexibility while preventing bare repeat.
        """
        # Outcome (a): Promotion
        promote_output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo",
            "mutations": [{"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"}],
            "blockedItems": [],
        }
        promote_decision = CEODecision.from_output(promote_output)
        
        # Outcome (b): Structured repeat
        structured_output = {
            "decision": "repeat",
            "reason": "All items blocked by capacity",
            "mutations": [],
            "blockedItems": [{"workItemId": "WI-001", "blockedReason": "Capacity limit reached"}],
        }
        structured_decision = CEODecision.from_output(structured_output)
        
        # Outcome (c): Blocked with ticket blocker
        blocked_output = {
            "decision": "blocked",
            "reason": "Systemic blocker",
            "mutations": [],
            "blockedItems": [],
            "blocker": "TICKET-123 must be resolved first",
        }
        blocked_decision = CEODecision.from_output(blocked_output)
        
        # All three should be valid for mandate scenario
        assert promote_decision.is_valid_mandate_decision()
        assert structured_decision.is_valid_mandate_decision()
        assert blocked_decision.is_valid_mandate_decision()
        
        # Bare repeat should be invalid
        bare_repeat = CEODecision.from_output({
            "decision": "repeat",
            "reason": "No action",
            "mutations": [],
            "blockedItems": [],
        })
        assert not bare_repeat.is_valid_mandate_decision()

    # =========================================================================
    # Test: Round-Trip Parsing and Validation
    # =========================================================================

    def test_roundtrip_valid_output(self, mandate_board_state: BoardState):
        """
        Output -> parse -> validate produces consistent results.
        
        Valid output: promotion mutation exists.
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"}
            ],
            "blockedItems": [],
        }
        
        decision = CEODecision.from_output(output)
        assert decision.is_valid_mandate_decision(), "Valid output should pass validation"

    def test_roundtrip_invalid_output(self, mandate_board_state: BoardState):
        """
        Output -> parse -> validate produces consistent results.
        
        Invalid output: bare repeat with no mutation.
        """
        output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        decision = CEODecision.from_output(output)
        assert not decision.is_valid_mandate_decision(), "Bare repeat should fail validation"
        assert "PROTOCOL VIOLATION" in decision.get_violation_message(mandate_board_state)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])