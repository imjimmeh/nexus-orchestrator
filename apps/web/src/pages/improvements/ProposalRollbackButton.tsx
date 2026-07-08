import { useState } from "react";
import { ImprovementProposal } from "@/lib/api/client.improvement-proposals.types";
import { useImprovementProposals } from "@/hooks/useImprovementProposals";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const ROLLBACKABLE_PROPOSAL_KINDS = new Set([
  "agent_profile_change",
  "workflow_definition_change",
]);

export interface ProposalRollbackButtonProps {
  proposal: ImprovementProposal;
}

/**
 * Rollback control for an already-`applied` definition-change proposal.
 * Renders nothing for pending/rejected proposals, or for any kind other than
 * `agent_profile_change` / `workflow_definition_change` — the two kinds
 * Epic D's appliers currently support a rollback path for.
 */
export function ProposalRollbackButton({
  proposal,
}: ProposalRollbackButtonProps) {
  const { rollback } = useImprovementProposals();
  const [isOpen, setIsOpen] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);

  if (
    proposal.status !== "applied" ||
    !ROLLBACKABLE_PROPOSAL_KINDS.has(proposal.kind)
  ) {
    return null;
  }

  const handleConfirm = async () => {
    setIsRollingBack(true);
    try {
      await rollback(proposal.id);
      setIsOpen(false);
    } finally {
      setIsRollingBack(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Rollback
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rollback this change?</AlertDialogTitle>
          <AlertDialogDescription>
            This restores the pre-apply snapshot and marks the proposal rolled
            back. This cannot be undone automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRollingBack}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isRollingBack}
            onClick={(event) => {
              event.preventDefault();
              void handleConfirm();
            }}
          >
            {isRollingBack ? "Rolling back..." : "Confirm rollback"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
