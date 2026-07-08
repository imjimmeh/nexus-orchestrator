import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useAgentProfiles,
  useDeleteAgentProfile,
} from "@/hooks/useAgentProfiles";
import { AgentProfile } from "@/lib/api/agents.types";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

function formatSource(source: AgentProfile["source"]): string {
  if (source === "seeded") {
    return "Seeded";
  }
  if (source === "agent_factory") {
    return "Agent Factory";
  }
  return "Admin";
}

function formatProvenance(profile: AgentProfile): string {
  if (profile.source === "agent_factory") {
    const creator = profile.created_by_profile ?? "Unknown creator";
    const workflowRun = profile.created_by_workflow_run_id ?? "No run id";
    return `${creator} · ${workflowRun}`;
  }
  if (profile.source === "seeded") {
    return "Seeded profile";
  }
  return "Created via admin UI";
}

interface AgentProfileRowsProps {
  isLoading: boolean;
  profiles: AgentProfile[];
  onEdit: (profile: AgentProfile) => void;
  onDelete: (profile: AgentProfile) => void;
}

function AgentProfileRows({
  isLoading,
  profiles,
  onEdit,
  onDelete,
}: Readonly<AgentProfileRowsProps>) {
  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  }

  if (profiles.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="text-center">
          No agent profiles found
        </TableCell>
      </TableRow>
    );
  }

  return profiles.map((profile: AgentProfile) => (
    <TableRow key={profile.id}>
      <TableCell className="font-medium">{profile.name}</TableCell>
      <TableCell>{profile.model_name || "-"}</TableCell>
      <TableCell>{profile.provider_name || "-"}</TableCell>
      <TableCell>
        {profile.tier_preference ? (
          <Badge
            variant={
              profile.tier_preference === "heavy" ? "default" : "secondary"
            }
          >
            {profile.tier_preference}
          </Badge>
        ) : (
          "-"
        )}
      </TableCell>
      <TableCell>
        <Badge
          variant={profile.source === "agent_factory" ? "default" : "secondary"}
        >
          {formatSource(profile.source)}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[220px] truncate">
        {formatProvenance(profile)}
      </TableCell>
      <TableCell>
        <Badge variant={profile.is_active ? "default" : "secondary"}>
          {profile.is_active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>—</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(profile)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(profile)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  ));
}

export function AgentProfiles() {
  const { activeScopeNodeId } = useScopeContext();
  const { data: profiles = [], isLoading } = useAgentProfiles({
    scopeNodeId: activeScopeNodeId,
  });
  const deleteProfile = useDeleteAgentProfile();
  const navigate = useNavigate();

  const [includeDescendants, setIncludeDescendants] = useState(true);
  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

  const [deletingProfile, setDeletingProfile] = useState<AgentProfile | null>(
    null,
  );

  const handleDelete = async () => {
    if (!deletingProfile) return;

    await deleteProfile.mutateAsync(deletingProfile.id);
    setDeletingProfile(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agent Profiles</h2>
          <p className="text-muted-foreground">
            Manage AI agent configurations
          </p>
        </div>
        <div className="flex items-center gap-4">
          {!isGlobalScope && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="include-descendants-agents"
                checked={includeDescendants}
                onCheckedChange={(v) => {
                  setIncludeDescendants(!!v);
                }}
              />
              <Label htmlFor="include-descendants-agents" className="text-sm">
                Include descendants
              </Label>
            </div>
          )}
          <Button onClick={() => navigate("/agents/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add Profile
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Provenance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AgentProfileRows
              isLoading={isLoading}
              profiles={profiles}
              onEdit={(profile) => navigate(`/agents/${profile.id}/edit`)}
              onDelete={setDeletingProfile}
            />
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deletingProfile}
        onOpenChange={() => setDeletingProfile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the agent profile "
              {deletingProfile?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingProfile(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
