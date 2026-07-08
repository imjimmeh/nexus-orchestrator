// apps/web/src/components/scope/PendingInvitationsList.tsx
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useInvitations, useRevokeInvitation } from "@/hooks/useInvitations";
import { formatDateSafe } from "@/lib/utils";
import type { Invitation } from "@/lib/api/client.invitations.types";

const LINK_ONLY_LABEL = "(link-only)";
const EXPIRY_DATE_PATTERN = "MMM d, yyyy";

interface PendingInvitationsListProps {
  scopeNodeId: string;
}

interface InvitationRowProps {
  invitation: Invitation;
  onRevoke: (id: string) => void;
}

function InvitationRow({ invitation, onRevoke }: Readonly<InvitationRowProps>) {
  return (
    <TableRow>
      <TableCell>{invitation.email ?? LINK_ONLY_LABEL}</TableCell>
      <TableCell>
        <Badge variant="secondary">
          {invitation.roleName ?? invitation.roleId}
        </Badge>
      </TableCell>
      <TableCell>{invitation.status}</TableCell>
      <TableCell>
        {formatDateSafe(invitation.expiresAt, EXPIRY_DATE_PATTERN, "-")}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive"
          aria-label="Revoke"
          onClick={() => {
            onRevoke(invitation.id);
          }}
        >
          <XCircle className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function PendingInvitationsList({
  scopeNodeId,
}: Readonly<PendingInvitationsListProps>) {
  const { data: invitations = [], isLoading } = useInvitations(scopeNodeId);
  const revokeInvitation = useRevokeInvitation(scopeNodeId);

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        Pending invitations
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center text-muted-foreground"
              >
                No pending invitations.
              </TableCell>
            </TableRow>
          )}
          {invitations.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              onRevoke={(id) => {
                revokeInvitation.mutate(id);
              }}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
