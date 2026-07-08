import { useState } from "react";
import type { CreateSkillAssignmentProposalRequest } from "@nexus/core";
import type {
  ImprovementProposalKind,
  ImprovementProposalStatus,
} from "@nexus/core";
import {
  useCreateSkillAssignmentProposal,
  useImprovementProposals,
} from "@/hooks/useImprovementProposals";
import { useToast } from "@/hooks/useToast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getAssignSkillOutcomeToast } from "./assign-skill-outcome-toast.helpers";
import { AssignSkillDialog } from "./AssignSkillDialog";
import {
  ALL_FILTER_VALUE,
  ImprovementProposalFilterBar,
} from "./ImprovementProposalFilterBar";
import { ImprovementProposalRow } from "./ImprovementProposalRow";

export function ImprovementsQueue() {
  const {
    proposals,
    isLoading,
    approve,
    reject,
    bulkApprove,
    bulkReject,
    filters,
    setFilters,
  } = useImprovementProposals();
  const createSkillAssignmentProposal = useCreateSkillAssignmentProposal();
  const toast = useToast();

  const kindFilterValue = filters.kind?.[0] ?? ALL_FILTER_VALUE;
  const statusFilterValue = filters.status?.[0] ?? ALL_FILTER_VALUE;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAssignSkillDialogOpen, setIsAssignSkillDialogOpen] = useState(false);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? [...current, id]
        : current.filter((existing) => existing !== id),
    );
  };

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const handleKindFilterChange = (value: string) => {
    setFilters((current) => ({
      ...current,
      kind:
        value === ALL_FILTER_VALUE
          ? undefined
          : [value as ImprovementProposalKind],
    }));
  };

  const handleStatusFilterChange = (value: string) => {
    setFilters((current) => ({
      ...current,
      status:
        value === ALL_FILTER_VALUE
          ? undefined
          : [value as ImprovementProposalStatus],
    }));
  };

  const handleBulkApprove = async () => {
    await bulkApprove(selectedIds);
    setSelectedIds([]);
  };

  const handleBulkReject = async () => {
    await bulkReject(selectedIds);
    setSelectedIds([]);
  };

  const handleAssignSkillSubmit = (
    body: CreateSkillAssignmentProposalRequest,
  ) => {
    createSkillAssignmentProposal.mutate(body, {
      onSuccess: (result) => {
        const outcomeToast = getAssignSkillOutcomeToast(result.outcome);
        toast[outcomeToast.kind](outcomeToast.title, outcomeToast.description);
        setIsAssignSkillDialogOpen(false);
      },
      onError: () => {
        toast.error(
          "Assign skill failed",
          "Could not create the skill-assignment proposal.",
        );
      },
    });
  };

  let rows;
  if (isLoading) {
    rows = (
      <TableRow>
        <TableCell colSpan={6} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  } else if (proposals.length === 0) {
    rows = (
      <TableRow>
        <TableCell colSpan={6} className="text-center">
          No improvement proposals found
        </TableCell>
      </TableRow>
    );
  } else {
    rows = proposals.map((proposal) => (
      <ImprovementProposalRow
        key={proposal.id}
        proposal={proposal}
        isSelected={selectedIds.includes(proposal.id)}
        isExpanded={expandedId === proposal.id}
        onToggleSelected={toggleSelected}
        onToggleExpanded={toggleExpanded}
        onApprove={approve}
        onReject={reject}
      />
    ));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Improvements</h2>
          <p className="text-muted-foreground">
            Review and act on self-improvement proposals.
          </p>
        </div>
        <Button
          onClick={() => {
            setIsAssignSkillDialogOpen(true);
          }}
        >
          Assign skill
        </Button>
      </div>

      <AssignSkillDialog
        open={isAssignSkillDialogOpen}
        onOpenChange={setIsAssignSkillDialogOpen}
        onSubmit={handleAssignSkillSubmit}
      />

      <ImprovementProposalFilterBar
        kindValue={kindFilterValue}
        statusValue={statusFilterValue}
        onKindChange={handleKindFilterChange}
        onStatusChange={handleStatusFilterChange}
        selectedCount={selectedIds.length}
        onBulkApprove={handleBulkApprove}
        onBulkReject={handleBulkReject}
      />

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </div>
    </div>
  );
}
