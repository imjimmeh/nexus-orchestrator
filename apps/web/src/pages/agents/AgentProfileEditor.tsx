import { useNavigate, useParams } from "react-router-dom";
import {
  useAgentProfiles,
  useCreateAgentProfile,
  useUpdateAgentProfile,
} from "@/hooks/useAgentProfiles";
import {
  useAgentProfileSkills,
  useAgentSkills,
  useReplaceAgentProfileSkills,
} from "@/hooks/useAgentSkills";
import { useProviders } from "@/hooks/useProviders";
import { useModels } from "@/hooks/useModels";
import { useTools } from "@/hooks/useTools";
import { AgentProfileForm } from "./AgentProfileForm";
import { AgentProfile } from "@/lib/api/agents.types";
import { useAgentProfileEditorController } from "./AgentProfileEditor.controller";
import { AgentProfileEditorHeader } from "./AgentProfileEditorHeader";
import { ScopeBreadcrumb } from "@/components/scope/ScopeBreadcrumb";
import { useScopeContext } from "@/context/ScopeContext";
import { useForkAgentForScope } from "@/hooks/useScopedConfig";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";
import { useToast } from "@/hooks/useToast";

export function AgentProfileEditor() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const { activeScopeNodeId, activeScopePath } = useScopeContext();
  const forkAgent = useForkAgentForScope();
  const toast = useToast();

  const handleForkAgent = async (baseProfileId: string, scopeLabel: string) => {
    if (!baseProfileId) return;
    try {
      await forkAgent.mutateAsync({
        baseProfileId,
        scopeNodeId: activeScopeNodeId,
        data: {},
      });
      toast.success("Override created", `Forked for ${scopeLabel}.`);
    } catch {
      toast.error("Fork failed", "Could not create the scope override.");
    }
  };

  const { data: profiles = [] } = useAgentProfiles();
  const profile = isEditMode
    ? profiles.find((p: AgentProfile) => p.id === id)
    : undefined;

  const { data: providers = [] } = useProviders();
  const { data: models = [] } = useModels();
  const { data: skills = [] } = useAgentSkills();
  const { data: toolsPage } = useTools();
  const tools = toolsPage?.data ?? [];

  const createProfile = useCreateAgentProfile();
  const updateProfile = useUpdateAgentProfile();
  const replaceProfileSkills = useReplaceAgentProfileSkills();

  const { data: editingProfileSkills = [] } = useAgentProfileSkills(id ?? "");
  const controller = useAgentProfileEditorController({
    isEditMode,
    profile,
    createProfile,
    updateProfile,
    replaceProfileSkills,
  });

  return (
    <div className="space-y-6">
      <AgentProfileEditorHeader
        isEditMode={isEditMode}
        onBack={() => navigate("/agents")}
      />

      <ScopeBreadcrumb />

      {activeScopeNodeId !== GLOBAL_SCOPE_NODE_ID && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/50 px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">
            ↑ Platform default — inherited by active scope.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => {
              void handleForkAgent(
                profile?.id ?? "",
                activeScopePath[activeScopePath.length - 1],
              );
            }}
            disabled={forkAgent.isPending || !profile}
          >
            <GitFork className="mr-2 h-3.5 w-3.5" />
            Fork override for {activeScopePath[activeScopePath.length - 1]}
          </Button>
        </div>
      )}

      <AgentProfileForm
        profile={profile}
        providers={providers}
        models={models}
        tools={tools}
        skills={skills.filter((skill) => skill.is_active)}
        initialSkillIds={
          isEditMode ? editingProfileSkills.map((skill) => skill.id) : []
        }
        onSubmit={controller.handleSubmit}
        onCancel={controller.onCancel}
        isSubmitting={controller.isSubmitting}
      />
    </div>
  );
}
