import { EventLedgerFeed } from "@/components/events/EventLedgerFeed";

// Not wired to the active app scope (Phase 5 Task 8): EventLedgerController's
// findAll query only accepts a nested `context.scopeId` (the neutral
// workflow/job scope concept) and hard-codes the multi-tenant
// `scopeNodeId: null` when building the query - the event ledger is not
// partitioned by the scope_node_closure hierarchy this page would need to
// forward.
export function Events() {
  return (
    <div className="space-y-4">
      <EventLedgerFeed
        title="Events"
        description="Correlated event ledger history across all scopes, newest first."
      />
    </div>
  );
}
