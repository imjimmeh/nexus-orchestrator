"""
Runtime contract tests for CEO zero-todo mandate (TC-001 through TC-012).

This test file directly implements the 12 test cases defined in the contract
spec at:
  seed/workflows/prompts/project-orchestration-cycle-ceo/test_ceo_zero_todo_mandate.spec.md

Test cases (per the spec's "Test Cases" table):

| TC-ID  | Scenario                                                              | Expected Outcome                | Valid |
|--------|-----------------------------------------------------------------------|---------------------------------|-------|
| TC-001 | todo_count=0, backlog_count>0, safe unblocked items exist             | decision: promote               | OK    |
| TC-002 | todo_count=0, backlog_count>0, fixable config blocker                 | decision: patch                 | OK    |
| TC-003 | todo_count=0, backlog_count>0, no suitable backlog                    | decision: create                | OK    |
| TC-004 | todo_count=0, backlog_count>0, all items blocked by unresolvable     | decision: repeat + blockedItems | OK    |
| TC-005 | todo_count=0, backlog_count>0, systemic ticket-level blocker         | decision: blocked               | OK    |
| TC-006 | todo_count=0, backlog_count>0, unblocked backlog                      | bare decision: repeat           | FAIL  |
| TC-007 | todo_count=0, backlog_count>0                                         | repeat with generic reason      | FAIL  |
| TC-008 | todo_count=0, backlog_count>0                                         | repeat with "Will monitor"      | FAIL  |
| TC-009 | todo_count=0, backlog_count>0                                         | repeat with "Board is idle"     | FAIL  |
| TC-010 | 3 human_decision items in 33-item backlog                             | bare repeat                     | FAIL  |
| TC-011 | repeat without blockedItems array when backlog_count>0                | repeat with generic reason      | FAIL  |
| TC-012 | repeat with placeholder blockedItems (no actual UUIDs)                | repeat with placeholder items   | FAIL  |

The validator below implements the rules from the spec:

  - decision MUST be one of: promote | patch | create | repeat | blocked
  - When decision=repeat and backlog_count>0, blockedItems MUST be present,
    each item MUST have workItemId (real UUID, not placeholder),
    workItemTitle, and blockedReason (specific, not generic).
  - Forbidden reason substrings: "will monitor", "board is idle", etc.
  - Non-contagion rule: human_decision blockers MUST NOT be treated as
    board-wide blockers.

The file also loads the workflow YAML to confirm that the 12 TC entries are
declared in the workflow's `contract_tests` section, with a clear skip
message when the YAML is missing or malformed.
"""
from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pytest
import yaml


# ============================================================================
# Constants and patterns (mirroring the spec's validation rules)
# ============================================================================

#: Decisions permitted by the spec's MUST requirements.
PERMITTED_DECISIONS: frozenset = frozenset({
    "promote",
    "patch",
    "create",
    "repeat",
    "blocked",
})

#: Decisions that are non-mandate outcomes (allowed in the composite tool).
#: Kept for schema tolerance; not strictly required by the spec.
COMPOSITE_DECISIONS: frozenset = frozenset({"pause", "complete"})

#: All decisions accepted by the validator (union of the two sets).
ALL_DECISIONS: frozenset = PERMITTED_DECISIONS | COMPOSITE_DECISIONS

#: UUID v4 / v1 format (case-insensitive).
UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

#: Patterns that mark a workItemId as a placeholder rather than a real UUID.
PLACEHOLDER_WORK_ITEM_ID_PATTERNS: Tuple[re.Pattern, ...] = (
    re.compile(r"^<.+>$"),                              # <uuid>, <workItemId>
    re.compile(r"^\$\{.+\}$"),                          # ${itemId}
    re.compile(r"^\{\{.+\}\}$"),                        # {{itemId}}
    re.compile(r"^(?:TBD|TODO|FIXME|XXX|placeholder|null|none|undefined|n/a|na)$", re.I),
    re.compile(r"^\?+$"),
    re.compile(r"^0+$"),                                # bare all-zeros
    re.compile(r"^[a-z0-9_-]{1,3}$", re.I),              # very short tokens
    # UUID-shaped all-zeros placeholder (e.g. 00000000-0000-0000-0000-000000000000).
    re.compile(
        r"^0{8}-0{4}-0{4}-0{4}-0{12}$",
    ),
    # UUID-shaped placeholder using repeated '0' segments with placeholder
    # words between them (defensive against the broken regex above).
    re.compile(
        r"^0+[-_]0+[-_]0+[-_]0+[-_]0+$",
    ),
)

#: Forbidden reason substrings (case-insensitive) per the spec's MUST NOT list.
FORBIDDEN_REASON_SUBSTRINGS: Tuple[str, ...] = (
    "will monitor",
    "board is idle",
    "no board action available",
    "no work to do",
)

#: Generic blockedReason patterns that are too generic per the spec.
GENERIC_BLOCKED_REASON_PATTERNS: Tuple[re.Pattern, ...] = (
    re.compile(r"^\s*blocked\s*$", re.I),
    re.compile(r"^\s*cannot proceed\s*$", re.I),
    re.compile(r"^\s*waiting on upstream\s*$", re.I),
    re.compile(r"^\s*issues exist\s*$", re.I),
    re.compile(r"^\s*will monitor\s*$", re.I),
    re.compile(r"^\s*will retry\s*$", re.I),
    re.compile(r"^\s*unspecified\s*$", re.I),
    re.compile(r"^\s*n/?a\s*$", re.I),
    re.compile(r"^\s*unknown\s*$", re.I),
)

#: Required keys for each blockedItem entry.
REQUIRED_BLOCKED_ITEM_KEYS: Tuple[str, ...] = ("workItemId", "workItemTitle", "blockedReason")

#: All 12 TC identifiers, in spec-table order.
ALL_TC_IDS: Tuple[str, ...] = (
    "TC-001", "TC-002", "TC-003", "TC-004", "TC-005",
    "TC-006", "TC-007", "TC-008", "TC-009", "TC-010", "TC-011", "TC-012",
)


# ============================================================================
# Fixture data
# ============================================================================

#: A real-looking Kanban UUID used in fixture payloads. Deterministic and
#: parseable as a UUID so that the validator's "is real UUID" check is
#: exercised.
REAL_UUID_1 = "70be6e91-6f03-4b92-bb39-4e65a3523c0e"
REAL_UUID_2 = "5d2c7b41-9a14-4b58-9c3a-1f0a5b6e2d77"
REAL_UUID_3 = "0a6ffbd8-2365-4e9c-b046-fc7972cfb9d2"
REAL_UUID_4 = "abc12345-1234-4abc-9def-1234567890ab"


@dataclass
class BoardState:
    """Minimal board state required to evaluate the mandate."""

    todo_count: int
    backlog_count: int
    autonomous_mode: bool = True
    human_decision_blocked_count: int = 0  # for TC-010 non-contagion rule

    def mandate_conditions_met(self) -> bool:
        """Mandate applies when all three base conditions are true."""
        return (
            self.todo_count == 0
            and self.backlog_count > 0
            and self.autonomous_mode
        )


@dataclass
class ValidationFailure:
    """A single validation failure, used in validation result lists."""

    code: str
    message: str

    def __str__(self) -> str:  # pragma: no cover - trivial
        return f"[{self.code}] {self.message}"


@dataclass
class ValidationResult:
    """Result of validating a CEO decision payload."""

    is_valid: bool
    failures: List[ValidationFailure] = field(default_factory=list)
    decision: str = ""
    raw_payload: Optional[Dict[str, Any]] = None

    @property
    def violation_codes(self) -> List[str]:
        return [f.code for f in self.failures]


# ============================================================================
# Validator implementation
# ============================================================================


class MandateContractValidator:
    """
    Validates a CEO decision payload against the zero-todo mandate.

    The validator implements the MUST / MUST NOT requirements from
    `test_ceo_zero_todo_mandate.spec.md`. It is intentionally self-contained
    so the tests can run against a deterministic in-memory model without
    requiring a live workflow run.
    """

    def __init__(
        self,
        board_state: BoardState,
        decision_payload: Dict[str, Any],
    ) -> None:
        self.board_state = board_state
        self.payload = dict(decision_payload or {})

    # --- Decision field -----------------------------------------------------

    def _decision(self) -> str:
        return str(self.payload.get("decision", "") or "").strip().lower()

    def _reason(self) -> str:
        return str(self.payload.get("reason", "") or "")

    def _blocked_items(self) -> List[Dict[str, Any]]:
        items = self.payload.get("blockedItems")
        if items is None:
            return []
        if not isinstance(items, list):
            return []
        return [i for i in items if isinstance(i, dict)]

    def _mutations(self) -> List[Dict[str, Any]]:
        mutations = self.payload.get("mutations")
        if mutations is None:
            return []
        if not isinstance(mutations, list):
            return []
        return [m for m in mutations if isinstance(m, dict)]

    def _blocker(self) -> str:
        return str(self.payload.get("blocker", "") or "").strip()

    def _human_decision_blockers_in_reason(self) -> int:
        """Count the human-decision blockers mentioned in the reason text."""
        reason = self._reason().lower()
        if "human_decision" in reason or "human decision" in reason:
            # Find phrases like "3 blocked human-decision items"
            m = re.search(r"(\d+)\s+(?:blocked\s+)?human[_\s-]?decision", reason)
            if m:
                return int(m.group(1))
            return 1
        return 0

    # --- Public entry point -------------------------------------------------

    def validate(self) -> ValidationResult:
        """
        Run all mandate checks and return a ValidationResult.

        The result is valid if and only if the failure list is empty.
        """
        failures: List[ValidationFailure] = []
        decision = self._decision()
        result = ValidationResult(
            is_valid=True,
            failures=failures,
            decision=decision,
            raw_payload=self.payload,
        )

        # Step 1: decision must be present and permitted.
        if not decision:
            failures.append(ValidationFailure(
                "DECISION_MISSING",
                "decision field is required and must be non-empty",
            ))
            result.is_valid = False
            return result

        if decision not in ALL_DECISIONS:
            failures.append(ValidationFailure(
                "DECISION_NOT_PERMITTED",
                f"decision '{decision}' is not in the permitted set: "
                f"{sorted(ALL_DECISIONS)}",
            ))
            result.is_valid = False
            return result

        # Non-mandate decisions (pause/complete) are not subject to the
        # zero-todo mandate - return early as valid.
        if decision in COMPOSITE_DECISIONS:
            return result

        # From here on, decision is in {promote, patch, create, repeat,
        # blocked} and we apply the mandate rules.
        mandate_applies = self.board_state.mandate_conditions_met()

        if decision == "repeat":
            self._validate_repeat(failures, mandate_applies)
        elif decision == "blocked":
            self._validate_blocked(failures, mandate_applies)
        else:
            # promote, patch, create: validate the corresponding payload.
            self._validate_mutation_decision(decision, failures)

        # Forbidden reason substrings apply whenever the mandate applies.
        if mandate_applies:
            self._validate_reason(failures)
            self._validate_non_contagion(failures)

        result.is_valid = not failures
        return result

    # --- Per-decision rules -------------------------------------------------

    def _validate_repeat(
        self,
        failures: List[ValidationFailure],
        mandate_applies: bool,
    ) -> None:
        """
        Apply the rules for `decision: repeat`.

        When the mandate applies and backlog_count>0, the spec requires
        blockedItems to be present with real UUIDs and specific reasons.
        """
        if not mandate_applies:
            return

        # TC-006 / TC-011: bare repeat with no blockedItems is a violation.
        items = self._blocked_items()
        if not items:
            failures.append(ValidationFailure(
                "BARE_REPEAT_FORBIDDEN",
                "decision='repeat' with no blockedItems is forbidden when "
                "todo_count=0, backlog_count>0, and autonomous_mode=true; "
                "the CEO MUST choose promote, patch, create, or provide "
                "structured repeat with per-item blockedItems",
            ))
            return

        # Each blockedItem must have all required keys with valid values.
        for idx, item in enumerate(items):
            for key in REQUIRED_BLOCKED_ITEM_KEYS:
                value = item.get(key)
                if value is None or (isinstance(value, str) and not value.strip()):
                    failures.append(ValidationFailure(
                        "BLOCKED_ITEM_MISSING_FIELD",
                        f"blockedItems[{idx}] is missing required field "
                        f"'{key}' or has empty value",
                    ))

            work_item_id = item.get("workItemId", "")
            if work_item_id and not self._is_real_uuid(work_item_id):
                failures.append(ValidationFailure(
                    "BLOCKED_ITEM_PLACEHOLDER_UUID",
                    f"blockedItems[{idx}].workItemId='{work_item_id}' is a "
                    f"placeholder, not an actual Kanban UUID",
                ))

            blocked_reason = item.get("blockedReason", "")
            if blocked_reason and self._is_generic_blocked_reason(blocked_reason):
                failures.append(ValidationFailure(
                    "BLOCKED_ITEM_GENERIC_REASON",
                    f"blockedItems[{idx}].blockedReason='{blocked_reason}' "
                    f"is too generic; must be a specific, actionable explanation",
                ))

    def _validate_blocked(
        self,
        failures: List[ValidationFailure],
        mandate_applies: bool,
    ) -> None:
        """
        Apply the rules for `decision: blocked`.

        Per the spec, `blocked` is a systemic ticket-level blocker; the
        payload must include an explicit blocker field that mentions a
        ticket/issue reference.
        """
        blocker = self._blocker()
        if not blocker:
            failures.append(ValidationFailure(
                "BLOCKED_MISSING_BLOCKER",
                "decision='blocked' requires a non-empty 'blocker' field "
                "with explicit ticket-level evidence",
            ))
            return

        # TC-005 expects a systemic (board-wide) ticket-level reference.
        # We require the blocker to mention a ticket/issue identifier OR
        # be phrased as a systemic statement.
        ticket_pattern = re.compile(
            r"\b(?:TICKET|BLOCKER|ISSUE|PREREQUISITE)\b[_\-\s:]*[A-Z0-9-]+",
            re.IGNORECASE,
        )
        systemic_pattern = re.compile(
            r"\b(?:all|every|board[- ]wide|systemic|project[- ]wide|credentials"
            r"|infrastructure|environment)\b",
            re.IGNORECASE,
        )
        if not (ticket_pattern.search(blocker) or systemic_pattern.search(blocker)):
            failures.append(ValidationFailure(
                "BLOCKED_NON_SYSTEMIC",
                "decision='blocked' blocker field must reference a "
                "specific ticket/issue or describe a systemic (board-wide) "
                f"condition; got: {blocker!r}",
            ))

    def _validate_mutation_decision(
        self,
        decision: str,
        failures: List[ValidationFailure],
    ) -> None:
        """
        Apply the rules for `decision: promote | patch | create`.

        Each decision requires the corresponding mutation payload to be
        present in the `mutations` array.
        """
        mutations = self._mutations()
        types_present = {str(m.get("type", "")).strip() for m in mutations}

        if decision == "promote":
            promote_muts = [
                m for m in mutations
                if m.get("type") == "patch_work_item_status"
                and m.get("from_status") == "backlog"
                and m.get("to_status") == "todo"
            ]
            if not promote_muts:
                failures.append(ValidationFailure(
                    "PROMOTE_MISSING_MUTATION",
                    "decision='promote' requires at least one "
                    "patch_work_item_status mutation from backlog to todo",
                ))

        elif decision == "patch":
            has_patch = any(m.get("type") == "patch_execution_config" for m in mutations)
            has_promote = any(
                m.get("type") == "patch_work_item_status"
                and m.get("from_status") == "backlog"
                and m.get("to_status") == "todo"
                for m in mutations
            )
            if not (has_patch and has_promote):
                failures.append(ValidationFailure(
                    "PATCH_MISSING_MUTATION",
                    "decision='patch' requires both a "
                    "patch_execution_config mutation and a "
                    "patch_work_item_status mutation from backlog to todo",
                ))

        elif decision == "create":
            has_create = any(
                m.get("type") in ("delegate_work_item_generation", "create_work_item")
                for m in mutations
            )
            has_promote = any(
                m.get("type") == "patch_work_item_status"
                and m.get("from_status") == "backlog"
                and m.get("to_status") == "todo"
                for m in mutations
            )
            if not (has_create and has_promote):
                failures.append(ValidationFailure(
                    "CREATE_MISSING_MUTATION",
                    "decision='create' requires both a "
                    "delegate_work_item_generation mutation and a "
                    "patch_work_item_status mutation from backlog to todo",
                ))

    def _validate_reason(self, failures: List[ValidationFailure]) -> None:
        """Apply forbidden reason substring rules (TC-007..TC-009)."""
        reason = self._reason().lower()
        for forbidden in FORBIDDEN_REASON_SUBSTRINGS:
            if forbidden in reason:
                failures.append(ValidationFailure(
                    "FORBIDDEN_REASON",
                    f"reason contains forbidden substring '{forbidden}'",
                ))

    def _validate_non_contagion(self, failures: List[ValidationFailure]) -> None:
        """
        Apply the non-contagion rule (TC-010).

        human_decision blockers apply ONLY to the flagged work item. They
        MUST NOT be treated as a board-wide blocker. If the reason claims
        a board-wide blocker based on human_decision items only, that is a
        protocol violation.
        """
        reason_lower = self._reason().lower()
        # Accept any common separator between the words "human" and
        # "decision" so evidence phrasings like "human-decision",
        # "human_decision", and "human decision" are all caught.
        has_human_decision = bool(
            re.search(r"\bhuman[\s_\-]?decision\b", reason_lower)
        )
        has_board_wide_claim = (
            "no board action" in reason_lower
            or "entire board" in reason_lower
            or "board-wide" in reason_lower
            or "no work to do" in reason_lower
        )
        if has_human_decision and has_board_wide_claim:
            failures.append(ValidationFailure(
                "NON_CONTAGION_VIOLATION",
                "reason treats human_decision blockers as a board-wide "
                "blocker; human_decision applies ONLY to the flagged work "
                "item, not to unrelated backlog items",
            ))

    # --- Helpers ------------------------------------------------------------

    @staticmethod
    def _is_real_uuid(value: str) -> bool:
        if not isinstance(value, str):
            return False
        candidate = value.strip()
        if not UUID_PATTERN.match(candidate):
            return False
        if any(p.match(candidate) for p in PLACEHOLDER_WORK_ITEM_ID_PATTERNS):
            return False
        return True

    @staticmethod
    def _is_generic_blocked_reason(value: str) -> bool:
        if not isinstance(value, str):
            return True
        return any(p.match(value) for p in GENERIC_BLOCKED_REASON_PATTERNS)


# ============================================================================
# Helpers for building fixtures
# ============================================================================


def _make_promote_payload(work_item_id: str = REAL_UUID_1) -> Dict[str, Any]:
    """Return a valid TC-001 `promote` payload."""
    return {
        "decision": "promote",
        "reason": (
            f"Promoted {work_item_id} to todo. Remaining backlog candidates "
            "are unblocked and ready for the next cycle."
        ),
        "mutations": [
            {
                "type": "patch_work_item_status",
                "work_item_id": work_item_id,
                "from_status": "backlog",
                "to_status": "todo",
            },
        ],
        "blockedItems": [],
    }


def _make_patch_payload(work_item_id: str = REAL_UUID_2) -> Dict[str, Any]:
    """Return a valid TC-002 `patch` payload."""
    return {
        "decision": "patch",
        "reason": (
            f"Patched execution_config on {work_item_id} to fix missing "
            "DATABASE_URL; promoted to todo."
        ),
        "mutations": [
            {
                "type": "patch_execution_config",
                "work_item_id": work_item_id,
                "patch": {"env": {"DATABASE_URL": "postgres://localhost/db"}},
            },
            {
                "type": "patch_work_item_status",
                "work_item_id": work_item_id,
                "from_status": "backlog",
                "to_status": "todo",
            },
        ],
        "blockedItems": [],
    }


def _make_create_payload(work_item_id: str = REAL_UUID_3) -> Dict[str, Any]:
    """Return a valid TC-003 `create` payload."""
    return {
        "decision": "create",
        "reason": (
            f"No suitable backlog candidate existed. Created {work_item_id} "
            "via delegate_work_item_generation, promoted to todo."
        ),
        "mutations": [
            {
                "type": "delegate_work_item_generation",
                "scope": "Implement authentication endpoint",
                "result_id": work_item_id,
            },
            {
                "type": "patch_work_item_status",
                "work_item_id": work_item_id,
                "from_status": "backlog",
                "to_status": "todo",
            },
        ],
        "blockedItems": [],
    }


def _make_repeat_with_blocked_items_payload(
    work_item_ids: Optional[List[str]] = None,
    blocked_reasons: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Return a valid TC-004 `repeat` payload with structured blockedItems."""
    if work_item_ids is None:
        work_item_ids = [REAL_UUID_1, REAL_UUID_2]
    if blocked_reasons is None:
        blocked_reasons = [
            "Requires upstream API credentials that are not yet provisioned "
            "and no workaround exists",
            f"Blocked by {work_item_ids[0]} which cannot be dispatched",
        ]
    blocked_items = [
        {
            "workItemId": wid,
            "workItemTitle": f"Backlog item {i + 1}",
            "blockedReason": reason,
        }
        for i, (wid, reason) in enumerate(zip(work_item_ids, blocked_reasons))
    ]
    return {
        "decision": "repeat",
        "reason": (
            "Zero todo items and backlog exists, but all candidates blocked "
            f"by unresolvable issues. blockedItems: {blocked_items}."
        ),
        "mutations": [],
        "blockedItems": blocked_items,
    }


def _make_blocked_payload(
    blocker_text: str = (
        "[TICKET-123] credentials secret is empty in vault, required by all "
        "3 candidates; systemic infrastructure issue."
    ),
) -> Dict[str, Any]:
    """Return a valid TC-005 `blocked` payload."""
    return {
        "decision": "blocked",
        "reason": (
            "Zero todo items and 3 backlog candidates exist. Systemic "
            "credentials blocker prevents dispatch."
        ),
        "mutations": [],
        "blockedItems": [],
        "blocker": blocker_text,
    }


# ============================================================================
# TC-001 through TC-005: Valid cases
# ============================================================================


class TestTC001PromoteSafeUnblockedItems:
    """
    TC-001 (PASS): todo_count=0, backlog_count>0, safe unblocked items exist
    → decision='promote' with valid promotion payload.
    """

    def test_tc001_promote_valid_payload_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=5, autonomous_mode=True)
        payload = _make_promote_payload()
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-001 valid promote payload should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )
        assert result.decision == "promote"
        assert result.violation_codes == []

    def test_tc001_promote_with_multiple_items_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=10, autonomous_mode=True)
        payload = _make_promote_payload()
        payload["mutations"].append({
            "type": "patch_work_item_status",
            "work_item_id": REAL_UUID_2,
            "from_status": "backlog",
            "to_status": "todo",
        })
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-001 multi-item promote should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )


class TestTC002PatchFixableConfigBlocker:
    """
    TC-002 (PASS): todo_count=0, backlog_count>0, fixable config blocker
    → decision='patch' with patch payload (patch + promote).
    """

    def test_tc002_patch_valid_payload_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = _make_patch_payload()
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-002 valid patch payload should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )
        assert result.decision == "patch"
        assert result.violation_codes == []


class TestTC003CreateMissingWorkItem:
    """
    TC-003 (PASS): todo_count=0, backlog_count>0, no suitable backlog
    → decision='create' with create payload (delegate + promote).
    """

    def test_tc003_create_valid_payload_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=2, autonomous_mode=True)
        payload = _make_create_payload()
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-003 valid create payload should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )
        assert result.decision == "create"
        assert result.violation_codes == []


class TestTC004RepeatWithBlockedItems:
    """
    TC-004 (PASS): todo_count=0, backlog_count>0, all items blocked by
    unresolvable issues → decision='repeat' with non-empty blockedItems
    array containing real UUIDs and specific reasons.
    """

    def test_tc004_repeat_with_blocked_items_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=2, autonomous_mode=True)
        payload = _make_repeat_with_blocked_items_payload()
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-004 repeat with blockedItems should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )
        assert result.decision == "repeat"
        assert result.violation_codes == []

    def test_tc004_repeat_with_many_blocked_items_passes(self) -> None:
        """The 33-backlog evidence scenario with structured repeat."""
        board = BoardState(todo_count=0, backlog_count=33, autonomous_mode=True)
        ids = [f"{REAL_UUID_1[:-1]}{i:x}" for i in range(33)]
        # Use a real-shaped UUID for each; we'll just vary the last char.
        ids = [f"12345678-1234-4abc-9def-12345678901{i:x}" for i in range(33)]
        # Re-shape to valid UUIDs.
        ids = [
            f"12345678-1234-4abc-9def-{i:012x}" for i in range(33)
        ]
        reasons = ["Capacity limit reached; only 2 concurrent allowed"] * 33
        payload = _make_repeat_with_blocked_items_payload(
            work_item_ids=ids,
            blocked_reasons=reasons,
        )
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-004 33-item repeat with blockedItems should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )


class TestTC005BlockedSystemicTicketBlocker:
    """
    TC-005 (PASS): todo_count=0, backlog_count>0, systemic ticket-level
    blocker → decision='blocked' with systemic blocker details.
    """

    def test_tc005_blocked_with_ticket_blocker_passes(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = _make_blocked_payload()
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-005 blocked with ticket-level blocker should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )
        assert result.decision == "blocked"
        assert result.violation_codes == []

    def test_tc005_blocked_with_systemic_phrase_passes(self) -> None:
        """A systemic (board-wide) phrase is also accepted per the spec."""
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = _make_blocked_payload(
            blocker_text=(
                "Project-wide infrastructure outage: the credentials vault "
                "is unavailable, blocking all candidates."
            ),
        )
        result = MandateContractValidator(board, payload).validate()

        assert result.is_valid, (
            "TC-005 blocked with systemic phrase should pass; "
            f"failures: {[str(f) for f in result.failures]}"
        )


# ============================================================================
# TC-006 through TC-012: Violation cases
# ============================================================================


class TestTC006BareRepeatNoBlockedItems:
    """
    TC-006 (VIOLATION): todo_count=0, backlog_count>0, unblocked backlog
    → bare decision='repeat' with NO blockedItems.
    """

    def test_tc006_bare_repeat_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-006 bare repeat must FAIL the contract"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes


class TestTC007GenericReason:
    """
    TC-007 (VIOLATION): todo_count=0, backlog_count>0 → decision='repeat'
    with generic reason 'No board action available'.
    """

    def test_tc007_repeat_with_no_blocked_items_fails(self) -> None:
        """
        Even when reason is provided, missing blockedItems is the primary
        violation. Reason substring 'no board action available' is also
        caught.
        """
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "No board action available",
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-007 must FAIL"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes
        assert "FORBIDDEN_REASON" in result.violation_codes

    def test_tc007_repeat_with_blocked_items_but_generic_reason_fails(self) -> None:
        """
        If blockedItems are present but the reason is generic, the
        forbidden reason substring is still flagged.
        """
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = _make_repeat_with_blocked_items_payload()
        # Mutate reason to include the generic phrase; keep blockedItems valid.
        payload["reason"] = (
            "No board action available. blockedItems: " + str(payload["blockedItems"])
        )
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-007 generic reason must FAIL"
        assert "FORBIDDEN_REASON" in result.violation_codes


class TestTC008WillMonitorReason:
    """
    TC-008 (VIOLATION): todo_count=0, backlog_count>0 → decision='repeat'
    with reason containing 'Will monitor'.
    """

    def test_tc008_repeat_with_will_monitor_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "Will monitor and retry later",
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-008 'Will monitor' must FAIL"
        # Two violations: bare repeat and forbidden reason.
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes
        assert "FORBIDDEN_REASON" in result.violation_codes


class TestTC009BoardIsIdleReason:
    """
    TC-009 (VIOLATION): todo_count=0, backlog_count>0 → decision='repeat'
    with reason containing 'Board is idle'.
    """

    def test_tc009_repeat_with_board_is_idle_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "Board is idle, will check again later",
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-009 'Board is idle' must FAIL"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes
        assert "FORBIDDEN_REASON" in result.violation_codes


class TestTC010HumanDecisionAsBoardWideBlocker:
    """
    TC-010 (VIOLATION): 3 human_decision items in 33-item backlog →
    bare decision='repeat' claiming 'no board action available'.
    """

    def test_tc010_human_decision_as_board_wide_blocker_fails(self) -> None:
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            autonomous_mode=True,
            human_decision_blocked_count=3,
        )
        payload = {
            "decision": "repeat",
            "reason": (
                "No board action available. 3 blocked human-decision items "
                "awaiting human feedback."
            ),
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-010 non-contagion violation must FAIL"
        # The bare-repeat rule and the non-contagion rule both fire.
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes
        assert "NON_CONTAGION_VIOLATION" in result.violation_codes
        assert "FORBIDDEN_REASON" in result.violation_codes

    def test_tc010_human_decision_with_minimal_blocked_items_still_fails(self) -> None:
        """
        Even when the CEO lists the 3 human_decision items in blockedItems,
        the reason still treats them as a board-wide blocker, which violates
        the non-contagion rule.
        """
        board = BoardState(
            todo_count=0,
            backlog_count=33,
            autonomous_mode=True,
            human_decision_blocked_count=3,
        )
        payload = {
            "decision": "repeat",
            "reason": (
                "No board action available. 3 blocked human-decision items "
                "awaiting human feedback."
            ),
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": REAL_UUID_1,
                    "workItemTitle": "Item 1",
                    "blockedReason": "Human decision pending",
                },
                {
                    "workItemId": REAL_UUID_2,
                    "workItemTitle": "Item 2",
                    "blockedReason": "Human decision pending",
                },
                {
                    "workItemId": REAL_UUID_3,
                    "workItemTitle": "Item 3",
                    "blockedReason": "Human decision pending",
                },
            ],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-010 non-contagion must FAIL even with blockedItems"
        assert "NON_CONTAGION_VIOLATION" in result.violation_codes
        assert "FORBIDDEN_REASON" in result.violation_codes


class TestTC011MissingBlockedItemsArray:
    """
    TC-011 (VIOLATION): decision='repeat' with missing/null blockedItems
    array when backlog_count>0.
    """

    def test_tc011_repeat_without_blocked_items_field_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items have issues",
            "mutations": [],
            # blockedItems is omitted entirely
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-011 missing blockedItems must FAIL"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes

    def test_tc011_repeat_with_null_blocked_items_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items have issues",
            "mutations": [],
            "blockedItems": None,
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-011 null blockedItems must FAIL"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes

    def test_tc011_repeat_with_empty_blocked_items_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items have issues",
            "mutations": [],
            "blockedItems": [],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-011 empty blockedItems must FAIL"
        assert "BARE_REPEAT_FORBIDDEN" in result.violation_codes


class TestTC012PlaceholderBlockedItems:
    """
    TC-012 (VIOLATION): decision='repeat' with placeholder blockedItems
    (no real UUIDs).
    """

    def test_tc012_repeat_with_placeholder_uuid_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items blocked by unresolvable issues",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": "<uuid>",
                    "workItemTitle": "Item 1",
                    "blockedReason": (
                        "Requires upstream API credentials that are not yet "
                        "provisioned and no workaround exists"
                    ),
                },
            ],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-012 placeholder UUID must FAIL"
        assert "BLOCKED_ITEM_PLACEHOLDER_UUID" in result.violation_codes

    def test_tc012_repeat_with_short_placeholder_id_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items blocked",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": "TBD",
                    "workItemTitle": "Item 1",
                    "blockedReason": (
                        "Requires upstream API credentials that are not yet "
                        "provisioned and no workaround exists"
                    ),
                },
            ],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-012 'TBD' placeholder must FAIL"
        assert "BLOCKED_ITEM_PLACEHOLDER_UUID" in result.violation_codes

    def test_tc012_repeat_with_all_zero_uuid_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items blocked",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": "00000000-0000-0000-0000-000000000000",
                    "workItemTitle": "Item 1",
                    "blockedReason": (
                        "Requires upstream API credentials that are not yet "
                        "provisioned and no workaround exists"
                    ),
                },
            ],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-012 zero UUID must FAIL"
        assert "BLOCKED_ITEM_PLACEHOLDER_UUID" in result.violation_codes

    def test_tc012_repeat_with_template_placeholder_fails(self) -> None:
        board = BoardState(todo_count=0, backlog_count=3, autonomous_mode=True)
        payload = {
            "decision": "repeat",
            "reason": "All items blocked",
            "mutations": [],
            "blockedItems": [
                {
                    "workItemId": "${itemId}",
                    "workItemTitle": "Item 1",
                    "blockedReason": (
                        "Requires upstream API credentials that are not yet "
                        "provisioned and no workaround exists"
                    ),
                },
            ],
        }
        result = MandateContractValidator(board, payload).validate()

        assert not result.is_valid, "TC-012 template placeholder must FAIL"
        assert "BLOCKED_ITEM_PLACEHOLDER_UUID" in result.violation_codes


# ============================================================================
# Auxiliary tests: spec / workflow YAML cross-checks
# ============================================================================


WORKFLOW_YAML_PATH = Path(__file__).resolve().parents[2] / (
    "seed/workflows/project-orchestration-cycle-ceo.workflow.yaml"
)
SPEC_MD_PATH = Path(__file__).resolve().parents[2] / (
    "seed/workflows/prompts/project-orchestration-cycle-ceo/"
    "test_ceo_zero_todo_mandate.spec.md"
)


def _load_workflow_yaml() -> Optional[Dict[str, Any]]:
    """Load the workflow YAML, returning None on missing/malformed files."""
    if not WORKFLOW_YAML_PATH.exists():
        return None
    try:
        with WORKFLOW_YAML_PATH.open("r", encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except (yaml.YAMLError, OSError, UnicodeDecodeError):
        return None


def _load_spec_md() -> Optional[str]:
    """Load the spec markdown, returning None on missing/unreadable files."""
    if not SPEC_MD_PATH.exists():
        return None
    try:
        return SPEC_MD_PATH.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


class TestWorkflowContractTestDeclarations:
    """
    Cross-check that the workflow YAML declares all 12 TC entries in
    `contract_tests.test_cases`, and that the spec markdown includes all
    12 test case identifiers.
    """

    def test_workflow_yaml_declares_all_12_test_cases(self) -> None:
        data = _load_workflow_yaml()
        if data is None:
            pytest.skip(
                f"workflow YAML missing or malformed at {WORKFLOW_YAML_PATH}; "
                "skipping cross-check"
            )

        contract_tests = data.get("contract_tests") or []
        # contract_tests may be a list of dicts each with 'test_file' and
        # 'test_cases'. We only need the entries that point at our spec.
        our_entries: List[Dict[str, Any]] = []
        for entry in contract_tests:
            if not isinstance(entry, dict):
                continue
            test_file = entry.get("test_file", "") or ""
            if "test_ceo_zero_todo_mandate.spec" in test_file:
                our_entries.append(entry)

        assert our_entries, (
            f"workflow YAML has no contract_tests entry pointing at "
            f"test_ceo_zero_todo_mandate.spec; got test_files: "
            f"{[e.get('test_file') for e in contract_tests]}"
        )

        merged_cases: Dict[str, str] = {}
        for entry in our_entries:
            cases = entry.get("test_cases") or {}
            if isinstance(cases, dict):
                merged_cases.update({str(k): str(v) for k, v in cases.items()})

        for tc_id in ALL_TC_IDS:
            assert tc_id in merged_cases, (
                f"workflow YAML is missing contract_tests.test_cases entry "
                f"for {tc_id}; declared: {sorted(merged_cases.keys())}"
            )

    def test_spec_markdown_contains_all_12_tc_ids(self) -> None:
        spec_text = _load_spec_md()
        if spec_text is None:
            pytest.skip(
                f"spec markdown missing or unreadable at {SPEC_MD_PATH}; "
                "skipping cross-check"
            )

        for tc_id in ALL_TC_IDS:
            assert tc_id in spec_text, (
                f"spec markdown is missing test case identifier {tc_id}"
            )

    def test_test_module_exposes_all_12_tc_methods(self) -> None:
        """
        Sanity check on this module: every TC-XXX should have at least
        one test method in this file. Catches accidental renames or
        deletions of test cases.

        Test methods live inside test classes (e.g. ``TestTC001...``),
        so we walk the module's classes as well as its top-level
        functions when collecting candidate method names.
        """
        import inspect

        module = sys.modules[__name__]

        def _candidate_names() -> List[str]:
            names: List[str] = []
            # Module-level test functions.
            names.extend(
                name for name in dir(module) if name.startswith("test_tc")
            )
            # Methods inside test classes defined at module level.
            for _, obj in inspect.getmembers(module, inspect.isclass):
                if obj.__module__ != module.__name__:
                    continue
                names.extend(
                    method_name for method_name, _ in inspect.getmembers(
                        obj, predicate=inspect.isfunction,
                    )
                    if method_name.startswith("test_tc")
                )
            return names

        all_names = _candidate_names()
        for tc_id in ALL_TC_IDS:
            # Map e.g. TC-001 -> tc001
            tc_lower = tc_id.lower().replace("-", "")
            method_names = [
                name for name in all_names
                if tc_lower in name.replace("_", "")
            ]
            assert method_names, (
                f"this test file has no method starting with "
                f"'test_tc{tc_lower[2:]}...' for {tc_id}; "
                f"candidates found: {[n for n in all_names[:6]]}..."
            )


# ============================================================================
# Allow `python tests/contract/test_ceo_zero_todo_mandate_runtime_contract.py`
# to run as a quick smoke check.
# ============================================================================


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))
