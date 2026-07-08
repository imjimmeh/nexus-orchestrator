import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NullableSelect } from "@/components/ui/nullable-select";
import { AgentProfile } from "@/lib/api/agents.types";

const PERSISTENCE_GUIDANCE_PROFILES = new Set([
  "friendly-general-assistant",
  "software-engineer-assistant",
]);

interface NewSessionAgentSelectorProps {
  agentProfileName: string;
  onAgentChange: (value: string) => void;
  agentDisabled?: boolean;
  activeProfiles: AgentProfile[];
  agentsLoading: boolean;
  participantProfiles: string[];
  onParticipantToggle: (profileName: string, checked: boolean) => void;
  moderatorProfile: string | null;
  onModeratorChange: (value: string | null) => void;
}

export function NewSessionAgentSelector({
  agentProfileName,
  onAgentChange,
  agentDisabled,
  activeProfiles,
  agentsLoading,
  participantProfiles,
  onParticipantToggle,
  moderatorProfile,
  onModeratorChange,
}: Readonly<NewSessionAgentSelectorProps>) {
  const collaborationCandidates = activeProfiles.filter(
    (profile) => profile.name !== agentProfileName,
  );
  const showPersistenceGuidance =
    PERSISTENCE_GUIDANCE_PROFILES.has(agentProfileName);

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="agent-profile">Agent</Label>
        <Select
          value={agentProfileName}
          onValueChange={onAgentChange}
          disabled={agentDisabled}
        >
          <SelectTrigger id="agent-profile">
            <SelectValue
              placeholder={
                agentsLoading ? "Loading agents..." : "Select an agent"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {activeProfiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.name}>
                <span className="flex items-center gap-2">
                  {profile.name}
                  {profile.tier_preference && (
                    <Badge variant="outline" className="text-xs">
                      {profile.tier_preference}
                    </Badge>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {showPersistenceGuidance && (
          <p className="text-xs text-muted-foreground">
            This agent can persist reusable skills, tools, and global artifacts
            across sessions. Ask it to create skills, write SKILL.md files, and
            save reusable scripts as artifacts when needed.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Additional Participants (optional)</Label>
        {collaborationCandidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Select a primary agent to add collaborators.
          </p>
        ) : (
          <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-3">
            {collaborationCandidates.map((profile) => {
              const checked = participantProfiles.includes(profile.name);
              return (
                <label
                  key={profile.id}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-sm"
                >
                  <span className="truncate">{profile.name}</span>
                  <div className="flex items-center gap-2">
                    {profile.tier_preference && (
                      <Badge variant="outline" className="text-xs">
                        {profile.tier_preference}
                      </Badge>
                    )}
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(nextChecked) => {
                        onParticipantToggle(profile.name, nextChecked === true);
                      }}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="moderator-profile">Moderator (optional)</Label>
        <NullableSelect
          value={moderatorProfile}
          onValueChange={onModeratorChange}
          placeholder="No moderator"
        >
          {collaborationCandidates.map((profile) => (
            <SelectItem key={profile.id} value={profile.name}>
              {profile.name}
            </SelectItem>
          ))}
        </NullableSelect>
      </div>
    </>
  );
}
