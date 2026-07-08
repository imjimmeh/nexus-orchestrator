import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GitBranch } from "lucide-react";

interface BranchSelectorProps {
  readonly branches: string[];
  readonly selectedBranch: string | null;
  readonly onSelectBranch: (branch: string) => void;
  readonly isLoading: boolean;
}

export function BranchSelector({
  branches,
  selectedBranch,
  onSelectBranch,
  isLoading,
}: BranchSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <GitBranch className="h-4 w-4 text-muted-foreground" />
      <Select
        value={selectedBranch || ""}
        onValueChange={onSelectBranch}
        disabled={isLoading}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue
            placeholder={isLoading ? "Loading..." : "Select branch"}
          />
        </SelectTrigger>
        <SelectContent>
          {branches.map((branch) => (
            <SelectItem key={branch} value={branch}>
              {branch}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
