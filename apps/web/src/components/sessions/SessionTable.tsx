import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "react-router-dom";

interface SessionItem {
  id: string;
  displayName: string;
  status: string;
  projectName?: string | null;
  workflowName?: string | null;
  createdAt: string;
  linkTo: string;
}

interface SessionTableProps {
  items: SessionItem[];
  isLoading: boolean;
  emptyMessage: string;
}

export function SessionTable({
  items,
  isLoading,
  emptyMessage,
}: SessionTableProps) {
  if (isLoading) {
    return (
      <div className="p-4 text-center text-muted-foreground">Loading...</div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Created</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <Link to={item.linkTo} className="font-medium hover:underline">
                {item.displayName}
              </Link>
            </TableCell>
            <TableCell>{item.status}</TableCell>
            <TableCell>
              {item.projectName || item.workflowName || "-"}
            </TableCell>
            <TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
