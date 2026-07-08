import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToolCandidate } from "@/lib/api/tools.types";

interface ToolVersionHistoryProps {
  candidates: ToolCandidate[];
  selectedToolName?: string;
  isLoading?: boolean;
}

function getStatusVariant(status: ToolCandidate["status"]) {
  if (status === "validated" || status === "published") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function ToolVersionHistory({
  candidates,
  selectedToolName,
  isLoading = false,
}: Readonly<ToolVersionHistoryProps>) {
  const versions = candidates
    .filter((candidate) =>
      selectedToolName ? candidate.tool_name === selectedToolName : false,
    )
    .sort((a, b) => b.version - a.version);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center">
                Loading version history...
              </TableCell>
            </TableRow>
          ) : versions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className="text-center">
                No versions found
              </TableCell>
            </TableRow>
          ) : (
            versions.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell>v{candidate.version}</TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(candidate.status)}>
                    {candidate.status}
                  </Badge>
                </TableCell>
                <TableCell>{candidate.is_active ? "Yes" : "No"}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
