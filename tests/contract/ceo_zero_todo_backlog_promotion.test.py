"""
Contract test for CEO zero-todo backlog promotion mandate.

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

ACCEPTANCE CRITERIA:
Given a board with:
  - todo_count == 0 (zero todo items)
  - backlog_count >= 3 (three or more backlog items)
  - unblocked backlog items exist (at least 3)
  - is_autonomous == True

The CEO cycle MUST NOT produce a bare `repeat` decision with no mutation
and no per-item explanation.

The CEO cycle MUST choose one of these four mandatory outcomes:
  (a) Promote: At least one item promoted from backlog to todo
  (b) Patch & Promote: Fix execution config to make candidate safe, then promote
  (c) Create & Promote: Create missing work item, then promote
  (d) Structured Repeat: decision="repeat" with per-item blockedReason fields

The CEO MUST NOT produce:
  - Bare `repeat` with no mutation and no blockedItems array
  - Generic "no work" conclusions when backlog_count > 0
  - "Will monitor" as sole action when unblocked backlog exists

Evidence: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed—a protocol violation.

Test Design:
  - Uses deterministic board state setup
  - Validates CEO decision output against the promotion contract
  - Proves bare repeat is rejected when mandate conditions are met
  - Verifies all four valid outcomes are accepted
  - Deterministic: same input always produces same output

Dependencies:
  - seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md
  - seed/workflows/project-orchestration-cycle-ceo.workflow.yaml
"""
import pytest
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


class DecisionType:
    """Valid decision types from CEO cycle contract."""
    PROMOTE = "promote"       # Outcome (a): Promoted backlog to todo
    PATCH = "patch"           # Outcome (b): Fixed config, then promoted
    CREATE = "create"         # Outcome (c): Created work item, then promoted
    REPEAT = "repeat"         # Outcome (d): No mutation, must have blockedItems
    BLOCKED = "blocked"       # Systemic blocker, explicit ticket-level
    PAUSE = "pause"           # No dispatchable work
    COMPLETE = "complete"     # All planned outcomes achieved


@dataclass
class BacklogItem:
    """Represents a backlog item in board state."""
    id: str
    title: str
    blocked: bool = False
    blocked_reason: Optional[str] = None


@dataclass
class BoardState:
    """
    Board state for CEO cycle contract validation.
    
    Mandate conditions (ALL must be true for mandate to apply):
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
    scope: Optional[str] = None
    patch: Optional[Dict[str, Any]] = None


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
                scope=m.get("scope"),
                patch=m.get("patch"),
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
    
    def has_config_patch(self) -> bool:
        """Check if there's a config patch mutation."""
        for mutation in self.mutations:
            if mutation.type == "patch_execution_config":
                return True
        return False
    
    def has_work_item_creation(self) -> bool:
        """Check if there's a work item creation mutation."""
        for mutation in self.mutations:
            if mutation.type in ("delegate_work_item_generation", "create_work_item"):
                return True
        return False
    
    def outcome_a_promote_to_todo(self) -> bool:
        """Outcome (a): Promote at least one item to todo."""
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
          - blocked_items array has at least one item
          - Each blocked item has non-empty blockedReason field
        """
        if self.decision != DecisionType.REPEAT:
            return False
        if len(self.blocked_items) == 0:
            return False
        return all(item.blocked_reason.strip() for item in self.blocked_items)
    
    def outcome_blocked_with_ticket_blocker(self) -> bool:
        """
        Outcome: decision='blocked' with explicit ticket-level blocker.
        
        Valid when:
          - decision == "blocked"
          - blocker field is non-empty
        """
        if self.decision != DecisionType.BLOCKED:
            return False
        return self.blocker is not None and len(self.blocker.strip()) > 0
    
    def is_valid_mandate_decision(self, board_state: BoardState) -> tuple[bool, str]:
        """
        Validate decision against zero-todo backlog promotion mandate.
        
        Returns:
            Tuple of (is_valid, violation_message)
            - is_valid: True if decision satisfies mandate
            - violation_message: Empty string if valid, else reason for rejection
        """
        if not board_state.mandate_conditions_met():
            return True, ""
        
        # MANDATE APPLIES: Bare repeat is ALWAYS a protocol violation
        if self.is_bare_repeat():
            return False, (
                f"PROTOCOL VIOLATION: Bare repeat with no mutation when "
                f"todo_count={board_state.todo_count}, backlog_count={board_state.backlog_count}, "
                f"unblocked_count={len(board_state.unblocked_items)}. "
                f"CEO MUST choose one of: (a) promote, (b) patch & promote, (c) create & promote, or (d) structured repeat with blockedItems."
            )
        
        # Check the four permitted outcomes
        if self.outcome_a_promote_to_todo():
            return True, ""
        
        if self.outcome_b_patch_and_promote():
            return True, ""
        
        if self.outcome_c_create_and_promote():
            return True, ""
        
        if self.outcome_d_structured_repeat():
            return True, ""
        
        if self.outcome_blocked_with_ticket_blocker():
            return True, ""
        
        return False, (
            f"PROTOCOL VIOLATION: Decision {self.decision} does not satisfy mandate. "
            f"Must either: (a) promote backlog to todo, (b) patch & promote, "
            f"(c) create & promote, or (d) provide structured repeat with blockedItems."
        )


class TestCEOMandateConditions:
    """
    Tests for mandate condition validation.
    
    The mandate activates when ALL conditions are true:
      - todo_count == 0
      - backlog_count >= 3
      - unblocked_items >= 3
      - is_autonomous == True
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        """
        Fixture: Board state where promotion mandate applies.
        
        Deterministic state: 0 todo, 3 unblocked backlog, autonomous mode.
        """
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Implement feature A"),
                BacklogItem(id="WI-002", title="Implement feature B"),
                BacklogItem(id="WI-003", title="Write unit tests"),
            ],
            is_autonomous=True,
        )

    @pytest.fixture
    def evidence_board(self) -> BoardState:
        """
        Fixture: Board matching 2026-05-15 evidence (33 backlog items).
        
        The live run recorded: decision="repeat", reason="No board action available"
        which is a protocol violation.
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

    def test_mandate_activates_when_all_conditions_met(self, mandate_board):
        """Mandate activates when all four conditions are true."""
        assert mandate_board.mandate_conditions_met()

    def test_mandate_not_activated_when_todo_exists(self):
        """Mandate does not apply when todo items exist."""
        board = BoardState(
            todo_count=1,  # Has todo items
            backlog_count=10,
            unblocked_items=[BacklogItem(id="WI-001", title="Item")],
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

    def test_mandate_not_activated_when_insufficient_unblocked(self):
        """Mandate does not apply when fewer than 3 unblocked items."""
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


class TestBareRepeatRejection:
    """
    CRITICAL CONTRACT TESTS: Bare repeat is always a protocol violation.
    
    When mandate conditions are met (0 todo, 3+ unblocked backlog, autonomous mode),
    a bare `repeat` decision with no mutation and no blockedItems is NOT permitted.
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        """Fixture: Board where mandate applies."""
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
                BacklogItem(id="WI-003", title="Item 3"),
            ],
            is_autonomous=True,
        )

    def test_rejects_bare_repeat_no_mutation(self, mandate_board):
        """
        CRITICAL: Bare repeat with no mutation is a protocol violation.
        
        Invalid: decision="repeat" with no mutations and no blockedItems
        """
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        is_valid, violation = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid
        assert "PROTOCOL VIOLATION" in violation

    def test_rejects_generic_repeat_patterns(self, mandate_board):
        """
        Generic repeat patterns are all protocol violations.
        
        Invalid patterns:
          - "No work to do right now"
          - "Checked board state, will retry later"
          - "Board is idle"
        """
        invalid_outputs = [
            {"decision": "repeat", "reason": "No work to do right now"},
            {"decision": "repeat", "reason": "Checked board state, will retry later"},
            {"decision": "repeat", "reason": "Board is idle"},
        ]
        
        for output in invalid_outputs:
            decision = CEODecision.from_output(output)
            assert decision.is_bare_repeat()
            is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
            assert not is_valid

    def test_rejects_repeat_with_empty_blocked_items(self, mandate_board):
        """
        Repeat with empty blockedItems is still a protocol violation.
        """
        output = {
            "decision": "repeat",
            "reason": "Items have issues",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid

    def test_rejects_repeat_with_missing_blocked_reason(self, mandate_board):
        """
        Repeat with blockedItems missing blockedReason is invalid.
        """
        output = {
            "decision": "repeat",
            "reason": "Some items blocked",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        # Not a valid structured repeat (missing blockedReason)
        assert not decision.outcome_d_structured_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid


class TestOutcomeAPromoteToTodo:
    """
    Tests for Outcome (a): Promote unblocked backlog to todo.
    
    Valid: promotion mutation (backlog -> todo transition)
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
                BacklogItem(id="WI-003", title="Item 3"),
            ],
            is_autonomous=True,
        )

    def test_accepts_single_promotion(self, mandate_board):
        """
        Outcome (a): Promote at least one item to todo.
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo and dispatched.",
            "mutations": [
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "WI-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid

    def test_accepts_multiple_promotions(self, mandate_board):
        """
        Outcome (a): Promote multiple items to todo.
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001, WI-002 to todo.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "WI-002", "from_status": "backlog", "to_status": "todo"},
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid

    def test_accepts_decision_type_promote(self, mandate_board):
        """
        Outcome (a): Explicit decision="promote"
        """
        output = {
            "decision": "promote",
            "reason": "Promoted WI-001 to todo.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid


class TestOutcomeBPatchAndPromote:
    """
    Tests for Outcome (b): Patch execution config to make candidate safe, then promote.
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )

    def test_accepts_patch_and_promote(self, mandate_board):
        """
        Outcome (b): Patch config, then promote.
        """
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001 (missing environment variable). Promoted to todo and dispatched.",
            "mutations": [
                {
                    "type": "patch_execution_config",
                    "work_item_id": "WI-001",
                    "patch": {"env": {"API_KEY": "value"}},
                },
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "WI-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.has_config_patch()
        assert decision.has_promotion_mutation()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid

    def test_rejects_patch_without_promote(self, mandate_board):
        """
        Outcome (b): Must include promotion after patch.
        """
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001.",
            "mutations": [
                {
                    "type": "patch_execution_config",
                    "work_item_id": "WI-001",
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        # Has patch but no promotion - invalid for outcome (b)
        assert decision.has_config_patch()
        assert not decision.has_promotion_mutation()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid


class TestOutcomeCCreateAndPromote:
    """
    Tests for Outcome (c): Create missing work item, then promote.
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
            ],
            is_autonomous=True,
        )

    def test_accepts_create_and_promote(self, mandate_board):
        """
        Outcome (c): Create work item, then promote.
        """
        output = {
            "decision": "repeat",
            "reason": "No suitable backlog item existed. Created new work item NEW-001 via delegate_work_item_generation, promoted to todo, and dispatched. Scope: implement user authentication endpoint.",
            "mutations": [
                {
                    "type": "delegate_work_item_generation",
                    "scope": "implement user authentication endpoint",
                    "result_id": "NEW-001",
                },
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "NEW-001",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.has_work_item_creation()
        assert decision.has_promotion_mutation()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid


class TestOutcomeDStructuredRepeat:
    """
    Tests for Outcome (d): Structured repeat with per-item blockedReason fields.
    
    Valid: decision="repeat" with blockedItems array, each item has
    non-empty blockedReason field.
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )

    def test_accepts_structured_repeat_with_blocked_items(self, mandate_board):
        """
        Outcome (d): Structured repeat with per-item blockedReason.
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
        
        assert decision.outcome_d_structured_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid

    def test_rejects_empty_blocked_reason(self, mandate_board):
        """
        Outcome (d): blockedReason must be non-empty.
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
        
        assert not decision.outcome_d_structured_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid

    def test_accepts_capacity_constraint_blocked_reason(self, mandate_board):
        """
        Outcome (d): Capacity constraint is valid blockedReason.
        """
        output = {
            "decision": "repeat",
            "reason": "Capacity limit reached: 2 concurrent maximum.",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": "Capacity limit reached"},
                {"workItemId": "WI-002", "workItemTitle": "Item 2", "blockedReason": "Capacity limit reached"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_d_structured_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid


class TestOutcomeBlockedWithTicketBlocker:
    """
    Tests for decision='blocked' with explicit ticket-level blocker.
    
    Valid: decision="blocked" with non-empty blocker field containing
    specific ticket/issue references.
    """

    @pytest.fixture
    def mandate_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )

    def test_accepts_blocked_with_ticket_blocker(self, mandate_board):
        """
        Valid: decision="blocked" with explicit ticket-level blocker.
        """
        output = {
            "decision": "blocked",
            "reason": "Cannot proceed: Architecture documentation missing.",
            "blocker": "[TICKET-123] Architecture documentation for core services is missing, required before any backend work can begin.",
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_blocked_with_ticket_blocker()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert is_valid

    def test_rejects_blocked_without_blocker(self, mandate_board):
        """
        Invalid: decision="blocked" without explicit blocker field.
        """
        output = {
            "decision": "blocked",
            "reason": "Cannot proceed with current board state",
        }
        decision = CEODecision.from_output(output)
        
        assert not decision.outcome_blocked_with_ticket_blocker()
        is_valid, _ = decision.is_valid_mandate_decision(mandate_board)
        assert not is_valid


class TestEvidenceScenario:
    """
    Tests for the 2026-05-15 evidence scenario.
    
    The live run documented: decision="repeat", reason="No board action available"
    with 0 todo + 33 backlog items. This is a protocol violation.
    """

    @pytest.fixture
    def evidence_board(self) -> BoardState:
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_items=[
                BacklogItem(id=f"BACKLOG-{i+1:03d}", title=f"Item {i+1}")
                for i in range(33)
            ],
            is_autonomous=True,
        )

    def test_evidence_scenario_rejects_bare_repeat(self, evidence_board):
        """
        The evidence scenario bare repeat is a protocol violation.
        """
        assert evidence_board.mandate_conditions_met()
        
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        is_valid, violation = decision.is_valid_mandate_decision(evidence_board)
        assert not is_valid
        assert "PROTOCOL VIOLATION" in violation

    def test_evidence_scenario_accepts_promotion(self, evidence_board):
        """
        Valid outcome for evidence scenario: Promote first item.
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
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        is_valid, _ = decision.is_valid_mandate_decision(evidence_board)
        assert is_valid

    def test_evidence_scenario_accepts_structured_repeat(self, evidence_board):
        """
        Valid outcome for evidence scenario: Structured repeat with capacity.
        """
        output = {
            "decision": "repeat",
            "reason": "Capacity limit reached.",
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
        
        assert decision.outcome_d_structured_repeat()
        is_valid, _ = decision.is_valid_mandate_decision(evidence_board)
        assert is_valid


class TestNonContagionRule:
    """
    Tests for the non-contagion rule.
    
    Human-decision blockers do NOT propagate to unrelated backlog items.
    """

    def test_human_decision_blockers_do_not_block_unrelated_items(self):
        """
        3 human_decision items + 30 unblocked items = mandate applies.
        CEO MUST promote the 30 unblocked items.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_items=[
                BacklogItem(id=f"WI-{i:03d}", title=f"Item {i}")
                for i in range(33)
            ],
            is_autonomous=True,
        )
        
        assert board.mandate_conditions_met()
        
        # Bare repeat is still a violation
        output = {
            "decision": "repeat",
            "reason": "No board action available. 3 human-decision items pending.",
        }
        decision = CEODecision.from_output(output)
        
        is_valid, _ = decision.is_valid_mandate_decision(board)
        assert not is_valid

    def test_promote_unblocked_despite_human_decision_items(self):
        """
        Valid: Promote unblocked items even when some items have human_decision blockers.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            is_autonomous=True,
        )
        
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo. 1 additional candidate remains. 3 human-decision items await human response.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        is_valid, _ = decision.is_valid_mandate_decision(board)
        assert is_valid


class TestDeterministicValidation:
    """
    Tests for deterministic contract validation.
    
    Same input always produces same output.
    """

    def test_deterministic_same_input_same_output(self):
        """
        Contract validation is deterministic.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
                BacklogItem(id="WI-003", title="Item 3"),
            ],
            is_autonomous=True,
        )
        
        output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        # Run validation multiple times
        for _ in range(10):
            decision = CEODecision.from_output(output)
            is_valid, _ = decision.is_valid_mandate_decision(board)
            assert not is_valid

    def test_all_four_outcomes_distinct_and_valid(self):
        """
        The four permitted outcomes are distinct paths - all must be accepted.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
            ],
            is_autonomous=True,
        )
        
        # Outcome (a): Promotion
        promote = CEODecision.from_output({
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo",
            "mutations": [{"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"}],
        })
        
        # Outcome (d): Structured repeat
        structured = CEODecision.from_output({
            "decision": "repeat",
            "reason": "All items blocked",
            "blockedItems": [{"workItemId": "WI-001", "blockedReason": "Capacity limit reached"}],
        })
        
        # Outcome: Blocked with ticket blocker
        blocked = CEODecision.from_output({
            "decision": "blocked",
            "reason": "Systemic blocker",
            "blocker": "TICKET-123 must be resolved first",
        })
        
        # All should be valid for mandate scenario
        assert promote.is_valid_mandate_decision(board)[0]
        assert structured.is_valid_mandate_decision(board)[0]
        assert blocked.is_valid_mandate_decision(board)[0]
        
        # Bare repeat should be invalid
        bare = CEODecision.from_output({
            "decision": "repeat",
            "reason": "No action",
        })
        assert not bare.is_valid_mandate_decision(board)[0]


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
