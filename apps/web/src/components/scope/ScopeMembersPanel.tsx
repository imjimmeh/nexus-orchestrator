// apps/web/src/components/scope/ScopeMembersPanel.tsx
import { useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useScopeMembers, useRevokeScopeMember } from "@/hooks/useScopeMembers";
import { useUserSearch } from "@/hooks/useUserSearch";
import { useAssignRole, useRoles } from "@/hooks/useRoleAssignments";
import { useToast } from "@/hooks/useToast";
import type { UserSearchResult } from "@/hooks/useUserSearch.types";
import { InviteDialog } from "./InviteDialog";
import { PendingInvitationsList } from "./PendingInvitationsList";

const MIN_SEARCH_LENGTH = 2;

interface ScopeMembersPanelProps {
  scopeNodeId: string;
}

interface UserPickerProps {
  scopeNodeId: string;
  roles: { id: string; name: string }[];
}

function UserPicker({ scopeNodeId, roles }: Readonly<UserPickerProps>) {
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(
    null,
  );
  const [roleId, setRoleId] = useState("");
  const { data: results = [] } = useUserSearch(query);
  const assignRole = useAssignRole(scopeNodeId);
  const toast = useToast();

  const showResults = !selectedUser && query.trim().length >= MIN_SEARCH_LENGTH;

  const handleSelectUser = (user: UserSearchResult) => {
    setSelectedUser(user);
    setQuery(user.email);
  };

  const handleAdd = async () => {
    if (!selectedUser || !roleId) return;
    try {
      await assignRole.mutateAsync({ userId: selectedUser.id, roleId });
      toast.success("Member added", `${selectedUser.email} added to scope.`);
      setSelectedUser(null);
      setQuery("");
      setRoleId("");
    } catch {
      toast.error("Error", "Failed to add member.");
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="relative w-64">
        <Input
          placeholder="Search by name or email..."
          value={query}
          onChange={(e) => {
            setSelectedUser(null);
            setQuery(e.target.value);
          }}
        />
        {showResults && results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
            {results.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    handleSelectUser(user);
                  }}
                >
                  {user.email}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Select value={roleId} onValueChange={setRoleId}>
        <SelectTrigger className="w-40">
          <SelectValue placeholder="Select a role..." />
        </SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        onClick={() => {
          void handleAdd();
        }}
        disabled={!selectedUser || !roleId || assignRole.isPending}
      >
        Add
      </Button>
    </div>
  );
}

interface DirectMembersTableProps {
  members: {
    userId: string;
    userEmail: string;
    roleId: string;
    roleName: string;
  }[];
  onRevoke: (userId: string, roleId: string, email: string) => void;
}

function DirectMembersTable({
  members,
  onRevoke,
}: Readonly<DirectMembersTableProps>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Role</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={3}
              className="text-center text-muted-foreground"
            >
              No direct members.
            </TableCell>
          </TableRow>
        )}
        {members.map((m) => (
          <TableRow key={`${m.userId}-${m.roleId}`}>
            <TableCell>{m.userEmail}</TableCell>
            <TableCell>
              <Badge variant="secondary">{m.roleName}</Badge>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive"
                onClick={() => {
                  onRevoke(m.userId, m.roleId, m.userEmail);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface InheritedMembersTableProps {
  members: {
    userId: string;
    userEmail: string;
    roleId: string;
    roleName: string;
    sourceScopeNodeId: string;
    sourceScopeName: string;
  }[];
}

function InheritedMembersTable({
  members,
}: Readonly<InheritedMembersTableProps>) {
  if (members.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">
        Inherited from parent scopes (read-only here)
      </h4>
      <Table>
        <TableBody>
          {members.map((m) => (
            <TableRow
              key={`${m.userId}-${m.roleId}-${m.sourceScopeNodeId}`}
              className="opacity-70"
            >
              <TableCell>{m.userEmail}</TableCell>
              <TableCell>
                <Badge variant="secondary">{m.roleName}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">↑ {m.sourceScopeName}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ScopeMembersPanel({
  scopeNodeId,
}: Readonly<ScopeMembersPanelProps>) {
  const { data: members = [], isLoading } = useScopeMembers(scopeNodeId);
  const { data: roles = [] } = useRoles();
  const revokeMember = useRevokeScopeMember(scopeNodeId);
  const toast = useToast();
  const [isInviteOpen, setIsInviteOpen] = useState(false);

  const directMembers = members.filter((m) => m.source === "direct");
  const inheritedMembers = members.filter((m) => m.source === "inherited");

  const handleRevoke = async (
    userId: string,
    roleId: string,
    email: string,
  ) => {
    try {
      await revokeMember.mutateAsync({ userId, roleId });
      toast.success("Member removed", `${email} removed from scope.`);
    } catch {
      toast.error("Error", "Failed to remove member.");
    }
  };

  if (isLoading)
    return <p className="py-4 text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Members</h3>
        <Button
          size="sm"
          onClick={() => {
            setIsInviteOpen(true);
          }}
        >
          <UserPlus className="mr-2 h-4 w-4" />
          Invite
        </Button>
      </div>

      <UserPicker scopeNodeId={scopeNodeId} roles={roles} />

      <DirectMembersTable
        members={directMembers}
        onRevoke={(userId, roleId, email) => {
          void handleRevoke(userId, roleId, email);
        }}
      />

      <InheritedMembersTable members={inheritedMembers} />

      <PendingInvitationsList scopeNodeId={scopeNodeId} />

      <InviteDialog
        scopeNodeId={scopeNodeId}
        open={isInviteOpen}
        onClose={() => {
          setIsInviteOpen(false);
        }}
      />
    </div>
  );
}
