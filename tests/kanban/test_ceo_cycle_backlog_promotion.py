"""
Contract test: CEO cycle backlog promotion mandate for zero-todo autonomous boards.

This test validates the contract for the Autonomous Zero-Todo Board Mandate
from the CEO cycle prompt. When autonomous mode has 0 todo items and 3+ unblocked
backlog items exist, the CEO MUST take one of three actions and must NOT produce
a bare `repeat` decision with no board mutation.

Valid outcomes for 0 todo + 3+ unblocked backlog in autonomous mode:
  (a) Promotion: at least one item promoted from backlog to todo
  (b) Structured repeat: decision="repeat" with blockedReason and action plan
  (c) Blocked with ticket: decision="blocked" with blockedItems containing valid
      ticket-level blockers with non-empty blockedReason

A bare `repeat` decision with no mutation (decision="repeat" without blockedReason
or blockedItems) is NOT permitted.

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed - a protocol violation.
"""
import pytest
from dataclasses import dataclass, field
from typing import Optional, List, Literal, Any, Dict


class ContractViolation(Exception):
    """Raised when a CEO cycle decision violates the contract."""
    pass


@dataclass
class BlockedItem:
    """A blocked work item with ticket-level blocker information."""
    id: str
    blocked_reason: str

    def validate(self) -> List[str]:
        """Return list of validation errors, empty if valid."""
        errors = []
        if not self.id or not self.id.strip():
            errors.append("blocked item id cannot be empty")
        if not self.blocked_reason or not self.blocked_reason.strip():
            errors.append("blocked item blocked_reason cannot be empty")
        return errors


@dataclass
class CeoCycleDecision:
    """Represents a CEO cycle decision with optional mutation."""
    decision: Literal["repeat", "pause", "complete", "blocked"]
    blocked_reason: Optional[str] = None
    blocked_items: List[BlockedItem] = field(default_factory=list)
    promoted_item_ids: List[str] = field(default_factory=list)
    reason: str = ""

    def is_bare_repeat(self) -> bool:
        """
        A bare repeat is a decision='repeat' with no blocked_reason, no blocked_items,
        and no promoted items - essentially no mutation to the board state.
        """
        if self.decision != "repeat":
            return False
        has_blocked_reason = bool(self.blocked_reason and self.blocked_reason.strip())
        has_blocked_items = len(self.blocked_items) > 0
        has_promotion = len(self.promoted_item_ids) > 0
        return not has_blocked_reason and not has_blocked_items and not has_promotion

    def is_valid_zero_todo_backlog_decision(self) -> bool:
        """
        Check if this decision is valid under the zero-todo backlog promotion contract.

        A decision is valid if:
        - It is NOT a bare repeat (no mutation)
        - AND one of:
          (a) promotion occurred (promoted_item_ids is not empty)
          (b) structured repeat (decision='repeat' with blocked_reason)
          (c) blocked with ticket-level blocker (decision='blocked' with blocked_items)
        """
        if self.is_bare_repeat():
            return False

        has_promotion = len(self.promoted_item_ids) > 0
        has_structured_repeat = (
            self.decision == "repeat" and
            bool(self.blocked_reason and self.blocked_reason.strip())
        )
        has_ticket_blocker = (
            self.decision == "blocked" and
            len(self.blocked_items) > 0 and
            all(item.validate() == [] for item in self.blocked_items)
        )

        return has_promotion or has_structured_repeat or has_ticket_blocker


@dataclass
class BoardState:
    """Represents the kanban board state."""
    todo_count: int
    backlog_count: int
    backlog_items: List[Dict[str, Any]]
    mode: Literal["autonomous", "supervised"]

    def has_unblocked_backlog(self) -> bool:
        """Check if there are unblocked items in backlog."""
        return any(not item.get("blocked", False) for item in self.backlog_items)

    def is_zero_todo_with_unblocked_backlog(self) -> bool:
        """Check if this is a zero-todo board with unblocked backlog."""
        return (
            self.todo_count == 0 and
            self.backlog_count >= 3 and
            self.has_unblocked_backlog() and
            self.mode == "autonomous"
        )


class CeoCycleContract:
    """Contract validator for CEO cycle zero-todo backlog promotion mandate."""

    @staticmethod
    def validate_decision(board_state: BoardState, decision: CeoCycleDecision) -> List[str]:
        """
        Validate that a CEO cycle decision conforms to the contract.

        Returns empty list if valid, otherwise returns list of contract violation messages.
        """
        violations = []

        if not board_state.is_zero_todo_with_unblocked_backlog():
            return violations

        # Contract: bare repeat is not permitted for zero-todo with unblocked backlog
        if decision.is_bare_repeat():
            violations.append(
                "CONTRACT VIOLATION: Bare repeat decision not permitted when "
                "0 todo items, 3+ unblocked backlog items, and autonomous mode"
            )

        # Contract: decision must be one of valid outcomes
        if not decision.is_valid_zero_todo_backlog_decision():
            violations.append(
                "CONTRACT VIOLATION: Decision must be one of: "
                "(a) promotion occurred, (b) structured repeat with blockedReason, "
                "(c) blocked with ticket-level blocker"
            )

        return violations


# ============================================================================
# Test Cases for CEO Cycle Backlog Promotion Contract
# ============================================================================

class TestCeoCycleZeroTodoBacklogContract:
    """Test suite for CEO cycle backlog promotion contract."""

    def test_board_state_zero_todo_with_unblocked_backlog(self):
        """Test that board state correctly identifies zero-todo with unblocked backlog."""
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="autonomous"
        )
        assert board.is_zero_todo_with_unblocked_backlog() is True

    def test_board_state_supervised_mode_excluded(self):
        """Test that supervised mode is not subject to the same contract."""
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="supervised"
        )
        # Supervised mode doesn't trigger the same contract requirements
        assert board.is_zero_todo_with_unblocked_backlog() is False

    def test_bare_repeat_is_invalid(self):
        """Test that a bare repeat decision (no mutation) is invalid."""
        decision = CeoCycleDecision(
            decision="repeat",
            reason="No action needed"
        )
        assert decision.is_bare_repeat() is True
        assert decision.is_valid_zero_todo_backlog_decision() is False

    def test_promotion_is_valid(self):
        """Test that promotion outcome (a) is valid."""
        decision = CeoCycleDecision(
            decision="repeat",
            promoted_item_ids=["WI-001", "WI-002"],
            reason="Promoting backlog items to todo"
        )
        assert decision.is_bare_repeat() is False
        assert decision.is_valid_zero_todo_backlog_decision() is True

    def test_structured_repeat_with_blocked_reason_is_valid(self):
        """Test that structured repeat (b) with blockedReason is valid."""
        decision = CeoCycleDecision(
            decision="repeat",
            blocked_reason="Feature flag not enabled for WI-001",
            reason="Blocked by external dependency"
        )
        assert decision.is_bare_repeat() is False
        assert decision.is_valid_zero_todo_backlog_decision() is True

    def test_blocked_with_ticket_level_blocker_is_valid(self):
        """Test that blocked decision (c) with ticket-level blocker is valid."""
        decision = CeoCycleDecision(
            decision="blocked",
            blocked_items=[
                BlockedItem(id="WI-001", blocked_reason="Waiting for API credentials"),
                BlockedItem(id="WI-002", blocked_reason="Dependency on WI-001"),
            ],
            reason="Items blocked by external dependencies"
        )
        assert decision.is_valid_zero_todo_backlog_decision() is True

    def test_contract_rejects_bare_repeat(self):
        """Test that the contract rejects bare repeat for zero-todo with backlog."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="autonomous"
        )

        # Bare repeat decision
        decision = CeoCycleDecision(
            decision="repeat",
            reason="No board action available"
        )

        violations = CeoCycleContract.validate_decision(board, decision)

        assert len(violations) > 0
        assert any("Bare repeat" in v for v in violations)

    def test_contract_accepts_promotion(self):
        """Test that the contract accepts promotion outcome."""
        board = BoardState(
            todo_count=0,
            backlog_count=4,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="autonomous"
        )

        decision = CeoCycleDecision(
            decision="repeat",
            promoted_item_ids=["WI-001"],
            reason="Promoting highest priority item"
        )

        violations = CeoCycleContract.validate_decision(board, decision)
        assert len(violations) == 0

    def test_contract_accepts_structured_repeat(self):
        """Test that the contract accepts structured repeat with blockedReason."""
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="autonomous"
        )

        decision = CeoCycleDecision(
            decision="repeat",
            blocked_reason="All candidates require database migration not yet applied",
            reason="Blocked by pending infrastructure change"
        )

        violations = CeoCycleContract.validate_decision(board, decision)
        assert len(violations) == 0

    def test_contract_accepts_blocked_with_ticket_level(self):
        """Test that the contract accepts blocked with ticket-level blockers."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="autonomous"
        )

        decision = CeoCycleDecision(
            decision="blocked",
            blocked_items=[
                BlockedItem(
                    id="WI-001",
                    blocked_reason="Awaiting security review approval"
                )
            ],
            reason="Items blocked by security review gate"
        )

        violations = CeoCycleContract.validate_decision(board, decision)
        assert len(violations) == 0

    def test_contract_allows_non_autonomous_bare_repeat(self):
        """Test that non-autonomous mode allows bare repeat (different contract)."""
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            backlog_items=[
                {"id": "WI-001", "status": "backlog", "blocked": False},
                {"id": "WI-002", "status": "backlog", "blocked": False},
                {"id": "WI-003", "status": "backlog", "blocked": False},
            ],
            mode="supervised"
        )

        decision = CeoCycleDecision(
            decision="repeat",
            reason="Waiting for human approval"
        )

        violations = CeoCycleContract.validate_decision(board, decision)
        # Non-autonomous mode doesn't trigger the strict contract
        assert len(violations) == 0

    def test_blocked_item_requires_valid_blocked_reason(self):
        """Test that blocked items must have non-empty blocked_reason."""
        blocked_item = BlockedItem(id="WI-001", blocked_reason="")
        errors = blocked_item.validate()
        assert len(errors) > 0
        assert any("blocked_reason cannot be empty" in e for e in errors)

    def test_blocked_item_requires_valid_id(self):
        """Test that blocked items must have non-empty id."""
        blocked_item = BlockedItem(id="", blocked_reason="External dependency")
        errors = blocked_item.validate()
        assert len(errors) > 0
        assert any("id cannot be empty" in e for e in errors)

    def test_real_world_scenario_no_action_available_violation(self):
        """
        Test the real-world scenario from 2026-05-15 where CEO concluded
        "No board action available" while 33 backlog items existed.
        This should be flagged as a contract violation.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            backlog_items=[
                {"id": f"WI-{i:03d}", "status": "backlog", "blocked": False}
                for i in range(1, 34)
            ],
            mode="autonomous"
        )

        # Simulate the problematic decision from the real scenario
        decision = CeoCycleDecision(
            decision="repeat",
            reason="No board action available"
        )

        assert decision.is_bare_repeat() is True

        violations = CeoCycleContract.validate_decision(board, decision)
        assert len(violations) > 0
        assert any("CONTRACT VIOLATION" in v for v in violations)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])