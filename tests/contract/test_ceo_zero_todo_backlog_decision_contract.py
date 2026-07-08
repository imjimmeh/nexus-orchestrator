"""
Contract Test: CEO Zero-Todo Backlog Decision Mandate

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

This contract test validates the runtime contract assertion that an autonomous 
cycle with zero todo + unblocked backlog never results in a plain `repeat` 
decision with no board mutation.

MANDATE:
When ALL of these conditions are true:
  - autonomous_mode = true
  - todo_count = 0
  - backlog_count > 0
  - Unblocked backlog items exist

The CEO decision MUST NOT be a bare `repeat` with no mutation.
The CEO MUST choose one of four valid outcomes:
  (a) PROMOTE: At least one unblocked backlog item promoted to todo
  (b) PATCH & PROMOTE: Execution config fixed, then promoted  
  (c) CREATE & PROMOTE: Work item created via delegation, then promoted
  (d) STRUCTURED BLOCKED: decision="repeat" with blockedItems array containing
      per-item blockedReason fields for ALL backlog items

EVIDENCE: 2026-05-15 analysis documented a live run where CEO concluded
"No board action available" while 33 backlog items existed - a protocol violation.

Test Design:
  - Deterministic mock board state
  - Validates decision output against mandate contract
  - Rejects bare repeat with no mutation
  - Accepts only the four valid outcomes
"""
import pytest
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any


class DecisionType:
    """Valid decision types per CEO cycle contract."""
    PROMOTE = "promote"     # Outcome (a)
    PATCH = "patch"         # Outcome (b)
    CREATE = "create"       # Outcome (c)
    REPEAT = "repeat"       # Outcome (d) or invalid bare repeat
    BLOCKED = "blocked"     # Systemic ticket-level blocker
    PAUSE = "pause"
    COMPLETE = "complete"


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
    Simulates board state for CEO cycle contract test.
    
    Mandate applies when ALL of these are true:
      - autonomous_mode = True
      - todo_count = 0
      - backlog_count > 0
      - At least one unblocked backlog item exists
    """
    todo_count: int
    backlog_count: int
    unblocked_items: List[BacklogItem] = field(default_factory=list)
    autonomous_mode: bool = True
    
    def mandate_conditions_met(self) -> bool:
        """Check if zero-todo backlog promotion mandate applies."""
        return (
            self.autonomous_mode and
            self.todo_count == 0 and
            self.backlog_count > 0 and
            len(self.unblocked_items) > 0
        )
    
    def all_backlog_blocked(self) -> bool:
        """Check if ALL backlog items are blocked."""
        return self.backlog_count > 0 and len(self.unblocked_items) == 0


@dataclass
class CEODecision:
    """
    Represents CEO cycle decision output for contract validation.
    
    Validates against the zero-todo backlog promotion mandate.
    """
    decision: str
    reason: str
    blocked_items: List[Dict[str, str]] = field(default_factory=list)
    mutations: List[Dict[str, Any]] = field(default_factory=list)
    
    @classmethod
    def from_output(cls, output: Dict[str, Any]) -> "CEODecision":
        """Parse from CEO decision output dict."""
        return cls(
            decision=output.get("decision", ""),
            reason=output.get("reason", ""),
            blocked_items=output.get("blockedItems", []) or [],
            mutations=output.get("mutations", []) or [],
        )
    
    def is_bare_repeat(self) -> bool:
        """
        Check if this is a BARE REPEAT - the protocol violation.
        
        A bare repeat has:
          - decision == "repeat"
          - NO mutations (no board changes made)
          - NO blocked_items with per-item blockedReason fields
        """
        if self.decision != "repeat":
            return False
        
        has_mutation = len(self.mutations) > 0
        has_blocked_items = (
            len(self.blocked_items) > 0 and
            all(item.get("blockedReason", "").strip() for item in self.blocked_items)
        )
        
        return not has_mutation and not has_blocked_items
    
    def outcome_a_promote_to_todo(self) -> bool:
        """
        Outcome (a): Promote unblocked backlog to todo.
        
        Valid when: promotion mutation exists (backlog -> todo transition)
        """
        for mutation in self.mutations:
            if mutation.get("type") == "patch_work_item_status":
                from_status = mutation.get("from_status", "")
                to_status = mutation.get("to_status", mutation.get("new_status", ""))
                if from_status == "backlog" and to_status == "todo":
                    return True
        return False
    
    def outcome_b_patch_config_then_promote(self) -> bool:
        """
        Outcome (b): Patch execution config, then promote.
        
        Valid when: config patch mutation AND promotion mutation both exist
        """
        has_patch = any(m.get("type") == "patch_execution_config" for m in self.mutations)
        has_promote = self.outcome_a_promote_to_todo()
        return has_patch and has_promote
    
    def outcome_c_create_and_promote(self) -> bool:
        """
        Outcome (c): Create work item via delegation, then promote.
        
        Valid when: creation mutation AND promotion mutation both exist
        """
        has_create = any(m.get("type") == "delegate_work_item_generation" for m in self.mutations)
        has_promote = self.outcome_a_promote_to_todo()
        return has_create and has_promote
    
    def outcome_d_structured_repeat_with_blocked_reasons(self) -> bool:
        """
        Outcome (d): Structured repeat with per-item blockedReason fields.
        
        Valid ONLY when:
          - decision == "repeat"
          - blocked_items array exists with at least one item
          - Each blocked item has non-empty blockedReason field
        """
        if self.decision != "repeat":
            return False
        if len(self.blocked_items) == 0:
            return False
        return all(
            item.get("blockedReason", "").strip() 
            for item in self.blocked_items
        )
    
    def is_valid_mandate_decision(self) -> bool:
        """
        Validate decision against zero-todo backlog promotion mandate.
        
        Returns True if decision satisfies one of the four valid outcomes.
        Returns False if decision is a bare repeat with no mutation.
        """
        # Reject bare repeat - the primary protocol violation
        if self.is_bare_repeat():
            return False
        
        # Accept any of the four valid outcomes
        return (
            self.outcome_a_promote_to_todo() or
            self.outcome_b_patch_config_then_promote() or
            self.outcome_c_create_and_promote() or
            self.outcome_d_structured_repeat_with_blocked_reasons()
        )


class TestZeroTodoBacklogDecisionContract:
    """
    Contract tests for CEO zero-todo autonomous backlog promotion mandate.
    
    Validates that the CEO never produces a bare `repeat` with no mutation
    when autonomous mode has zero todo items and unblocked backlog exists.
    """

    # =========================================================================
    # Fixtures
    # =========================================================================

    @pytest.fixture
    def mandate_board_state(self) -> BoardState:
        """
        Board state where mandate applies: 0 todo, 3 unblocked backlog, autonomous.
        """
        return BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Implement feature A", blocked=False),
                BacklogItem(id="WI-002", title="Implement feature B", blocked=False),
                BacklogItem(id="WI-003", title="Write tests", blocked=False),
            ],
            autonomous_mode=True,
        )

    @pytest.fixture
    def evidence_scenario_board(self) -> BoardState:
        """
        Board state from 2026-05-15 evidence: 0 todo, 33 unblocked backlog.
        
        Live run recorded: decision="repeat", reason="No board action available"
        This was a protocol violation - must be rejected by the contract.
        """
        return BoardState(
            todo_count=0,
            backlog_count=33,
            unblocked_items=[
                BacklogItem(id=f"BACKLOG-{i+1:03d}", title=f"Backlog Item {i+1}")
                for i in range(33)
            ],
            autonomous_mode=True,
        )

    # =========================================================================
    # Test: Mandate Conditions
    # =========================================================================

    def test_mandate_activates_when_all_conditions_true(self, mandate_board_state: BoardState):
        """
        Mandate activates when ALL conditions are met:
          - autonomous_mode = True
          - todo_count = 0
          - backlog_count > 0
          - At least one unblocked backlog item exists
        """
        assert mandate_board_state.mandate_conditions_met()

    def test_mandate_does_not_activate_when_todo_exists(self):
        """Mandate does not apply when todo items exist."""
        board = BoardState(
            todo_count=1,  # Has todo
            backlog_count=3,
            unblocked_items=[BacklogItem(id="WI-001", title="Item 1")],
            autonomous_mode=True,
        )
        assert not board.mandate_conditions_met()

    def test_mandate_does_not_activate_in_non_autonomous_mode(self):
        """Mandate does not apply in non-autonomous (supervised) mode."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[BacklogItem(id="WI-001", title="Item 1")],
            autonomous_mode=False,  # Not autonomous
        )
        assert not board.mandate_conditions_met()

    def test_mandate_does_not_activate_when_backlog_blocked(self):
        """Mandate does not apply when all backlog items are blocked."""
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[],  # All blocked
            autonomous_mode=True,
        )
        assert not board.mandate_conditions_met()
        assert board.all_backlog_blocked()

    # =========================================================================
    # Test: Bare Repeat Rejection (CRITICAL)
    # =========================================================================

    def test_rejects_bare_repeat_with_zero_todo_and_unblocked_backlog(
        self, mandate_board_state: BoardState
    ):
        """
        CRITICAL CONTRACT TEST: CEO must NOT produce bare repeat in this scenario.
        
        Scenario: autonomous_mode=true, todo_count=0, backlog_count=3, all unblocked
        Invalid: decision="repeat" with no mutations and no blockedItems
        
        This is the primary protocol violation documented in 2026-05-15 evidence.
        """
        decision = CEODecision(
            decision="repeat",
            reason="No board action available",
            blocked_items=[],
            mutations=[],
        )
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()
        assert mandate_board_state.mandate_conditions_met()

    def test_rejects_generic_repeat_patterns(self, mandate_board_state: BoardState):
        """
        Generic repeat patterns are also protocol violations.
        
        Invalid patterns:
          - "Checked board state, will retry later"
          - "No work to do right now"
          - "All items have issues, will monitor"
        """
        invalid_patterns = [
            {"decision": "repeat", "reason": "Checked board state, will retry later"},
            {"decision": "repeat", "reason": "No work to do right now"},
            {"decision": "repeat", "reason": "All items have issues, will monitor"},
            {"decision": "repeat", "reason": "Board is idle"},
            {"decision": "repeat", "reason": "No board action available"},
        ]
        
        for pattern in invalid_patterns:
            decision = CEODecision.from_output(pattern)
            assert decision.is_bare_repeat(), f"Should be bare repeat: {pattern['reason']}"
            assert not decision.is_valid_mandate_decision()

    def test_rejects_repeat_with_empty_blocked_items(self, mandate_board_state: BoardState):
        """
        Repeat with empty blockedItems array is still a protocol violation.
        
        The blockedItems array must contain at least one item with non-empty blockedReason.
        """
        output = {
            "decision": "repeat",
            "reason": "All items have issues",
            "blockedItems": [],  # Empty array
            "mutations": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (a) - Promote to Todo
    # =========================================================================

    def test_accepts_outcome_a_promote_single_item(self, mandate_board_state: BoardState):
        """
        Outcome (a): Promote single unblocked backlog item to todo.
        
        Valid: promotion mutation (backlog -> todo transition)
        """
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo. 2 additional unblocked candidates remain.",
            "mutations": [
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
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_accepts_outcome_a_promote_multiple_items(self, mandate_board_state: BoardState):
        """
        Outcome (a): Promote multiple unblocked backlog items to todo.
        
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

    def test_accepts_decision_type_promote(self, mandate_board_state: BoardState):
        """
        Outcome (a): decision="promote" explicitly.
        
        Valid: decision field is "promote" - no need to parse reason.
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
    # Test: Outcome (b) - Patch Config & Promote
    # =========================================================================

    def test_accepts_outcome_b_patch_config_then_promote(self, mandate_board_state: BoardState):
        """
        Outcome (b): Patch execution config, then promote.
        
        Valid: config patch mutation AND promotion mutation both exist
        """
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001 to fix missing DATABASE_URL. Promoted to todo.",
            "mutations": [
                {
                    "type": "patch_execution_config",
                    "work_item_id": "WI-001",
                    "patch": {"env": {"DATABASE_URL": "postgres://localhost/db"}},
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
        
        assert decision.outcome_b_patch_config_then_promote()
        assert decision.is_valid_mandate_decision()

    def test_rejects_outcome_b_config_patch_only(self, mandate_board_state: BoardState):
        """
        Outcome (b) validation: Config patch WITHOUT promotion is INVALID.
        
        CEO must patch config, THEN promote. Just patching is insufficient.
        """
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001 to fix missing DATABASE_URL.",
            "mutations": [
                {
                    "type": "patch_execution_config",
                    "work_item_id": "WI-001",
                    "patch": {"env": {"DATABASE_URL": "postgres://localhost/db"}},
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        # Config patch alone is not sufficient - must also promote
        assert not decision.outcome_b_patch_config_then_promote()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (c) - Create & Promote
    # =========================================================================

    def test_accepts_outcome_c_create_and_promote(self, mandate_board_state: BoardState):
        """
        Outcome (c): Create work item via delegation, then promote.
        
        Valid: creation mutation AND promotion mutation both exist
        """
        output = {
            "decision": "repeat",
            "reason": "No suitable backlog item existed. Created WI-NEW via delegation, promoted to todo.",
            "mutations": [
                {
                    "type": "delegate_work_item_generation",
                    "scope": "Implement auth service",
                    "result_id": "WI-NEW",
                },
                {
                    "type": "patch_work_item_status",
                    "work_item_id": "WI-NEW",
                    "from_status": "backlog",
                    "to_status": "todo",
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_c_create_and_promote()
        assert decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Outcome (d) - Structured Repeat with Blocked Reasons
    # =========================================================================

    def test_accepts_outcome_d_structured_repeat(self, mandate_board_state: BoardState):
        """
        Outcome (d): Structured repeat with per-item blockedReason fields.
        
        Valid: decision="repeat" with blockedItems array, each item has
        non-empty blockedReason field.
        """
        output = {
            "decision": "repeat",
            "reason": "Zero todo items and backlog exists, but all candidates blocked by unresolvable issues.",
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
        
        assert decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert decision.is_valid_mandate_decision()

    def test_rejects_outcome_d_missing_blocked_reason(self, mandate_board_state: BoardState):
        """
        Outcome (d) validation: Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedItems array contains item without blockedReason field.
        """
        output = {
            "decision": "repeat",
            "reason": "Items blocked",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1"},  # Missing blockedReason
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert not decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert not decision.is_valid_mandate_decision()

    def test_rejects_outcome_d_empty_blocked_reason(self, mandate_board_state: BoardState):
        """
        Outcome (d) validation: Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedReason exists but is empty string.
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
        
        assert not decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert not decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Evidence Scenario (33 backlog items)
    # =========================================================================

    def test_evidence_scenario_rejects_bare_repeat(self, evidence_scenario_board: BoardState):
        """
        Evidence scenario from 2026-05-15: 0 todo + 33 unblocked backlog.
        
        The live run documented: decision="repeat", reason="No board action available"
        This is a protocol violation - must be rejected.
        """
        assert evidence_scenario_board.mandate_conditions_met()
        assert evidence_scenario_board.backlog_count == 33
        
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.is_bare_repeat()
        assert not decision.is_valid_mandate_decision()

    def test_evidence_scenario_accepts_valid_outcome_a(self, evidence_scenario_board: BoardState):
        """
        Valid outcome (a) for evidence scenario: Promote first item.
        
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
                },
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()

    def test_evidence_scenario_accepts_valid_outcome_d(self, evidence_scenario_board: BoardState):
        """
        Valid outcome (d) for evidence scenario: Structured repeat with capacity constraint.
        
        This WOULD have satisfied the mandate if capacity truly blocked all items.
        """
        output = {
            "decision": "repeat",
            "reason": "Zero todo and 33 backlog candidates, but capacity limit reached.",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": f"BACKLOG-{i+1:03d}",
                    "workItemTitle": f"Item {i+1}",
                    "blockedReason": "Capacity limit reached; 2 items currently executing",
                }
                for i in range(33)
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert decision.is_valid_mandate_decision()

    # =========================================================================
    # Test: Deterministic Contract Validation
    # =========================================================================

    def test_deterministic_validation_is_consistent(self, mandate_board_state: BoardState):
        """
        Contract validation is deterministic: same input produces same output.
        
        This ensures reproducible test results.
        """
        invalid_output = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        
        # Run validation multiple times - should always be the same
        results = []
        for _ in range(10):
            decision = CEODecision.from_output(invalid_output)
            results.append(decision.is_valid_mandate_decision())
        
        # All results should be identical (all False for invalid input)
        assert all(not r for r in results), "Validation must be deterministic"

    def test_all_valid_outcomes_are_distinct(self, mandate_board_state: BoardState):
        """
        The four valid outcomes are distinct paths - each validates independently.
        """
        outcomes = [
            # Outcome (a): Promote
            {
                "decision": "repeat",
                "reason": "Promoted WI-001 to todo",
                "mutations": [{"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"}],
                "blockedItems": [],
            },
            # Outcome (b): Patch & Promote
            {
                "decision": "repeat",
                "reason": "Patched config, promoted WI-001",
                "mutations": [
                    {"type": "patch_execution_config"},
                    {"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"},
                ],
                "blockedItems": [],
            },
            # Outcome (c): Create & Promote
            {
                "decision": "repeat",
                "reason": "Created WI-NEW, promoted to todo",
                "mutations": [
                    {"type": "delegate_work_item_generation"},
                    {"type": "patch_work_item_status", "from_status": "backlog", "to_status": "todo"},
                ],
                "blockedItems": [],
            },
            # Outcome (d): Structured repeat
            {
                "decision": "repeat",
                "reason": "All items blocked by capacity",
                "mutations": [],
                "blockedItems": [
                    {"workItemId": "WI-001", "blockedReason": "Capacity limit reached"},
                ],
            },
        ]
        
        for i, output in enumerate(outcomes):
            decision = CEODecision.from_output(output)
            assert decision.is_valid_mandate_decision(), f"Outcome {i+1} should be valid"
        
        # Invalid: bare repeat
        bare_repeat = CEODecision.from_output({
            "decision": "repeat",
            "reason": "No action",
            "mutations": [],
            "blockedItems": [],
        })
        assert not bare_repeat.is_valid_mandate_decision()

    # =========================================================================
    # Test: Mixed Blocked/Unblocked Scenario
    # =========================================================================

    def test_mixed_scenario_accepts_promotion_of_unblocked_items(self):
        """
        Scenario: Some items blocked, some unblocked.
        
        CEO must promote the unblocked items (Outcome a).
        """
        board = BoardState(
            todo_count=0,
            backlog_count=5,
            unblocked_items=[
                BacklogItem(id="WI-001", title="Item 1"),
                BacklogItem(id="WI-002", title="Item 2"),
            ],
            autonomous_mode=True,
        )
        assert board.mandate_conditions_met()
        
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001, WI-002 to todo. 3 blocked items remain.",
            "mutations": [
                {"type": "patch_work_item_status", "work_item_id": "WI-001", "from_status": "backlog", "to_status": "todo"},
                {"type": "patch_work_item_status", "work_item_id": "WI-002", "from_status": "backlog", "to_status": "todo"},
            ],
            "blockedItems": [],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_a_promote_to_todo()
        assert decision.is_valid_mandate_decision()


class TestZeroTodoBacklogContractEdgeCases:
    """Edge case tests for the zero-todo backlog promotion mandate."""

    def test_non_autonomous_mode_allows_bare_repeat(self):
        """
        The mandate only applies in autonomous mode.
        
        In supervised/manual mode, bare repeat may be acceptable.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[BacklogItem(id="WI-001", title="Item 1")],
            autonomous_mode=False,  # Not autonomous
        )
        assert not board.mandate_conditions_met()
        
        # In non-autonomous mode, no mandate assertion
        # The contract doesn't require promotion in supervised mode

    def test_all_backlog_blocked_requires_outcome_d(self):
        """
        When ALL backlog items are blocked, outcome (d) is the only valid option.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=3,
            unblocked_items=[],  # All blocked
            autonomous_mode=True,
        )
        
        # Valid: Structured repeat with per-item blocked reasons
        output = {
            "decision": "repeat",
            "reason": "All 3 backlog items blocked by unresolvable issues",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "blockedReason": "Missing upstream API credentials"},
                {"workItemId": "WI-002", "blockedReason": "Blocked by WI-001"},
                {"workItemId": "WI-003", "blockedReason": "External dependency offline"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert decision.is_valid_mandate_decision()

    def test_capacity_constraint_valid_for_outcome_d(self):
        """
        Capacity constraint is a valid reason for outcome (d).
        
        When all backlog items are unblocked but capacity prevents dispatch,
        outcome (d) with per-item blockedReason is valid.
        """
        output = {
            "decision": "repeat",
            "reason": "Capacity limit reached: only 2 concurrent items allowed",
            "mutations": [],
            "blockedItems": [
                {"workItemId": "WI-001", "blockedReason": "Capacity limit: 2 concurrent maximum"},
                {"workItemId": "WI-002", "blockedReason": "Capacity limit: 2 concurrent maximum"},
            ],
        }
        decision = CEODecision.from_output(output)
        
        assert decision.outcome_d_structured_repeat_with_blocked_reasons()
        assert decision.is_valid_mandate_decision()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])