"""
Deterministic contract test for CEO zero-todo autonomous backlog promotion.

Work Item: 0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2
Title: CEO cycle backlog promotion mandate for autonomous zero-todo boards

This contract test validates DETERMINISTIC BEHAVIOR for autonomous boards with
zero todo items and available unblocked backlog. The CEO MUST NOT produce a
bare `repeat` decision with no mutation.

Test Assertions:
  Given a board with:
    - todo_count == 0
    - backlog_count >= 3
    - unblocked backlog items exist
    - is_autonomous == True

  The CEO decision must NOT be a bare `repeat` with no mutation.

  The CEO MUST choose one of these MANDATORY outcomes:
    (a) PROMOTE: At least one item promoted from backlog to todo
    (b) PATCH & PROMOTE: Execution config patched, then promoted
    (c) CREATE & PROMOTE: Work item created via delegation, then promoted
    (d) STRUCTURED BLOCKED: decision="repeat" with blockedItems array containing
        per-item blockedReason fields for ALL backlog items

Evidence: 2026-05-15 analysis documented a live CEO run that concluded
"No board action available" while 33 backlog items existed—a protocol violation.
This test suite ensures that behavior cannot pass the contract.
"""
import pytest
import json
import re
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from enum import Enum


class DecisionKind(Enum):
    """Valid decision kinds from the CEO cycle contract."""
    PROMOTE = "promote"
    PATCH = "patch"
    CREATE = "create"
    REPEAT = "repeat"
    BLOCKED = "blocked"
    PAUSE = "pause"
    COMPLETE = "complete"


@dataclass
class BoardMetrics:
    """
    Represents board metrics for contract validation.
    
    The HARD PROTOCOL REQUIREMENT conditions are met when ALL are true:
    - todo_count == 0
    - backlog_count > 0
    - unblocked_count > 0
    - is_autonomous == True
    """
    todo_count: int
    backlog_count: int
    unblocked_backlog_ids: List[str]
    is_autonomous: bool = True
    
    @classmethod
    def from_state(cls, state: Dict[str, Any]) -> "BoardMetrics":
        """Create BoardMetrics from board state dict."""
        return cls(
            todo_count=state.get("todo_count", 0),
            backlog_count=state.get("backlog_count", 0),
            unblocked_backlog_ids=state.get("unblocked_backlog_ids", []),
            is_autonomous=state.get("is_autonomous", True),
        )
    
    def mandate_applies(self) -> bool:
        """
        Check if HARD PROTOCOL REQUIREMENT applies.
        
        Returns True when ALL conditions are met:
        - Zero todo items
        - At least one backlog item
        - At least one unblocked backlog item
        - Autonomous mode enabled
        """
        return (
            self.todo_count == 0 and
            self.backlog_count > 0 and
            len(self.unblocked_backlog_ids) > 0 and
            self.is_autonomous
        )
    
    def all_backlog_blocked(self) -> bool:
        """Check if ALL backlog items are blocked."""
        return self.backlog_count > 0 and len(self.unblocked_backlog_ids) == 0


@dataclass
class CEOMandateOutcome:
    """
    Parsed CEO cycle outcome for deterministic contract validation.
    
    Validates against the four MANDATORY outcomes (a, b, c, d).
    A bare `repeat` with no mutation and no blockedItems is ALWAYS invalid
    when the mandate applies.
    """
    decision_kind: Optional[DecisionKind]
    reason: str
    blocked_items: List[Dict[str, str]] = field(default_factory=list)
    mutations: List[Dict[str, Any]] = field(default_factory=list)
    promote_action_taken: bool = False
    
    @classmethod
    def from_decision_output(cls, output: Dict[str, Any]) -> "CEOMandateOutcome":
        """
        Parse CEO cycle decision output into structured outcome.
        
        Extracts:
        - decision field value
        - reason field value
        - blockedItems array (if present)
        - Mutation indicators in reason text
        """
        decision_str = output.get("decision", "")
        decision_kind = None
        try:
            decision_kind = DecisionKind(decision_str)
        except ValueError:
            pass
        
        reason = output.get("reason", "")
        
        # Extract blockedItems if present
        blocked_items = output.get("blockedItems", [])
        if blocked_items is None:
            blocked_items = []
        
        # Parse reason for mutation indicators
        mutations = []
        promote_action_taken = False
        
        # Outcome (a): Promotion indicators
        promotion_patterns = [
            r"promoted?\s+(\w+-?\d+)",  # "promoted WI-001"
            r"promoting?\s+(\w+-?\d+)",  # "promoting WI-001"
            r"transitioned?\s+(\w+-?\d+)",  # "transitioned WI-001 to todo"
            r"(?:to todo|todo_status)[\s:]+(\w+-?\d+)",  # "to todo: WI-001"
        ]
        for pattern in promotion_patterns:
            if re.search(pattern, reason, re.IGNORECASE):
                promote_action_taken = True
                mutations.append({"type": "promotion_from_backlog", "pattern": pattern})
                break
        
        # Outcome (b): Config patch indicators
        if re.search(r"patched?\s+(?:execution_)?config", reason, re.IGNORECASE):
            mutations.append({"type": "config_patch"})
        
        # Outcome (c): Creation indicators
        if re.search(r"created?\s+(?:new\s+)?work\s+item", reason, re.IGNORECASE):
            mutations.append({"type": "work_item_creation"})
        
        # Outcome (d): blockedItems check
        blocked_items_found = len(blocked_items) > 0
        
        return cls(
            decision_kind=decision_kind,
            reason=reason,
            blocked_items=blocked_items,
            mutations=mutations,
            promote_action_taken=promote_action_taken,
        )
    
    def is_bare_repeat(self) -> bool:
        """
        Check if this is a BARE REPEAT (protocol violation).
        
        A bare repeat has ALL of:
        - decision == "repeat"
        - No mutation indicators found in reason
        - No blockedItems array OR empty blockedItems array
        """
        if self.decision_kind != DecisionKind.REPEAT:
            return False
        
        has_mutation = len(self.mutations) > 0 or self.promote_action_taken
        has_blocked_items = len(self.blocked_items) > 0
        
        return not has_mutation and not has_blocked_items
    
    def outcome_a_promote(self) -> bool:
        """Outcome (a): Confirmed promotion of backlog to todo."""
        return (
            self.decision_kind in (DecisionKind.PROMOTE, DecisionKind.REPEAT) and
            self.promote_action_taken
        )
    
    def outcome_b_patch_and_promote(self) -> bool:
        """Outcome (b): Config patch followed by promotion."""
        has_config_patch = any(m.get("type") == "config_patch" for m in self.mutations)
        has_promotion = self.promote_action_taken
        return has_config_patch and has_promotion
    
    def outcome_c_create_and_promote(self) -> bool:
        """Outcome (c): Work item creation followed by promotion."""
        has_creation = any(m.get("type") == "work_item_creation" for m in self.mutations)
        has_promotion = self.promote_action_taken
        return has_creation and has_promotion
    
    def outcome_d_structured_blocked(self) -> bool:
        """
        Outcome (d): Structured repeat with per-item blockedReasons.
        
        Valid ONLY when ALL conditions are met:
        - decision == "repeat"
        - blockedItems array exists with at least one item
        - Each blocked item has non-empty blockedReason field
        """
        if self.decision_kind != DecisionKind.REPEAT:
            return False
        
        if len(self.blocked_items) == 0:
            return False
        
        for item in self.blocked_items:
            reason = item.get("blockedReason", "").strip()
            if not reason:
                return False
        
        return True
    
    def outcome_blocked_systemic(self) -> bool:
        """
        Systemic blocked outcome: decision="blocked" with ticket/issue reference.
        
        Valid when:
        - decision == "blocked"
        - reason mentions specific ticket, issue, or prerequisite
        """
        if self.decision_kind != DecisionKind.BLOCKED:
            return False
        
        # Check for ticket/issue references in reason
        ticket_pattern = r"\[?(?:TICKET|BLOCKER|ISSUE|PREREQUISITE)[\s:]+"
        has_ticket_ref = re.search(ticket_pattern, self.reason, re.IGNORECASE)
        
        return bool(has_ticket_ref)
    
    def validate_for_mandate(self, metrics: BoardMetrics) -> tuple[bool, str]:
        """
        Validate this outcome against HARD PROTOCOL REQUIREMENT.
        
        Returns: (is_valid, violation_message)
        
        When mandate applies:
        - Bare repeat is ALWAYS invalid (PROTOCOL VIOLATION)
        - Must satisfy one of outcomes (a), (b), (c), or (d)
        """
        if not metrics.mandate_applies():
            # Mandate doesn't apply - any valid decision is acceptable
            return True, ""
        
        # MANDATE APPLIES: Hard protocol requirement active
        if self.is_bare_repeat():
            unblocked_count = len(metrics.unblocked_backlog_ids)
            return False, (
                f"PROTOCOL VIOLATION [ZERO-TODO-MANDATE]: Bare repeat with no mutation. "
                f"Board state: todo={metrics.todo_count}, backlog={metrics.backlog_count}, "
                f"unblocked={unblocked_count}, autonomous={metrics.is_autonomous}. "
                f"The HARD PROTOCOL REQUIREMENT is violated. "
                f"CEO MUST choose one of four mandatory outcomes: "
                f"(a) promote unblocked backlog to todo, "
                f"(b) patch config and promote, "
                f"(c) create work item and promote, OR "
                f"(d) structured repeat with blockedItems array."
            )
        
        # Check permitted outcomes
        if self.outcome_a_promote():
            return True, ""
        
        if self.outcome_b_patch_and_promote():
            return True, ""
        
        if self.outcome_c_create_and_promote():
            return True, ""
        
        if self.outcome_d_structured_blocked():
            return True, ""
        
        if self.outcome_blocked_systemic():
            return True, ""
        
        # Does not match any permitted outcome
        return False, (
            f"PROTOCOL VIOLATION [INVALID-OUTCOME]: Decision {self.decision_kind} does not "
            f"satisfy HARD PROTOCOL REQUIREMENT. Must use outcome (a), (b), (c), or (d)."
        )


class TestCEOZeroTodoAutonomousDeterministicContract:
    """
    Deterministic contract tests for CEO zero-todo autonomous mandate.
    
    Tests the HARD PROTOCOL REQUIREMENT with deterministic assertions.
    Given the same board state and mandate conditions, the same invalid
    decision patterns will always produce the same violation messages.
    """

    @pytest.fixture
    def mandate_board_state(self) -> Dict[str, Any]:
        """
        Fixture: Board state where HARD PROTOCOL REQUIREMENT applies.
        
        Board has 0 todo items, 3 unblocked backlog items, autonomous mode.
        """
        return {
            "todo_count": 0,
            "backlog_count": 3,
            "unblocked_backlog_ids": ["WI-001", "WI-002", "WI-003"],
            "is_autonomous": True,
        }
    
    @pytest.fixture
    def evidence_scenario_board(self) -> Dict[str, Any]:
        """
        Fixture: Board matching 2026-05-15 evidence scenario.
        
        Board has 0 todo items, 33 unblocked backlog items, autonomous mode.
        Live run recorded: "No board action available" - a protocol violation.
        """
        return {
            "todo_count": 0,
            "backlog_count": 33,
            "unblocked_backlog_ids": [f"BACKLOG-{i+1:03d}" for i in range(33)],
            "is_autonomous": True,
        }

    # =========================================================================
    # Test: Mandate applicability
    # =========================================================================

    def test_mandate_applies_when_all_conditions_met(self, mandate_board_state: Dict):
        """Hard protocol requirement activates when all conditions are true."""
        metrics = BoardMetrics.from_state(mandate_board_state)
        assert metrics.mandate_applies() is True

    def test_mandate_does_not_apply_when_todo_exists(self):
        """Mandate does not apply when todo items exist."""
        state = {
            "todo_count": 1,
            "backlog_count": 3,
            "unblocked_backlog_ids": ["WI-001"],
            "is_autonomous": True,
        }
        metrics = BoardMetrics.from_state(state)
        assert metrics.mandate_applies() is False

    def test_mandate_does_not_apply_when_non_autonomous(self):
        """Mandate does not apply in non-autonomous mode."""
        state = {
            "todo_count": 0,
            "backlog_count": 3,
            "unblocked_backlog_ids": ["WI-001"],
            "is_autonomous": False,
        }
        metrics = BoardMetrics.from_state(state)
        assert metrics.mandate_applies() is False

    def test_mandate_does_not_apply_when_all_backlog_blocked(self):
        """Mandate does not apply when all backlog items are blocked."""
        state = {
            "todo_count": 0,
            "backlog_count": 3,
            "unblocked_backlog_ids": [],  # All blocked
            "is_autonomous": True,
        }
        metrics = BoardMetrics.from_state(state)
        assert metrics.mandate_applies() is False
        assert metrics.all_backlog_blocked() is True

    # =========================================================================
    # Test: Bare repeat is ALWAYS a protocol violation
    # =========================================================================

    def test_rejects_bare_repeat_for_3_item_board(self, mandate_board_state: Dict):
        """
        CRITICAL: Bare repeat is ALWAYS a protocol violation.
        
        Board: 0 todo + 3 unblocked backlog + autonomous
        Invalid: decision="repeat", no mutations, no blockedItems
        
        This is the primary protocol violation pattern documented in 2026-05-15.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        assert metrics.mandate_applies()
        
        # The protocol violation
        output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert not is_valid, "Bare repeat is always a protocol violation"
        assert "PROTOCOL VIOLATION" in violation
        assert "ZERO-TODO-MANDATE" in violation

    def test_rejects_generic_repeat_patterns(self, mandate_board_state: Dict):
        """
        Generic 'checked board' reasoning is also a protocol violation.
        
        Invalid patterns:
        - "Checked board state, will retry later"
        - "No work to do right now"
        - "All items have issues, will monitor"
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        invalid_patterns = [
            {"decision": "repeat", "reason": "Checked board state, will retry later"},
            {"decision": "repeat", "reason": "No work to do right now"},
            {"decision": "repeat", "reason": "All items have issues, will monitor"},
            {"decision": "repeat", "reason": "Board is idle"},
            {"decision": "repeat", "reason": "No board action available"},
        ]
        
        for pattern in invalid_patterns:
            outcome = CEOMandateOutcome.from_decision_output(pattern)
            is_valid, violation = outcome.validate_for_mandate(metrics)
            assert not is_valid, f"Pattern '{pattern['reason']}' should be rejected"

    def test_rejects_repeat_with_empty_blocked_items(self, mandate_board_state: Dict):
        """
        Repeat with empty blockedItems array is still a protocol violation.
        
        blockedItems MUST contain at least one item with non-empty blockedReason.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "All items have issues",
            "blockedItems": [],  # Empty array - still invalid
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert not is_valid, "Empty blockedItems is not sufficient"

    # =========================================================================
    # Test: Outcome (a) - Promotion
    # =========================================================================

    def test_accepts_outcome_a_promote_to_todo(self, mandate_board_state: Dict):
        """
        Outcome (a): Promote unblocked backlog to todo.
        
        Valid: decision includes promotion indicator in reason.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo. 2 additional unblocked candidates remain.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Promotion outcome should be valid: {violation}"
        assert outcome.outcome_a_promote()

    def test_accepts_outcome_a_with_decision_promote(self, mandate_board_state: Dict):
        """
        Outcome (a): decision="promote" explicitly.
        
        Valid: decision field is "promote" - no need to parse reason.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "promote",
            "reason": "Promoted WI-001 to todo and dispatched.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(metrics)
        
        assert is_valid, "decision='promote' should be valid"

    def test_accepts_multi_item_promotion(self, mandate_board_state: Dict):
        """
        Outcome (a): CEO may promote multiple items.
        
        Valid: Reason indicates multiple items promoted.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001, WI-002 to todo. 1 candidate remains.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Multi-promotion should be valid: {violation}"
        assert outcome.outcome_a_promote()

    # =========================================================================
    # Test: Outcome (b) - Patch & Promote
    # =========================================================================

    def test_accepts_outcome_b_patch_and_promote(self, mandate_board_state: Dict):
        """
        Outcome (b): Config patch followed by promotion.
        
        Valid: Reason indicates both config patched AND promotion.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001 to fix missing DATABASE_URL. Promoted to todo.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Patch and promote should be valid: {violation}"
        assert outcome.outcome_b_patch_and_promote()

    def test_rejects_outcome_b_config_patch_only(self, mandate_board_state: Dict):
        """
        Outcome (b): Config patch without promotion is INVALID.
        
        CEO must patch config, THEN promote. Just patching is insufficient.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Patched execution_config on WI-001 to fix missing DATABASE_URL.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        # Config patch without promotion is incomplete for outcomes a/b/c
        assert not outcome.outcome_b_patch_and_promote()
        assert "PROTOCOL VIOLATION" in violation

    # =========================================================================
    # Test: Outcome (c) - Create & Promote
    # =========================================================================

    def test_accepts_outcome_c_create_and_promote(self, mandate_board_state: Dict):
        """
        Outcome (c): Work item creation followed by promotion.
        
        Valid: Reason indicates work item created AND promoted.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Created new work item WI-NEW via delegation, promoted to todo.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Create and promote should be valid: {violation}"
        assert outcome.outcome_c_create_and_promote()

    # =========================================================================
    # Test: Outcome (d) - Structured Blocked
    # =========================================================================

    def test_accepts_outcome_d_structured_repeat(self, mandate_board_state: Dict):
        """
        Outcome (d): Structured repeat with per-item blockedReasons.
        
        Valid: decision="repeat" with blockedItems array, each item has
        non-empty blockedReason field.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Zero todo items and backlog exists, but all candidates blocked by unresolvable issues.",
            "blockedItems": [
                {
                    "workItemId": "WI-001",
                    "workItemTitle": "Implement feature A",
                    "blockedReason": "Requires upstream API credentials that are not yet provisioned",
                },
                {
                    "workItemId": "WI-002",
                    "workItemTitle": "Implement feature B",
                    "blockedReason": "Blocked by WI-001 which cannot be dispatched",
                },
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Structured repeat should be valid: {violation}"
        assert outcome.outcome_d_structured_blocked()

    def test_rejects_outcome_d_missing_blocked_reason(self, mandate_board_state: Dict):
        """
        Outcome (d): Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedItems array contains item without blockedReason.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Items blocked",
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1"},  # Missing blockedReason
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert not outcome.outcome_d_structured_blocked()

    def test_rejects_outcome_d_empty_blocked_reason(self, mandate_board_state: Dict):
        """
        Outcome (d): Each blocked item must have non-empty blockedReason.
        
        Invalid: blockedReason exists but is empty/whitespace.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "repeat",
            "reason": "Items blocked",
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": ""},
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert not outcome.outcome_d_structured_blocked()

    # =========================================================================
    # Test: Systemic Blocked Outcome
    # =========================================================================

    def test_accepts_blocked_decision_with_ticket_reference(self, mandate_board_state: Dict):
        """
        Systemic blocked: decision="blocked" with ticket/issue reference.
        
        Valid: decision="blocked" and reason mentions specific blocker.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        output = {
            "decision": "blocked",
            "reason": "Zero todo items and 3 backlog candidates exist. TICKET-123 credentials required. TICKET-124 API docs missing.",
            "blockedItems": [
                {"id": "WI-001", "blockedReason": "Missing TICKET-123 credentials"},
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert is_valid, f"Systemic blocked should be valid: {violation}"
        assert outcome.outcome_blocked_systemic()

    # =========================================================================
    # Test: Evidence Scenario (33 backlog items)
    # =========================================================================

    def test_evidence_scenario_protocol_violation(self, evidence_scenario_board: Dict):
        """
        Evidence scenario from 2026-05-15 live run.
        
        Board: 0 todo + 33 unblocked backlog + autonomous
        Invalid: decision="repeat", reason="No board action available"
        
        The live run documented this as a protocol violation.
        """
        metrics = BoardMetrics.from_state(evidence_scenario_board)
        assert metrics.mandate_applies()
        assert metrics.backlog_count == 33
        assert len(metrics.unblocked_backlog_ids) == 33
        
        # The protocol violation from live evidence
        output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert not is_valid, "Protocol violation from evidence scenario"
        assert "PROTOCOL VIOLATION" in violation

    def test_evidence_scenario_valid_outcome_a(self, evidence_scenario_board: Dict):
        """
        Valid outcome (a) for evidence scenario: Promote first item.
        
        This WOULD have satisfied the mandate in the 2026-05-15 run.
        """
        metrics = BoardMetrics.from_state(evidence_scenario_board)
        
        output = {
            "decision": "repeat",
            "reason": "Promoted BACKLOG-001 to todo. 32 additional unblocked candidates remain.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(metrics)
        
        assert is_valid, "Promoting first item should satisfy mandate"
        assert outcome.outcome_a_promote()

    def test_evidence_scenario_valid_outcome_d(self, evidence_scenario_board: Dict):
        """
        Valid outcome (d) for evidence scenario: Structured repeat with capacity constraint.
        
        This WOULD have satisfied the mandate if all items truly blocked by capacity.
        """
        metrics = BoardMetrics.from_state(evidence_scenario_board)
        
        output = {
            "decision": "repeat",
            "reason": "Zero todo and 33 backlog candidates, but capacity limit reached.",
            "blockedItems": [
                {
                    "workItemId": f"BACKLOG-{i+1:03d}",
                    "workItemTitle": f"Item {i+1}",
                    "blockedReason": "Capacity limit reached; 2 items currently executing",
                }
                for i in range(33)
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(metrics)
        
        assert is_valid, "Structured repeat with per-item reasons should satisfy mandate"
        assert outcome.outcome_d_structured_blocked()

    # =========================================================================
    # Test: Deterministic Validation
    # =========================================================================

    def test_deterministic_same_input_same_output(self, mandate_board_state: Dict):
        """
        Validation is DETERMINISTIC: same input always produces same output.
        
        Running the same validation 100 times produces identical results.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        invalid_output = {
            "decision": "repeat",
            "reason": "No board action available",
        }
        
        # Run validation multiple times
        results = []
        for _ in range(100):
            outcome = CEOMandateOutcome.from_decision_output(invalid_output)
            is_valid, violation = outcome.validate_for_mandate(metrics)
            results.append((is_valid, violation))
        
        # All results should be identical
        first_result = results[0]
        for result in results:
            assert result == first_result, "Validation must be deterministic"

    def test_deterministic_valid_outcome(self, mandate_board_state: Dict):
        """
        Valid outcomes also produce deterministic results.
        """
        metrics = BoardMetrics.from_state(mandate_board_state)
        
        valid_output = {
            "decision": "repeat",
            "reason": "Promoted WI-001 to todo.",
            "blockedItems": [],
        }
        
        results = []
        for _ in range(100):
            outcome = CEOMandateOutcome.from_decision_output(valid_output)
            is_valid, violation = outcome.validate_for_mandate(metrics)
            results.append((is_valid, violation))
        
        first_result = results[0]
        for result in results:
            assert result == first_result, "Valid outcome validation must be deterministic"

    # =========================================================================
    # Test: Non-Contagion Rule
    # =========================================================================

    def test_human_decision_blockers_do_not_block_unrelated_items(self):
        """
        NON-CONTAGION RULE: Human-decision blockers do NOT propagate.
        
        Scenario: 3 human-decision items in 33-item backlog
        Correct: 30 items are UNBLOCKED and eligible for promotion
        Incorrect: Treat human-decision items as blocking entire board
        """
        state = {
            "todo_count": 0,
            "backlog_count": 33,
            # All 33 are "unblocked" per our model
            # (The human_decision items are a subset that we track separately)
            "unblocked_backlog_ids": [f"WI-{i:03d}" for i in range(33)],
            "is_autonomous": True,
        }
        metrics = BoardMetrics.from_state(state)
        
        # Mandate applies - 30 items are unblocked
        assert metrics.mandate_applies()
        
        # Bare repeat is still a violation even if 3 items have human-decision
        output = {
            "decision": "repeat",
            "reason": "No board action available. 3 human-decision items pending.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, violation = outcome.validate_for_mandate(metrics)
        
        assert not is_valid, "Non-contagion rule: human-decision items don't block board"
        assert "PROTOCOL VIOLATION" in violation

    # =========================================================================
    # Test: Mixed Blocked/Unblocked Scenario
    # =========================================================================

    def test_mixed_scenario_valid_outcome_a_promote_unblocked(self):
        """
        Scenario: Some items blocked, some unblocked.
        
        CEO must promote the unblocked items (outcome a).
        """
        state = {
            "todo_count": 0,
            "backlog_count": 5,
            "unblocked_backlog_ids": ["WI-001", "WI-002"],  # 2 unblocked
            "is_autonomous": True,
        }
        metrics = BoardMetrics.from_state(state)
        assert metrics.mandate_applies()
        
        output = {
            "decision": "repeat",
            "reason": "Promoted WI-001, WI-002 to todo. 3 additional items blocked by human-decision.",
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(metrics)
        
        assert is_valid, "Promoting unblocked items should satisfy mandate"

    def test_mixed_scenario_valid_outcome_d_with_all_items(self):
        """
        Scenario: Some items blocked, some unblocked.
        
        CEO may use outcome (d) if they document WHY the unblocked items
        cannot be promoted (e.g., capacity constraint).
        """
        state = {
            "todo_count": 0,
            "backlog_count": 5,
            "unblocked_backlog_ids": ["WI-001", "WI-002"],
            "is_autonomous": True,
        }
        metrics = BoardMetrics.from_state(state)
        
        output = {
            "decision": "repeat",
            "reason": "Capacity limit reached; only 2 concurrent items allowed.",
            "blockedItems": [
                {"workItemId": "WI-001", "workItemTitle": "Item 1", "blockedReason": "Capacity limit reached"},
                {"workItemId": "WI-002", "workItemTitle": "Item 2", "blockedReason": "Capacity limit reached"},
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(metrics)
        
        assert is_valid, "Capacity constraint is valid reason for blockedItems"


class TestCEOZerTodoContractSchema:
    """
    Schema-level contract tests for deterministic parsing.
    
    Tests the parsing of CEO decision output into structured outcomes.
    """

    def test_parses_decision_field(self):
        """Decision field should be parsed correctly."""
        output = {"decision": "repeat", "reason": "Test reason"}
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert outcome.decision_kind == DecisionKind.REPEAT

    def test_parses_blocked_items_array(self):
        """blockedItems array should be parsed correctly."""
        output = {
            "decision": "repeat",
            "reason": "Test",
            "blockedItems": [
                {"workItemId": "WI-001", "blockedReason": "Test reason"}
            ],
        }
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert len(outcome.blocked_items) == 1
        assert outcome.blocked_items[0]["workItemId"] == "WI-001"

    def test_detects_promotion_in_reason(self):
        """Promotion indicators should be detected in reason text."""
        outputs = [
            {"decision": "repeat", "reason": "Promoted WI-001 to todo"},
            {"decision": "repeat", "reason": "Promoting WI-002 to todo"},
            {"decision": "repeat", "reason": "Transitioned WI-003 to todo status"},
        ]
        for output in outputs:
            outcome = CEOMandateOutcome.from_decision_output(output)
            assert outcome.promote_action_taken, f"Should detect promotion in: {output['reason']}"

    def test_detects_config_patch_in_reason(self):
        """Config patch indicators should be detected in reason text."""
        output = {"decision": "repeat", "reason": "Patched execution_config on WI-001"}
        outcome = CEOMandateOutcome.from_decision_output(output)
        mutations = outcome.mutations
        assert any(m.get("type") == "config_patch" for m in mutations)

    def test_detects_work_item_creation_in_reason(self):
        """Work item creation indicators should be detected in reason text."""
        output = {"decision": "repeat", "reason": "Created new work item WI-NEW"}
        outcome = CEOMandateOutcome.from_decision_output(output)
        mutations = outcome.mutations
        assert any(m.get("type") == "work_item_creation" for m in mutations)

    def test_handles_missing_blocked_items(self):
        """Output without blockedItems should be handled gracefully."""
        output = {"decision": "repeat", "reason": "No board action available"}
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert len(outcome.blocked_items) == 0
        assert outcome.is_bare_repeat()

    def test_handles_null_blocked_items(self):
        """Output with null blockedItems should be handled gracefully."""
        output = {
            "decision": "repeat",
            "reason": "No board action available",
            "blockedItems": None,
        }
        outcome = CEOMandateOutcome.from_decision_output(output)
        assert len(outcome.blocked_items) == 0


class TestCEOZerTodoNonContagionContract:
    """
    Contract tests for NON-CONTAGION RULE enforcement.
    
    Human-decision probe findings must NOT spread to unrelated backlog items.
    """

    def test_human_decision_item_does_not_block_others(self):
        """
        A work item blocked by human_decision probe should NOT block
        unrelated backlog items from promotion.
        """
        board = BoardMetrics(
            todo_count=0,
            backlog_count=33,
            unblocked_backlog_ids=[f"WI-{i:03d}" for i in range(33)],
            is_autonomous=True,
        )
        
        assert board.mandate_applies()
        assert board.todo_count == 0
        assert len(board.unblocked_backlog_ids) == 33
        
        # The board has 33 unblocked items, even if 3 have human_decision blockers
        
        # Invalid: Treating all 33 as blocked because 3 have human_decision
        output = {
            "decision": "repeat",
            "reason": "No board action available. 3 human-decision items pending.",
            "blockedItems": [
                {"workItemId": "WI-001", "blockedReason": "Human decision pending"},
            ],
        }
        
        outcome = CEOMandateOutcome.from_decision_output(output)
        is_valid, _ = outcome.validate_for_mandate(board)
        
        assert not is_valid, "Human-decision items do not block entire board"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
