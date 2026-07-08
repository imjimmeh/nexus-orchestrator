// apps/web/src/components/scope/InviteDialog.tsx
import { useEffect, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateInvitation } from "@/hooks/useInvitations";
import { useRoles } from "@/hooks/useRoleAssignments";
import { buildInviteLink } from "@/lib/inviteLink";
import type { CreateInvitationResult } from "@/lib/api/client.invitations.types";

const COPY_LABEL_RESET_MS = 2000;

interface InviteDialogProps {
  scopeNodeId: string;
  open: boolean;
  onClose: () => void;
}

function InviteForm({
  roleId,
  email,
  isPending,
  isError,
  onRoleChange,
  onEmailChange,
  onCancel,
  onSubmit,
}: Readonly<{
  roleId: string;
  email: string;
  isPending: boolean;
  isError: boolean;
  onRoleChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (event: React.SyntheticEvent) => void;
}>) {
  const { data: roles = [] } = useRoles();

  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <div className="space-y-2">
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={roleId}
          onChange={(event) => onRoleChange(event.target.value)}
        >
          <option value="">Select a role...</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="invite-email">Email (optional)</Label>
        <Input
          id="invite-email"
          type="email"
          placeholder="name@example.com"
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
        />
      </div>
      {isError && (
        <p className="text-sm text-destructive">
          Failed to create invitation. Please try again.
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!roleId || isPending}>
          Send
        </Button>
      </DialogFooter>
    </form>
  );
}

function InviteLinkSuccessView({
  inviteToken,
  onDone,
}: Readonly<{ inviteToken: string; onDone: () => void }>) {
  const [copied, setCopied] = useState(false);
  const inviteLink = buildInviteLink(inviteToken);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_LABEL_RESET_MS);
    } catch {
      // Clipboard write failed (e.g. permission denied); the label simply
      // stays "Copy" so the user can retry or copy manually.
    }
  };

  return (
    <div className="space-y-3">
      <Label htmlFor="invite-link">Invite link</Label>
      <div className="flex gap-2">
        <Input id="invite-link" readOnly value={inviteLink} />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

export function InviteDialog({
  scopeNodeId,
  open,
  onClose,
}: Readonly<InviteDialogProps>) {
  const createInvitation = useCreateInvitation(scopeNodeId);
  const [roleId, setRoleId] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<CreateInvitationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setRoleId("");
    setEmail("");
    setResult(null);
  }, [open]);

  const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!roleId) return;
    const trimmedEmail = email.trim();
    createInvitation.mutate(
      trimmedEmail ? { roleId, email: trimmedEmail } : { roleId },
      { onSuccess: (createdResult) => setResult(createdResult) },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
        </DialogHeader>
        {result ? (
          <InviteLinkSuccessView
            inviteToken={result.inviteToken}
            onDone={onClose}
          />
        ) : (
          <InviteForm
            roleId={roleId}
            email={email}
            isPending={createInvitation.isPending}
            isError={createInvitation.isError}
            onRoleChange={setRoleId}
            onEmailChange={setEmail}
            onCancel={onClose}
            onSubmit={handleSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
