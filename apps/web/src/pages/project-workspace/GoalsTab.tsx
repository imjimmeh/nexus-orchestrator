import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useProjectWorkItems } from "@/hooks/useProjectWorkItems";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  useArchiveProjectGoal,
  useCreateProjectGoal,
  useCreateProjectGoalWorklog,
  useLinkProjectGoalWorkItem,
  useProjectGoalWorklogs,
  useProjectGoals,
  useUnarchiveProjectGoal,
  useUpdateProjectGoalStatus,
} from "@/hooks/useProjectGoals";
import { CreateProjectGoalRequest, ProjectGoal, ProjectGoalMoscow, ProjectGoalPriority, ProjectGoalStatus } from "@/lib/api/goals.types";
import { GoalWorklogsCard } from "./GoalsTab.worklogs";

interface GoalsTabProps {
  projectId: string;
}

interface GoalFormState {
  title: string;
  description: string;
  moscow: ProjectGoalMoscow | "";
  priority: ProjectGoalPriority | "";
  targetDate: string;
}

function createInitialGoalForm(): GoalFormState {
  return {
    title: "",
    description: "",
    moscow: "",
    priority: "",
    targetDate: "",
  };
}

function toGoalPayload(form: GoalFormState): CreateProjectGoalRequest {
  return {
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    moscow: form.moscow || undefined,
    priority: form.priority || undefined,
    target_date: form.targetDate || undefined,
  };
}

function statusBadgeVariant(status: ProjectGoalStatus) {
  switch (status) {
    case "completed":
      return "default" as const;
    case "blocked":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

function GoalMaintenanceCard(
  props: Readonly<{
    createForm: GoalFormState;
    setCreateForm: Dispatch<SetStateAction<GoalFormState>>;
    includeArchived: boolean;
    onCreateGoal: () => void;
    onToggleIncludeArchived: () => void;
  }>,
) {
  const {
    createForm,
    setCreateForm,
    includeArchived,
    onCreateGoal,
    onToggleIncludeArchived,
  } = props;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Goal Maintenance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="goal-title-input">Goal Title</Label>
            <Input
              id="goal-title-input"
              value={createForm.title}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Goal title"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Description</Label>
            <Textarea
              value={createForm.description}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              placeholder="Optional details"
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label>MoSCoW</Label>
            <Select
              value={createForm.moscow || "__none__"}
              onValueChange={(value) =>
                setCreateForm((current) => ({
                  ...current,
                  moscow:
                    value === "__none__" ? "" : (value as ProjectGoalMoscow),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not set</SelectItem>
                <SelectItem value="must">must</SelectItem>
                <SelectItem value="should">should</SelectItem>
                <SelectItem value="could">could</SelectItem>
                <SelectItem value="wont">wont</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Priority</Label>
            <Select
              value={createForm.priority || "__none__"}
              onValueChange={(value) =>
                setCreateForm((current) => ({
                  ...current,
                  priority:
                    value === "__none__" ? "" : (value as ProjectGoalPriority),
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Not set</SelectItem>
                <SelectItem value="p0">p0</SelectItem>
                <SelectItem value="p1">p1</SelectItem>
                <SelectItem value="p2">p2</SelectItem>
                <SelectItem value="p3">p3</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Target Date</Label>
            <Input
              type="date"
              value={createForm.targetDate}
              onChange={(event) =>
                setCreateForm((current) => ({
                  ...current,
                  targetDate: event.target.value,
                }))
              }
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button onClick={onCreateGoal} disabled={!createForm.title.trim()}>
            Add Goal
          </Button>
          <Button variant="outline" onClick={onToggleIncludeArchived}>
            {includeArchived ? "Hide Archived" : "Show Archived"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectGoalsCard(
  props: Readonly<{
    isLoading: boolean;
    goals: ProjectGoal[];
    selectedGoalId: string | null;
    onSelectGoal: (goalId: string) => void;
    onStatusChange: (goalId: string, status: ProjectGoalStatus) => void;
    onToggleArchive: (goal: ProjectGoal) => void;
  }>,
) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Goals</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.isLoading && (
          <p className="text-sm text-muted-foreground">Loading goals...</p>
        )}

        {!props.isLoading && props.goals.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No goals found for this project.
          </p>
        )}

        {props.goals.map((goal) => (
          <div key={goal.id} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{goal.title}</p>
                {goal.description ? (
                  <p className="text-sm text-muted-foreground">
                    {goal.description}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={statusBadgeVariant(goal.status)}>
                  {goal.status}
                </Badge>
                {goal.moscow ? (
                  <Badge variant="outline">{goal.moscow}</Badge>
                ) : null}
                {goal.priority ? (
                  <Badge variant="outline">{goal.priority}</Badge>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={goal.status}
                onValueChange={(value) =>
                  props.onStatusChange(goal.id, value as ProjectGoalStatus)
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">todo</SelectItem>
                  <SelectItem value="in_progress">in_progress</SelectItem>
                  <SelectItem value="blocked">blocked</SelectItem>
                  <SelectItem value="completed">completed</SelectItem>
                  <SelectItem value="cancelled">cancelled</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                onClick={() => props.onToggleArchive(goal)}
              >
                {goal.isArchived ? "Unarchive" : "Archive"}
              </Button>

              <Button
                variant={
                  props.selectedGoalId === goal.id ? "default" : "outline"
                }
                onClick={() => props.onSelectGoal(goal.id)}
              >
                Worklogs
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function GoalsTab({ projectId }: Readonly<GoalsTabProps>) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createForm, setCreateForm] = useState<GoalFormState>(
    createInitialGoalForm(),
  );
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [worklogNote, setWorklogNote] = useState("");
  const [worklogItemId, setWorklogItemId] = useState("__none__");

  const goalsQuery = useProjectGoals(projectId, includeArchived);
  const createGoalMutation = useCreateProjectGoal(projectId);
  const updateStatusMutation = useUpdateProjectGoalStatus(projectId);
  const archiveGoalMutation = useArchiveProjectGoal(projectId);
  const unarchiveGoalMutation = useUnarchiveProjectGoal(projectId);
  const createWorklogMutation = useCreateProjectGoalWorklog(projectId);
  const linkWorkItemMutation = useLinkProjectGoalWorkItem(projectId);

  const { data: workItems = [] } = useProjectWorkItems(projectId, {
    scope: "goal-link-picker",
  });

  const goals = goalsQuery.data ?? [];
  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const worklogsQuery = useProjectGoalWorklogs(projectId, selectedGoal?.id);
  const worklogs = worklogsQuery.data ?? [];

  const sortedWorkItems = useMemo(
    () => [...workItems].sort((a, b) => a.title.localeCompare(b.title)),
    [workItems],
  );

  const handleCreateGoal = async () => {
    if (!createForm.title.trim()) {
      return;
    }

    await createGoalMutation.mutateAsync(toGoalPayload(createForm));
    setCreateForm(createInitialGoalForm());
  };

  const handleCreateWorklog = async () => {
    if (!selectedGoal || !worklogNote.trim()) {
      return;
    }

    if (worklogItemId === "__none__") {
      await createWorklogMutation.mutateAsync({
        goalId: selectedGoal.id,
        data: {
          entry_type: "note",
          author_type: "user",
          note: worklogNote.trim(),
        },
      });
    } else {
      await linkWorkItemMutation.mutateAsync({
        goalId: selectedGoal.id,
        work_item_id: worklogItemId,
        note: worklogNote.trim(),
      });
    }

    setWorklogNote("");
    setWorklogItemId("__none__");
  };

  const handleStatusChange = (goalId: string, status: ProjectGoalStatus) => {
    updateStatusMutation.mutateAsync({
      goalId,
      data: { status },
    });
  };

  const handleToggleArchive = (goal: ProjectGoal) => {
    if (goal.isArchived) {
      unarchiveGoalMutation.mutateAsync(goal.id);
      return;
    }

    archiveGoalMutation.mutateAsync(goal.id);
  };

  return (
    <div className="space-y-4">
      <GoalMaintenanceCard
        createForm={createForm}
        setCreateForm={setCreateForm}
        includeArchived={includeArchived}
        onCreateGoal={() => void handleCreateGoal()}
        onToggleIncludeArchived={() => setIncludeArchived((value) => !value)}
      />

      <ProjectGoalsCard
        isLoading={goalsQuery.isLoading}
        goals={goals}
        selectedGoalId={selectedGoalId}
        onSelectGoal={setSelectedGoalId}
        onStatusChange={handleStatusChange}
        onToggleArchive={handleToggleArchive}
      />

      {selectedGoal ? (
        <GoalWorklogsCard
          selectedGoal={selectedGoal}
          worklogNote={worklogNote}
          setWorklogNote={setWorklogNote}
          worklogItemId={worklogItemId}
          setWorklogItemId={setWorklogItemId}
          sortedWorkItems={sortedWorkItems.map((item) => ({
            id: item.id,
            title: item.title,
          }))}
          onCreateWorklog={() => void handleCreateWorklog()}
          worklogs={worklogs}
          isLoading={worklogsQuery.isLoading}
        />
      ) : null}
    </div>
  );
}
