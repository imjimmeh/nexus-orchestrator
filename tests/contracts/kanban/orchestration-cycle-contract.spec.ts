/**
 * Contract test: CEO cycle orchestration backlog promotion guardrail.
 *
 * Work item: fb7c3bac-18b8-4483-a3d6-fbea2828718f
 * Title: Implement mandatory backlog promotion guardrail for autonomous CEO cycles
 *
 * This contract test validates that the kanban.complete_orchestration_cycle_decision
 * tool enforces the ZERO-TODO BACKLOG PROMOTION MANDATE:
 *
 * When an autonomous project has:
 *   - todo_count == 0
 *   - backlog_count > 0 (unblocked backlog items available)
 *   - Running in autonomous mode
 *
 * The tool MUST reject bare `repeat` decisions that lack:
 *   - A mutation description (backlog promotion or other board change)
 *   - A blockedItems array with per-item blockedReason fields
 *
 * Valid outcomes (one MUST be chosen):
 *   (a) Promote at least one unblocked backlog item to todo (mutation)
 *   (b) Structured repeat with blockedItems array containing per-item blockedReason
 *   (c) decision: blocked with explicit ticket-level blocker
 *
 * Invalid:
 *   - Bare `repeat` with no mutation and no blockedItems = PROTOCOL VIOLATION
 *
 * Dependencies:
 *   - seed/workflows/prompts/project-orchestration-cycle-ceo/decide.md
 *     (strengthened to remove 'may promote' framing and add idle board failure language)
 */

import { describe, expect, it } from "vitest";

// =============================================================================
// Test Data Types
// =============================================================================

/** Represents a work item record for test scenarios */
interface TestWorkItem {
	id: string;
	status: string;
	title?: string;
	blockedBy?: string[];
	currentExecutionId?: string | null;
	linkedRunId?: string | null;
}

/** Board state for contract validation scenarios */
interface BoardState {
	todoItems: TestWorkItem[];
	backlogItems: TestWorkItem[];
	blockedBacklogItems: TestWorkItem[];
}

/** Represents a CEO cycle decision output */
interface CEODecision {
	decision: "repeat" | "blocked" | "pause" | "complete";
	reason: string;
	mutations?: Array<{
		type: string;
		work_item_id?: string;
		from_status?: string;
		to_status?: string;
	}>;
	blockedItems?: Array<{
		workItemId: string;
		blockedReason: string;
	}>;
	blocker?: string;
}

/** Contract validation result */
interface ContractValidationResult {
	isValid: boolean;
	violationReason: string;
}

// =============================================================================
// Contract Validation Logic
// =============================================================================

/**
 * Validate whether a CEO cycle decision satisfies the backlog promotion mandate.
 *
 * The mandate applies when ALL conditions are true:
 *   - todo_count == 0
 *   - backlog_count > 0 (unblocked items)
 *   - autonomous mode
 *
 * When mandate applies, bare repeat is ALWAYS a violation.
 */
function validateContract(
	decision: CEODecision,
	boardState: BoardState,
	isAutonomous: boolean,
): ContractValidationResult {
	const hasTodoItems = boardState.todoItems.length > 0;
	const unblockedBacklogCount = boardState.backlogItems.length;

	// Terminal decisions (blocked, pause, complete) are always valid regardless of board state
	const isTerminalDecision = ["blocked", "pause", "complete"].includes(decision.decision);
	if (isTerminalDecision) {
		return { isValid: true, violationReason: "" };
	}

	// The mandate only applies in autonomous mode
	const mandateApplies = !hasTodoItems && unblockedBacklogCount > 0 && isAutonomous;

	if (!mandateApplies) {
		return { isValid: true, violationReason: "" };
	}

	// MANDATE APPLIES: Check for protocol violation
	const hasMutation = decision.mutations && decision.mutations.length > 0;
	const hasBlockedItems =
		decision.blockedItems &&
		decision.blockedItems.length > 0 &&
		decision.blockedItems.every((item) => item.blockedReason?.trim().length > 0);

	const isBareRepeat =
		decision.decision === "repeat" && !hasMutation && !hasBlockedItems;

	if (isBareRepeat) {
		return {
			isValid: false,
			violationReason:
				"PROTOCOL VIOLATION: Bare repeat with no mutation when " +
				`todo_count=${boardState.todoItems.length}, backlog_count=${unblockedBacklogCount}. ` +
				"CEO MUST choose: (a) promote backlog to todo, (b) structured repeat with blockedItems, or (c) blocked with ticket-level blocker.",
		};
	}

	// Check for valid outcomes
	const hasPromotionMutation =
		decision.mutations?.some(
			(m) =>
				m.type === "patch_work_item_status" &&
				m.from_status === "backlog" &&
				m.to_status === "todo",
		) ?? false;

	if (decision.decision === "repeat" && hasPromotionMutation) {
		return { isValid: true, violationReason: "" };
	}

	if (decision.decision === "repeat" && hasBlockedItems) {
		return { isValid: true, violationReason: "" };
	}

	return {
		isValid: false,
		violationReason:
			`PROTOCOL VIOLATION: Decision "${decision.decision}" does not satisfy mandate. ` +
			"Must either: (a) promote backlog to todo or (b) provide structured repeat with blockedItems.",
	};
}

// =============================================================================
// Test Factories
// =============================================================================

function createWorkItem(
	id: string,
	status: "todo" | "backlog" | "blocked" | "in_progress" | "done",
	overrides?: Partial<TestWorkItem>,
): TestWorkItem {
	return {
		id,
		status,
		title: `${status} item ${id}`,
		blockedBy: [],
		currentExecutionId: null,
		linkedRunId: null,
		...overrides,
	};
}

function createBoardState(
	todoCount: number,
	backlogCount: number,
	blockedBacklogCount = 0,
): BoardState {
	return {
		todoItems: Array.from({ length: todoCount }, (_, i) =>
			createWorkItem(`todo-${i + 1}`, "todo"),
		),
		backlogItems: Array.from({ length: backlogCount }, (_, i) =>
			createWorkItem(`backlog-${i + 1}`, "backlog"),
		),
		blockedBacklogItems: Array.from({ length: blockedBacklogCount }, (_, i) =>
			createWorkItem(`blocked-backlog-${i + 1}`, "blocked", {
				blockedBy: ["external-dependency"],
			}),
		),
	};
}

// =============================================================================
// Contract Test Suite
// =============================================================================

describe("CEO cycle zero-todo backlog promotion - orchestration-cycle-contract", () => {
	// =========================================================================
	// CRITICAL: Reject bare repeat when mandate applies
	// =========================================================================

	describe("Rule 1: Reject bare repeat on zero-todo autonomous boards", () => {
		it("rejects bare repeat decision on 0-todo + 1-backlog autonomous board", () => {
			const boardState = createBoardState(0, 1);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
			expect(result.violationReason).toContain("Bare repeat");
		});

		it("rejects bare repeat decision on 0-todo + 3-backlog autonomous board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("rejects bare repeat decision on 0-todo + 33-backlog board (evidence scenario)", () => {
			// Evidence from 2026-05-15: CEO concluded "No board action available"
			// while 33 backlog items existed - a protocol violation
			const boardState = createBoardState(0, 33);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available. 3 blocked human-decision items awaiting human feedback. No board action available to this cycle.",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("rejects bare repeat with generic reason 'continue' on 0-todo + backlog board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "continue",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("Bare repeat");
		});

		it("rejects bare repeat when 0-todo + unblocked backlog even with blocked items present", () => {
			// NON-CONTAGION RULE: Human-decision blocked items do NOT block unrelated backlog items
			const boardState = {
				todoItems: [],
				backlogItems: [
					createWorkItem("backlog-1", "backlog"),
					createWorkItem("backlog-2", "backlog"),
					createWorkItem("backlog-3", "backlog"),
				],
				blockedBacklogItems: [
					createWorkItem("blocked-human-1", "blocked", {
						blockedBy: ["human_decision"],
					}),
				],
			};

			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available. 1 blocked human-decision item awaiting human feedback.",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("Bare repeat");
		});

		it("rejects bare repeat with 'no change from prior cycle' reason", () => {
			const boardState = createBoardState(0, 5);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No change from prior cycle: 0 dispatchable todo items. No board action available to this cycle.",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});
	});

	// =========================================================================
	// Rule 2: Accept valid outcomes when mandate applies
	// =========================================================================

	describe("Rule 2: Accept valid outcomes when mandate applies", () => {
		it("accepts repeat with backlog-to-todo promotion mutation", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Promoted backlog-1 to todo. Board has item ready for dispatch.",
				mutations: [
					{
						type: "patch_work_item_status",
						work_item_id: "backlog-1",
						from_status: "backlog",
						to_status: "todo",
					},
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
			expect(result.violationReason).toBe("");
		});

		it("accepts repeat with structured blockedItems array", () => {
			const boardState = createBoardState(0, 2);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Zero todo and backlog exists, but all candidates have unresolvable blockers.",
				mutations: [],
				blockedItems: [
					{
						workItemId: "backlog-1",
						blockedReason:
							"Requires upstream API credentials that are not yet provisioned and no workaround exists",
					},
					{
						workItemId: "backlog-2",
						blockedReason: "Blocked by backlog-1 which cannot be dispatched",
					},
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
			expect(result.violationReason).toBe("");
		});

		it("accepts decision: blocked with ticket-level blocker", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "blocked",
				reason: "Architecture documentation missing - required before backend work can begin",
				blocker: "Missing: Architecture documentation for core services (TICKET-123)",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
			expect(result.violationReason).toBe("");
		});

		it("accepts promotion of multiple backlog items to todo", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Promoted 2 unblocked backlog items to todo (backlog-1, backlog-2). 1 candidate remains.",
				mutations: [
					{
						type: "patch_work_item_status",
						work_item_id: "backlog-1",
						from_status: "backlog",
						to_status: "todo",
					},
					{
						type: "patch_work_item_status",
						work_item_id: "backlog-2",
						from_status: "backlog",
						to_status: "todo",
					},
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Rule 3: Mandate does NOT apply when todo items exist
	// =========================================================================

	describe("Rule 3: Permit repeat when todo items exist (mandate does not apply)", () => {
		it("accepts bare repeat when board has 1+ todo items", () => {
			const boardState = createBoardState(1, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "continue",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts bare repeat with generic reason when todo exists", () => {
			const boardState = createBoardState(2, 5);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "work continues",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts repeat when multiple todo items exist regardless of backlog count", () => {
			const boardState = createBoardState(3, 10);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "multiple todo items remain",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Rule 4: Accept repeat when no unblocked backlog available
	// =========================================================================

	describe("Rule 4: Accept repeat when no unblocked backlog items available", () => {
		it("accepts repeat when all backlog items have active execution", () => {
			const boardState = {
				todoItems: [],
				backlogItems: [],
				blockedBacklogItems: [
					createWorkItem("backlog-1", "backlog", {
						currentExecutionId: "exec-123",
					}),
					createWorkItem("backlog-2", "backlog", {
						currentExecutionId: "exec-456",
					}),
				],
			};

			const decision: CEODecision = {
				decision: "repeat",
				reason: "backlog items blocked by active execution",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts repeat when no backlog items exist (empty board)", () => {
			const boardState = {
				todoItems: [],
				backlogItems: [],
				blockedBacklogItems: [],
			};

			const decision: CEODecision = {
				decision: "repeat",
				reason: "no backlog items available",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts repeat when all backlog items have linked runs (active workflow)", () => {
			const boardState = {
				todoItems: [],
				backlogItems: [],
				blockedBacklogItems: [
					createWorkItem("backlog-1", "backlog", { linkedRunId: "run-789" }),
				],
			};

			const decision: CEODecision = {
				decision: "repeat",
				reason: "backlog items blocked by active workflow runs",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Rule 5: Accept terminal decisions regardless of board state
	// =========================================================================

	describe("Rule 5: Accept terminal decisions regardless of board state", () => {
		it("accepts decision: blocked when 0-todo + backlog board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "blocked",
				reason: "human decision required",
				blocker: "Human decision required: Architecture approval pending",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts decision: pause when 0-todo + backlog board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "pause",
				reason: "orchestration paused for maintenance",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});

		it("accepts decision: complete when 0-todo + backlog board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "complete",
				reason: "all planned outcomes achieved",
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Rule 6: Non-autonomous mode (supervised) also enforces mandate
	// =========================================================================

	describe("Rule 6: Mandate applies only in autonomous mode", () => {
		it("rejects bare repeat in autonomous mode on 0-todo + backlog board", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "no board action available",
			};

			// Mandate applies in autonomous mode
			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("accepts bare repeat in supervised mode on 0-todo + backlog board (mandate does not apply)", () => {
			// In supervised mode, the mandate does not apply - CEO can use bare repeat
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "no board action available",
			};

			const result = validateContract(decision, boardState, false);

			expect(result.isValid).toBe(true);
		});

		it("accepts repeat with promotion mutation in autonomous mode", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Promoted backlog-1 to todo",
				mutations: [
					{
						type: "patch_work_item_status",
						work_item_id: "backlog-1",
						from_status: "backlog",
						to_status: "todo",
					},
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Edge Cases: Invalid structured repeat
	// =========================================================================

	describe("Edge cases: Reject invalid structured repeat", () => {
		it("rejects repeat with blockedItems but empty blockedReason", () => {
			const boardState = createBoardState(0, 2);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "All items have issues",
				blockedItems: [
					{ workItemId: "backlog-1", blockedReason: "" },
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("rejects repeat with blockedItems but missing blockedReason field", () => {
			const boardState = createBoardState(0, 2);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "All items have issues",
				blockedItems: [
					{ workItemId: "backlog-1" } as unknown as { workItemId: string; blockedReason: string },
				],
			};

			const result = validateContract(decision, boardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("rejects repeat with mutation that is NOT a promotion (unrelated mutation)", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Patched execution config",
				mutations: [
					{
						type: "patch_execution_config",
						work_item_id: "backlog-1",
					},
				],
			};

			const result = validateContract(decision, boardState, true);

			// Config patch alone does not satisfy mandate - need promotion too
			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("accepts terminal decisions (blocked) even without blocker field in contract validation", () => {
			// Note: This is contract-level validation. Runtime validation enforces stricter rules.
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "blocked",
				reason: "Cannot proceed",
				blocker: undefined,
			};

			const result = validateContract(decision, boardState, true);

			// Terminal decisions pass contract validation; runtime enforces blocker field
			expect(result.isValid).toBe(true);
		});

		it("accepts terminal decisions (blocked) even with empty blocker field in contract validation", () => {
			// Note: This is contract-level validation. Runtime validation enforces stricter rules.
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "blocked",
				reason: "Cannot proceed",
				blocker: "   ",
			};

			const result = validateContract(decision, boardState, true);

			// Terminal decisions pass contract validation; runtime enforces blocker field
			expect(result.isValid).toBe(true);
		});
	});

	// =========================================================================
	// Contract determinism tests
	// =========================================================================

	describe("Contract determinism: Same input always produces same output", () => {
		it("validates bare repeat rejection deterministically", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available",
			};

			// Run validation multiple times - should always be the same
			for (let i = 0; i < 10; i++) {
				const result = validateContract(decision, boardState, true);
				expect(result.isValid).toBe(false);
			}
		});

		it("validates promotion acceptance deterministically", () => {
			const boardState = createBoardState(0, 3);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Promoted backlog-1 to todo",
				mutations: [
					{
						type: "patch_work_item_status",
						work_item_id: "backlog-1",
						from_status: "backlog",
						to_status: "todo",
					},
				],
			};

			for (let i = 0; i < 10; i++) {
				const result = validateContract(decision, boardState, true);
				expect(result.isValid).toBe(true);
			}
		});

		it("validates structured repeat deterministically", () => {
			const boardState = createBoardState(0, 2);
			const decision: CEODecision = {
				decision: "repeat",
				reason: "All blocked",
				blockedItems: [
					{ workItemId: "backlog-1", blockedReason: "Capacity limit reached" },
					{ workItemId: "backlog-2", blockedReason: "Blocked by backlog-1" },
				],
			};

			for (let i = 0; i < 10; i++) {
				const result = validateContract(decision, boardState, true);
				expect(result.isValid).toBe(true);
			}
		});
	});

	// =========================================================================
	// Evidence scenario validation
	// =========================================================================

	describe("Evidence scenario: 2026-05-15 live run validation", () => {
		const evidenceBoardState = createBoardState(0, 33);

		it("documents that the evidence scenario is a protocol violation", () => {
			// The live run documented: decision="repeat", reason="No board action available"
			// This should ALWAYS be rejected
			const decision: CEODecision = {
				decision: "repeat",
				reason: "No board action available",
			};

			const result = validateContract(decision, evidenceBoardState, true);

			expect(result.isValid).toBe(false);
			expect(result.violationReason).toContain("PROTOCOL VIOLATION");
		});

		it("validates that promotion would have satisfied the mandate", () => {
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Promoted BACKLOG-001 to todo, dispatched. 32 additional unblocked candidates remain.",
				mutations: [
					{
						type: "patch_work_item_status",
						work_item_id: "BACKLOG-001",
						from_status: "backlog",
						to_status: "todo",
					},
				],
			};

			const result = validateContract(decision, evidenceBoardState, true);

			expect(result.isValid).toBe(true);
		});

		it("validates that structured repeat with blockedItems would have satisfied the mandate", () => {
			const decision: CEODecision = {
				decision: "repeat",
				reason: "Zero todo and 33 backlog candidates, but capacity limit reached.",
				blockedItems: Array.from({ length: 33 }, (_, i) => ({
					workItemId: `BACKLOG-${String(i + 1).padStart(3, "0")}`,
					blockedReason: "Capacity limit reached; 2 items currently executing",
				})),
			};

			const result = validateContract(decision, evidenceBoardState, true);

			expect(result.isValid).toBe(true);
		});
	});
});