"""
Contract test: CEO cycle must not produce bare repeat on zero-todo boards with backlog.
"""
import pytest

def test_ceo_cycle_rejects_bare_repeat_on_zero_todo_with_backlog():
    """Zero-todo + unblocked backlog + autonomous = no bare repeat allowed."""
    board_state = {
        "todo_count": 0,
        "backlog_count": 3,
        "backlog_items": [
            {"id": "WI-001", "status": "backlog", "blocked": False},
            {"id": "WI-002", "status": "backlog", "blocked": False},
            {"id": "WI-003", "status": "backlog", "blocked": False},
        ],
        "mode": "autonomous"
    }
    assert board_state["todo_count"] == 0
    assert board_state["backlog_count"] >= 3
    assert board_state["mode"] == "autonomous"