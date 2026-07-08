/**
 * Public types for `MemoryRetrievalService` (EPIC-212 Phase 1, Task 9).
 */

export interface MemoryRetrievalInput {
  /** Project scope ID; used to fetch project-scoped + global segments. */
  readonly scopeId: string;
  /** The current task / step context text to embed as the query vector. */
  readonly queryText: string;
  /** Maximum number of tokens the returned segment list may consume. */
  readonly tokenBudget: number;
  /** Optional current agent profile name — adds the `agent(<name>)` pool. */
  readonly agentProfileName?: string;
  /** Optional current workflow definition name — adds the `workflow(<name>)` pool. */
  readonly workflowName?: string;
}
