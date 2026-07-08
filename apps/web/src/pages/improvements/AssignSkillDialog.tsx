import { useEffect, useState } from "react";
import type { CreateSkillAssignmentProposalRequest } from "@nexus/core";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useAgentSkills } from "@/hooks/useAgentSkills";
import {
  useWorkflows,
  WORKFLOW_NAME_CATALOG_QUERY,
} from "@/hooks/useWorkflows";

type AssignSkillTargetType = "agent_profile" | "workflow_step";

const DEFAULT_TARGET_TYPE: AssignSkillTargetType = "agent_profile";

export interface AssignSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Left to the caller — this component only composes the create-proposal body. */
  onSubmit: (body: CreateSkillAssignmentProposalRequest) => void;
}

interface AssignSkillFormState {
  skillName: string;
  targetType: AssignSkillTargetType;
  profileName: string;
  workflowName: string;
  stepId: string;
  rationale: string;
}

const EMPTY_FORM_STATE: AssignSkillFormState = {
  skillName: "",
  targetType: DEFAULT_TARGET_TYPE,
  profileName: "",
  workflowName: "",
  stepId: "",
  rationale: "",
};

function hasValidTarget(state: AssignSkillFormState): boolean {
  return state.targetType === "agent_profile"
    ? state.profileName.length > 0
    : state.workflowName.length > 0;
}

function buildRequestBody(
  state: AssignSkillFormState,
): CreateSkillAssignmentProposalRequest {
  const target =
    state.targetType === "agent_profile"
      ? ({
          type: "agent_profile" as const,
          profileName: state.profileName,
        } satisfies CreateSkillAssignmentProposalRequest["targets"][number])
      : ({
          type: "workflow_step" as const,
          workflowName: state.workflowName,
          ...(state.stepId.trim() ? { stepId: state.stepId.trim() } : {}),
        } satisfies CreateSkillAssignmentProposalRequest["targets"][number]);

  const rationale = state.rationale.trim();

  return {
    skillName: state.skillName,
    targets: [target],
    ...(rationale ? { rationale } : {}),
  };
}

/**
 * Operator-directed "Assign skill" dialog (FU-10/PD-4) — the successor to
 * the deleted project-workspace scope-confirmation UI. Presentational: it
 * only fetches picker option data itself (skills/agent-profiles/workflows,
 * via the existing admin/workflow query hooks) and composes the
 * `POST /improvement/proposals` request body; the actual create mutation
 * and its outcome handling live in the caller (the Improvements queue
 * container), per the web quality gate's side-effects-in-hooks rule.
 */
export function AssignSkillDialog({
  open,
  onOpenChange,
  onSubmit,
}: Readonly<AssignSkillDialogProps>) {
  const { data: skills = [] } = useAgentSkills();
  const { data: profiles = [] } = useAgentProfiles();
  const { data: workflows = [] } = useWorkflows(WORKFLOW_NAME_CATALOG_QUERY);

  const [formState, setFormState] =
    useState<AssignSkillFormState>(EMPTY_FORM_STATE);

  useEffect(() => {
    if (!open) return;
    setFormState(EMPTY_FORM_STATE);
  }, [open]);

  const canSubmit = formState.skillName.length > 0 && hasValidTarget(formState);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(buildRequestBody(formState));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign skill</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="assignSkillName">Skill</Label>
            <Select
              value={formState.skillName}
              onValueChange={(value) => {
                setFormState((current) => ({ ...current, skillName: value }));
              }}
            >
              <SelectTrigger id="assignSkillName" aria-label="Skill">
                <SelectValue placeholder="Select a skill" />
              </SelectTrigger>
              <SelectContent>
                {skills.map((skill) => (
                  <SelectItem key={skill.id} value={skill.name}>
                    {skill.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignSkillTargetType">Target type</Label>
            <Select
              value={formState.targetType}
              onValueChange={(value) => {
                setFormState((current) => ({
                  ...current,
                  targetType: value as AssignSkillTargetType,
                }));
              }}
            >
              <SelectTrigger
                id="assignSkillTargetType"
                aria-label="Target type"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent_profile">Agent profile</SelectItem>
                <SelectItem value="workflow_step">Workflow step</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formState.targetType === "agent_profile" ? (
            <div className="space-y-1.5">
              <Label htmlFor="assignSkillProfile">Agent profile</Label>
              <Select
                value={formState.profileName}
                onValueChange={(value) => {
                  setFormState((current) => ({
                    ...current,
                    profileName: value,
                  }));
                }}
              >
                <SelectTrigger
                  id="assignSkillProfile"
                  aria-label="Agent profile"
                >
                  <SelectValue placeholder="Select an agent profile" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.name}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="assignSkillWorkflow">Workflow</Label>
                <Select
                  value={formState.workflowName}
                  onValueChange={(value) => {
                    setFormState((current) => ({
                      ...current,
                      workflowName: value,
                    }));
                  }}
                >
                  <SelectTrigger id="assignSkillWorkflow" aria-label="Workflow">
                    <SelectValue placeholder="Select a workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {workflows.map((workflow) => (
                      <SelectItem key={workflow.id} value={workflow.name}>
                        {workflow.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assignSkillStepId">Step ID (optional)</Label>
                <Input
                  id="assignSkillStepId"
                  value={formState.stepId}
                  onChange={(event) => {
                    setFormState((current) => ({
                      ...current,
                      stepId: event.target.value,
                    }));
                  }}
                  placeholder="e.g. gather-context"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="assignSkillRationale">Rationale (optional)</Label>
            <Textarea
              id="assignSkillRationale"
              value={formState.rationale}
              onChange={(event) => {
                setFormState((current) => ({
                  ...current,
                  rationale: event.target.value,
                }));
              }}
              placeholder="Why this skill should be assigned to this target"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Assign skill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
