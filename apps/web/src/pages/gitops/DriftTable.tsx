import { Link } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DriftSummary } from "@/lib/api/client.gitops.types";
import { ManagedByBadge } from "./ManagedByBadge";

interface DriftTableProps {
  drift: DriftSummary[];
}

export function DriftTable({ drift }: DriftTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Kind</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Scope</TableHead>
          <TableHead>Managed By</TableHead>
          <TableHead>Changed Fields</TableHead>
          <TableHead>Audit</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drift.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-sm text-muted-foreground">
              No inbound drift or conflicts detected.
            </TableCell>
          </TableRow>
        )}
        {drift.map((item) => (
          <TableRow key={`${item.kind}-${item.name}-${item.scopeNodeId}`}>
            <TableCell className="font-mono text-xs">{item.kind}</TableCell>
            <TableCell>{item.name}</TableCell>
            <TableCell className="font-mono text-xs">
              {item.scopeNodeId}
            </TableCell>
            <TableCell>
              <ManagedByBadge managedBy={item.managedBy} />
            </TableCell>
            <TableCell className="text-xs">
              {item.driftedFields.join(", ")}
            </TableCell>
            <TableCell>
              <Link
                to={`/audit?eventId=${item.auditEventId}`}
                className="text-sm underline"
              >
                View audit
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
