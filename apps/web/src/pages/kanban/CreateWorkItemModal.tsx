import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { StoryPoints, WorkItemType } from "@nexus/kanban-contracts";
import { CreateWorkItemRequest, WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
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
import {
  validateWorkItemTypeFields,
  type WorkItemTypeFieldErrors,
} from "@/features/kanban/work-item-type-form.helpers";
import { WorkItemTypeFields } from "./WorkItemEditSections";

interface CreateWorkItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onSubmit: (data: CreateWorkItemRequest) => void;
  items?: WorkItem[];
}

const PRIORITY_OPTIONS = ["p0", "p1", "p2", "p3"] as const;
const STATUS_OPTIONS: WorkItemStatus[] = ["backlog"];
// No work item exists yet at create time, so this id can never collide with
// a real candidate -- it just satisfies WorkItemTypeFields' "exclude the
// item being edited" contract (a no-op here).
const NO_CURRENT_ITEM_ID = "";

const DEFAULTS = {
  title: "",
  description: "",
  priority: "p2",
  status: "backlog" as WorkItemStatus,
  type: "task" as WorkItemType,
};

interface CreateWorkItemFormState {
  title: string;
  description: string;
  priority: string;
  status: WorkItemStatus;
  type: WorkItemType;
  parentWorkItemId: string | null;
  storyPoints: StoryPoints | null;
}

type CreateWorkItemSubmission =
  | { errors: WorkItemTypeFieldErrors }
  | { payload: CreateWorkItemRequest };

/**
 * Validates the type/parent/points combination (mirroring the server's
 * `assertWorkItemInvariants` via the shared `validateWorkItemTypeFields`
 * helper) and, if valid, builds the API payload. Pure and hook-free so it
 * lives outside the component -- keeps `CreateWorkItemModal` itself under
 * the repo's max-lines-per-function ceiling.
 */
function buildCreateWorkItemSubmission(
  form: CreateWorkItemFormState,
  items: WorkItem[],
): CreateWorkItemSubmission {
  const selectedParent = items.find(
    (item) => item.id === form.parentWorkItemId,
  );
  const errors = validateWorkItemTypeFields({
    type: form.type,
    parentType: selectedParent?.type ?? null,
    storyPoints: form.storyPoints,
  });

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  return {
    payload: {
      title: form.title.trim(),
      description: form.description || undefined,
      priority: form.priority,
      status: form.status,
      type: form.type,
      parentWorkItemId: form.parentWorkItemId ?? undefined,
      storyPoints: form.storyPoints ?? undefined,
    },
  };
}

export function CreateWorkItemModal({
  open,
  onOpenChange,
  isPending,
  onSubmit,
  items = [],
}: Readonly<CreateWorkItemModalProps>) {
  const [title, setTitle] = useState(DEFAULTS.title);
  const [description, setDescription] = useState(DEFAULTS.description);
  const [priority, setPriority] = useState(DEFAULTS.priority);
  const [status, setStatus] = useState<WorkItemStatus>(DEFAULTS.status);
  const [type, setType] = useState<WorkItemType>(DEFAULTS.type);
  const [parentWorkItemId, setParentWorkItemId] = useState<string | null>(null);
  const [storyPoints, setStoryPoints] = useState<StoryPoints | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeFieldErrors, setTypeFieldErrors] =
    useState<WorkItemTypeFieldErrors>({});

  useEffect(() => {
    if (!open) {
      setTitle(DEFAULTS.title);
      setDescription(DEFAULTS.description);
      setPriority(DEFAULTS.priority);
      setStatus(DEFAULTS.status);
      setType(DEFAULTS.type);
      setParentWorkItemId(null);
      setStoryPoints(null);
      setError(null);
      setTypeFieldErrors({});
    }
  }, [open]);

  const handleSubmit = () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const result = buildCreateWorkItemSubmission(
      {
        title,
        description,
        priority,
        status,
        type,
        parentWorkItemId,
        storyPoints,
      },
      items,
    );

    if ("errors" in result) {
      setTypeFieldErrors(result.errors);
      return;
    }

    setError(null);
    setTypeFieldErrors({});
    onSubmit(result.payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Work Item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <CreateWorkItemTitleFields
            title={title}
            description={description}
            error={error}
            onTitleChange={(value) => {
              setTitle(value);
              if (error) setError(null);
            }}
            onDescriptionChange={setDescription}
          />

          <CreateWorkItemSelectFields
            priority={priority}
            status={status}
            onPriorityChange={setPriority}
            onStatusChange={(v) => setStatus(v as WorkItemStatus)}
          />

          <WorkItemTypeFields
            currentItemId={NO_CURRENT_ITEM_ID}
            allItems={items}
            type={type}
            parentWorkItemId={parentWorkItemId}
            storyPoints={storyPoints}
            errors={typeFieldErrors}
            onTypeChange={(nextType) => {
              setType(nextType);
              setTypeFieldErrors({});
            }}
            onParentWorkItemIdChange={(nextParentWorkItemId) => {
              setParentWorkItemId(nextParentWorkItemId);
              setTypeFieldErrors({});
            }}
            onStoryPointsChange={(nextStoryPoints) => {
              setStoryPoints(nextStoryPoints as StoryPoints | null);
              setTypeFieldErrors({});
            }}
          />
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              "Creating..."
            ) : (
              <>
                <Plus className="mr-1 h-4 w-4" />
                Create
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CreateWorkItemTitleFieldsProps {
  title: string;
  description: string;
  error: string | null;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}

function CreateWorkItemTitleFields({
  title,
  description,
  error,
  onTitleChange,
  onDescriptionChange,
}: Readonly<CreateWorkItemTitleFieldsProps>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="create-work-item-title">Title</Label>
        <Input
          id="create-work-item-title"
          placeholder="What needs to be done?"
          value={title}
          onChange={(e) => {
            onTitleChange(e.target.value);
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-work-item-description">Description</Label>
        <Textarea
          id="create-work-item-description"
          placeholder="Optional description..."
          rows={3}
          value={description}
          onChange={(e) => {
            onDescriptionChange(e.target.value);
          }}
        />
      </div>
    </>
  );
}

interface CreateWorkItemSelectFieldsProps {
  priority: string;
  status: WorkItemStatus;
  onPriorityChange: (value: string) => void;
  onStatusChange: (value: string) => void;
}

function CreateWorkItemSelectFields({
  priority,
  status,
  onPriorityChange,
  onStatusChange,
}: Readonly<CreateWorkItemSelectFieldsProps>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="create-work-item-priority">Priority</Label>
        <Select value={priority} onValueChange={onPriorityChange}>
          <SelectTrigger id="create-work-item-priority">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="create-work-item-status">Status</Label>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger id="create-work-item-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
