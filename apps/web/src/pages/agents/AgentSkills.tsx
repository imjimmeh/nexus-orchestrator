import { useState } from "react";
import {
  useAgentSkills,
  useCreateAgentSkill,
  useUpdateAgentSkill,
  useDeleteAgentSkill,
} from "@/hooks/useAgentSkills";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { SkillEditor } from "./SkillEditor";

type SkillRow = {
  id: string;
  name: string;
  description: string;
  skill_markdown: string;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: "admin" | "agent_factory" | "imported" | null;
  created_by_profile?: string | null;
  created_by_workflow_run_id?: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

// Not wired to the active app scope (Phase 5 Task 8): the skills:read list
// endpoint (AgentSkillsController#listSkills -> AgentSkillLibraryService) is
// a filesystem-backed skill library, not the multi-tenant scope_node_closure
// hierarchy - its `SkillScope` field is an unrelated prompt-applicability
// concept. The DB-backed `Skill` entity does carry scope_node_id, but no
// list endpoint exposes it. See Phase 5 Task 7 report ("Not filtered" section)
// for the investigation.
export function AgentSkills() {
  const { data: skills = [], isLoading } = useAgentSkills({
    includeInactive: true,
  });
  const createSkill = useCreateAgentSkill();
  const updateSkill = useUpdateAgentSkill();
  const deleteSkill = useDeleteAgentSkill();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillRow | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<SkillRow | null>(null);

  let rows;
  if (isLoading) {
    rows = (
      <TableRow>
        <TableCell colSpan={6} className="text-center">
          Loading...
        </TableCell>
      </TableRow>
    );
  } else if (skills.length === 0) {
    rows = (
      <TableRow>
        <TableCell colSpan={6} className="text-center">
          No skills found
        </TableCell>
      </TableRow>
    );
  } else {
    rows = (
      <>
        {skills.map((skill) => (
          <TableRow key={skill.id}>
            <TableCell className="font-medium">{skill.name}</TableCell>
            <TableCell className="max-w-[420px] truncate">
              {skill.description}
            </TableCell>
            <TableCell>{skill.version}</TableCell>
            <TableCell>{skill.source ?? "admin"}</TableCell>
            <TableCell>
              <Badge variant={skill.is_active ? "default" : "secondary"}>
                {skill.is_active ? "Active" : "Inactive"}
              </Badge>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingSkill(skill);
                    setIsEditOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeletingSkill(skill)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Agent Skills</h2>
          <p className="text-muted-foreground">
            Create and manage reusable SKILL.md instructions.
          </p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Skill
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-[900px]">
            <DialogHeader>
              <DialogTitle>Create Skill</DialogTitle>
            </DialogHeader>
            <SkillEditor
              onSubmit={async (data) => {
                await createSkill.mutateAsync(data);
                setIsCreateOpen(false);
              }}
              onCancel={() => setIsCreateOpen(false)}
              isSubmitting={createSkill.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>{rows}</TableBody>
        </Table>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Edit Skill</DialogTitle>
          </DialogHeader>
          {editingSkill && (
            <SkillEditor
              key={editingSkill.id}
              skill={editingSkill}
              onSubmit={async (data) => {
                await updateSkill.mutateAsync({
                  id: editingSkill.id,
                  data,
                });
                setIsEditOpen(false);
                setEditingSkill(null);
              }}
              onCancel={() => {
                setIsEditOpen(false);
                setEditingSkill(null);
              }}
              isSubmitting={updateSkill.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingSkill}
        onOpenChange={() => setDeletingSkill(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete skill?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the skill from all profile assignments. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingSkill(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!deletingSkill) {
                  return;
                }
                await deleteSkill.mutateAsync(deletingSkill.id);
                setDeletingSkill(null);
              }}
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
