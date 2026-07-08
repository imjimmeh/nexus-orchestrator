import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useProjectList } from "@/hooks/useProjects";
import { useCreateChatSession } from "@/hooks/useChatSessions";
import { AgentProfile } from "@/lib/api/agents.types";
import { Project } from "@/lib/api/projects.types";
import { NewSessionAgentSelector } from "./new-session-agent-selector";
import { NewSessionProjectSelector } from "./new-session-project-selector";

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultProjectId?: string;
}

export function NewSessionDialog({
  open,
  onOpenChange,
  defaultProjectId,
}: Readonly<NewSessionDialogProps>) {
  const navigate = useNavigate();
  const [advancedMode, setAdvancedMode] = useState(false);
  const [sessionType, setSessionType] = useState("general");
  const [agentProfileName, setAgentProfileName] = useState("");
  const [participantProfiles, setParticipantProfiles] = useState<string[]>([]);
  const [moderatorProfile, setModeratorProfile] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(
    defaultProjectId ?? null,
  );
  const [message, setMessage] = useState("");

  const { data: agentProfiles = [], isLoading: agentsLoading } =
    useAgentProfiles();
  const { data: projects = [], isLoading: projectsLoading } = useProjectList();
  const createSession = useCreateChatSession();

  const activeProfiles = agentProfiles.filter((p) => p.is_active);
  const isSteering = sessionType === "steering";
  const agentDisabled = isSteering;
  const projectRequired = isSteering;
  const effectiveAgentProfileName = isSteering ? "ceo-agent" : agentProfileName;
  const canSubmit =
    effectiveAgentProfileName.length > 0 &&
    message.trim().length > 0 &&
    (!projectRequired || projectId !== null) &&
    !createSession.isPending;

  function handleAdvancedModeToggle(value: boolean) {
    setAdvancedMode(value);
    if (!value) {
      setSessionType("general");
    }
  }

  function handleSessionTypeChange(value: string) {
    setSessionType(value);
    if (value === "steering") {
      setAgentProfileName("ceo-agent");
    }
  }

  function handleAgentChange(value: string) {
    setAgentProfileName(value);
    setParticipantProfiles((current) =>
      current.filter((profileName) => profileName !== value),
    );
    setModeratorProfile((current) => (current === value ? null : current));
  }

  function handleParticipantToggle(profileName: string, checked: boolean) {
    setParticipantProfiles((current) => {
      if (checked) {
        if (current.includes(profileName)) {
          return current;
        }

        return [...current, profileName];
      }

      return current.filter((value) => value !== profileName);
    });
  }

  function resetForm() {
    setAdvancedMode(false);
    setSessionType("general");
    setAgentProfileName("");
    setParticipantProfiles([]);
    setModeratorProfile(null);
    setProjectId(defaultProjectId ?? null);
    setMessage("");
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    const selectedProjectId = projectId ?? undefined;
    const participants = participantProfiles.map((profileName) => ({
      agent_profile: profileName,
      role: "participant" as const,
    }));
    const resolvedModeratorProfile = moderatorProfile ?? undefined;

    const result = await createSession.mutateAsync({
      agentProfileName: effectiveAgentProfileName,
      projectId: selectedProjectId,
      initialMessage: message.trim(),
      sessionType: isSteering ? ("steering" as const) : ("general" as const),
      participants,
      moderatorProfile: resolvedModeratorProfile,
    });

    resetForm();
    onOpenChange(false);

    navigate(`/chat-sessions/${result.id}`);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
          <DialogDescription>
            Start a conversation with any agent. Optionally scope it to a
            project. Sessions without a project can still persist reusable
            skills, tools, and artifact files globally.
          </DialogDescription>
        </DialogHeader>

        <NewSessionDialogBody
          advancedMode={advancedMode}
          sessionType={sessionType}
          message={message}
          agentProfileName={effectiveAgentProfileName}
          agentDisabled={agentDisabled}
          activeProfiles={activeProfiles}
          agentsLoading={agentsLoading}
          participantProfiles={participantProfiles}
          moderatorProfile={moderatorProfile}
          projectId={projectId}
          projects={projects}
          projectsLoading={projectsLoading}
          projectRequired={projectRequired}
          createSessionError={createSession.isError}
          onAdvancedModeToggle={handleAdvancedModeToggle}
          onSessionTypeChange={handleSessionTypeChange}
          onAgentChange={handleAgentChange}
          onParticipantToggle={handleParticipantToggle}
          onModeratorChange={setModeratorProfile}
          onProjectChange={setProjectId}
          onMessageChange={setMessage}
          onSubmit={handleSubmit}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
          >
            {createSession.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Start Session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NewSessionDialogBodyProps {
  advancedMode: boolean;
  sessionType: string;
  message: string;
  agentProfileName: string;
  agentDisabled: boolean;
  activeProfiles: AgentProfile[];
  agentsLoading: boolean;
  participantProfiles: string[];
  moderatorProfile: string | null;
  projectId: string | null;
  projects: Project[];
  projectsLoading: boolean;
  projectRequired: boolean;
  createSessionError: boolean;
  onAdvancedModeToggle: (value: boolean) => void;
  onSessionTypeChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onParticipantToggle: (profileName: string, checked: boolean) => void;
  onModeratorChange: (profileName: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onMessageChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
}

function NewSessionDialogBody({
  advancedMode,
  sessionType,
  message,
  agentProfileName,
  agentDisabled,
  activeProfiles,
  agentsLoading,
  participantProfiles,
  moderatorProfile,
  projectId,
  projects,
  projectsLoading,
  projectRequired,
  createSessionError,
  onAdvancedModeToggle,
  onSessionTypeChange,
  onAgentChange,
  onParticipantToggle,
  onModeratorChange,
  onProjectChange,
  onMessageChange,
  onSubmit,
}: Readonly<NewSessionDialogBodyProps>) {
  return (
    <div className="space-y-4 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAdvancedModeToggle(!advancedMode)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {advancedMode ? "Hide advanced options" : "Show advanced options"}
        </button>
      </div>

      {advancedMode && (
        <div className="space-y-2">
          <Label htmlFor="session-type">Session Type</Label>
          <Select value={sessionType} onValueChange={onSessionTypeChange}>
            <SelectTrigger id="session-type">
              <SelectValue placeholder="Select session type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="steering">Steering</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <NewSessionAgentSelector
        agentProfileName={agentProfileName}
        onAgentChange={onAgentChange}
        agentDisabled={agentDisabled}
        activeProfiles={activeProfiles}
        agentsLoading={agentsLoading}
        participantProfiles={participantProfiles}
        onParticipantToggle={onParticipantToggle}
        moderatorProfile={moderatorProfile}
        onModeratorChange={onModeratorChange}
      />

      <NewSessionProjectSelector
        projectId={projectId}
        onProjectChange={onProjectChange}
        projects={projects}
        projectsLoading={projectsLoading}
        projectRequired={projectRequired}
      />

      <div className="space-y-2">
        <Label htmlFor="initial-message">Message</Label>
        <Textarea
          id="initial-message"
          placeholder={
            sessionType === "steering"
              ? "Describe what you want to change..."
              : "What would you like the agent to do?"
          }
          value={message}
          onChange={(e) => {
            onMessageChange(e.target.value);
          }}
          rows={4}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              void onSubmit();
            }
          }}
        />
      </div>

      {createSessionError && (
        <p className="text-sm text-destructive">
          Failed to start session. Please try again.
        </p>
      )}
    </div>
  );
}
