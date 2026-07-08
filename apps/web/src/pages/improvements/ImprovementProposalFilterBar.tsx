import {
  IMPROVEMENT_PROPOSAL_KINDS,
  IMPROVEMENT_PROPOSAL_STATUSES,
} from "@nexus/core";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const ALL_FILTER_VALUE = "all";

export interface ImprovementProposalFilterBarProps {
  kindValue: string;
  statusValue: string;
  onKindChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  selectedCount: number;
  onBulkApprove: () => void;
  onBulkReject: () => void;
}

export function ImprovementProposalFilterBar({
  kindValue,
  statusValue,
  onKindChange,
  onStatusChange,
  selectedCount,
  onBulkApprove,
  onBulkReject,
}: ImprovementProposalFilterBarProps) {
  return (
    <div className="flex items-center gap-3">
      <Select value={kindValue} onValueChange={onKindChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="All kinds" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>All kinds</SelectItem>
          {IMPROVEMENT_PROPOSAL_KINDS.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kind}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={statusValue} onValueChange={onStatusChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_FILTER_VALUE}>All statuses</SelectItem>
          {IMPROVEMENT_PROPOSAL_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="ml-auto flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={onBulkApprove}
        >
          Bulk Approve
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={onBulkReject}
        >
          Bulk Reject
        </Button>
      </div>
    </div>
  );
}
