import { Save, X } from "lucide-react";
import {
  allowsStoryPoints,
  STORY_POINT_VALUES,
  WORK_ITEM_TYPES,
  type WorkItemType,
} from "@nexus/kanban-contracts";
import { WorkItem } from "@/lib/api/work-items.types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORK_ITEM_TYPE_META } from "@/features/kanban/work-item-type.constants";
import {
  getEligibleParentCandidates,
  type WorkItemTypeFieldErrors,
} from "@/features/kanban/work-item-type-form.helpers";

const PRIORITIES = ["p0", "p1", "p2", "p3"] as const;
const NATIVE_SELECT_CLASSNAME =
  "flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

interface WorkItemCoreFieldsProps {
  title: string;
  description: string;
  priority: string;
  titleError?: string;
  priorityError?: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
}

export function WorkItemCoreFields({
  title,
  description,
  priority,
  titleError,
  priorityError,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
}: Readonly<WorkItemCoreFieldsProps>) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="detail-title">Title</Label>
        <Input
          id="detail-title"
          value={title}
          onChange={(event) => {
            onTitleChange(event.target.value);
          }}
        />
        {titleError ? (
          <p className="text-sm text-destructive">{titleError}</p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="detail-description">Description</Label>
        <Textarea
          id="detail-description"
          value={description}
          onChange={(event) => {
            onDescriptionChange(event.target.value);
          }}
          rows={4}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="detail-priority">Priority</Label>
        <Select value={priority} onValueChange={onPriorityChange}>
          <SelectTrigger id="detail-priority">
            <SelectValue placeholder="Select priority" />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {entry.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {priorityError ? (
          <p className="text-sm text-destructive">{priorityError}</p>
        ) : null}
      </div>
    </>
  );
}

interface WorkItemTypeFieldsProps {
  currentItemId: string;
  allItems: WorkItem[];
  type: WorkItemType;
  parentWorkItemId: string | null;
  storyPoints: number | null;
  errors: WorkItemTypeFieldErrors;
  onTypeChange: (type: WorkItemType) => void;
  onParentWorkItemIdChange: (parentWorkItemId: string | null) => void;
  onStoryPointsChange: (storyPoints: number | null) => void;
}

/**
 * Type-select + parent-picker + points-field for converting an existing work
 * item's type. Mirrors `CreateWorkItemModal`'s create-time fields, sharing
 * the same `getEligibleParentCandidates` / `validateWorkItemTypeFields`
 * helpers (`@/features/kanban/work-item-type-form.helpers`) so create and
 * convert never drift on the parent/points rules.
 */
export function WorkItemTypeFields({
  currentItemId,
  allItems,
  type,
  parentWorkItemId,
  storyPoints,
  errors,
  onTypeChange,
  onParentWorkItemIdChange,
  onStoryPointsChange,
}: Readonly<WorkItemTypeFieldsProps>) {
  const parentCandidates = getEligibleParentCandidates(
    allItems,
    type,
    currentItemId,
  );
  const showPointsField = allowsStoryPoints(type);

  const handleTypeChange = (value: string) => {
    const nextType = value as WorkItemType;
    onTypeChange(nextType);
    // An epic can never have a parent or story points (server-enforced in
    // work-item-invariants.ts); clear both immediately so a hidden/disabled
    // field never carries a stale value into the next save.
    if (nextType === "epic") {
      onParentWorkItemIdChange(null);
      onStoryPointsChange(null);
    }
  };

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="detail-type">Type</Label>
        <select
          id="detail-type"
          className={NATIVE_SELECT_CLASSNAME}
          value={type}
          onChange={(event) => {
            handleTypeChange(event.target.value);
          }}
        >
          {WORK_ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {WORK_ITEM_TYPE_META[t].label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="detail-parent">Parent (optional)</Label>
        <select
          id="detail-parent"
          className={NATIVE_SELECT_CLASSNAME}
          value={parentWorkItemId ?? ""}
          disabled={type === "epic"}
          onChange={(event) => {
            onParentWorkItemIdChange(event.target.value || null);
          }}
        >
          <option value="">No parent</option>
          {parentCandidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
        {errors.parentWorkItemId ? (
          <p className="text-sm text-destructive">{errors.parentWorkItemId}</p>
        ) : null}
      </div>

      {showPointsField ? (
        <div className="space-y-2">
          <Label htmlFor="detail-points">Story points</Label>
          <select
            id="detail-points"
            className={NATIVE_SELECT_CLASSNAME}
            value={storyPoints ?? ""}
            onChange={(event) => {
              onStoryPointsChange(
                event.target.value ? Number(event.target.value) : null,
              );
            }}
          >
            <option value="">--</option>
            {STORY_POINT_VALUES.map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </select>
          {errors.storyPoints ? (
            <p className="text-sm text-destructive">{errors.storyPoints}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

interface WorkItemDependenciesFieldProps {
  dependencyCandidates: WorkItem[];
  dependencyIds: string[];
  error?: string;
  onToggleDependency: (dependencyId: string, checked: boolean) => void;
}

export function WorkItemDependenciesField({
  dependencyCandidates,
  dependencyIds,
  error,
  onToggleDependency,
}: Readonly<WorkItemDependenciesFieldProps>) {
  return (
    <div className="space-y-2">
      <Label>Depends On</Label>
      {dependencyCandidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No other work items available.
        </p>
      ) : (
        <div className="max-h-44 space-y-2 overflow-y-auto rounded border p-2">
          {dependencyCandidates.map((candidate) => {
            const inputId = `dep-${candidate.id}`;
            const checked = dependencyIds.includes(candidate.id);
            return (
              <label
                key={candidate.id}
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-2 rounded p-1 hover:bg-muted"
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  onCheckedChange={(value) => {
                    onToggleDependency(candidate.id, value === true);
                  }}
                />
                <span className="text-sm">{candidate.title}</span>
              </label>
            );
          })}
        </div>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

interface WorkItemEditActionsProps {
  isSaving: boolean;
  hasError: boolean;
  onSave: () => void;
  onCancel: () => void;
}

export function WorkItemEditActions({
  isSaving,
  hasError,
  onSave,
  onCancel,
}: Readonly<WorkItemEditActionsProps>) {
  return (
    <>
      <div className="flex gap-2 pt-2">
        <Button onClick={onSave} disabled={isSaving} size="sm">
          <Save className="mr-1 h-4 w-4" />
          Save
        </Button>
        <Button variant="outline" onClick={onCancel} size="sm">
          <X className="mr-1 h-4 w-4" />
          Cancel
        </Button>
      </div>
      {hasError ? (
        <p className="text-sm text-destructive">
          Failed to save changes. The API endpoint may not be available yet.
        </p>
      ) : null}
    </>
  );
}

interface WorkItemEditContentProps {
  currentItemId: string;
  allItems: WorkItem[];
  title: string;
  description: string;
  priority: string;
  dependencyIds: string[];
  type: WorkItemType;
  parentWorkItemId: string | null;
  storyPoints: number | null;
  errors: Record<string, string>;
  isSaving: boolean;
  hasError: boolean;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onDependencyIdsChange: (value: string[]) => void;
  onTypeChange: (value: WorkItemType) => void;
  onParentWorkItemIdChange: (value: string | null) => void;
  onStoryPointsChange: (value: number | null) => void;
  onSave: () => void;
  onCancel: () => void;
}

/**
 * Composes the edit-mode sections (core fields, type/parent/points,
 * dependencies, save/cancel actions) for the work-item detail sheet.
 * Co-located with the sections it composes so `WorkItemDetailSheetContent.tsx`
 * (the read-only view) doesn't have to carry the edit-form wiring too.
 */
export function WorkItemEditContent({
  currentItemId,
  allItems,
  title,
  description,
  priority,
  dependencyIds,
  type,
  parentWorkItemId,
  storyPoints,
  errors,
  isSaving,
  hasError,
  onTitleChange,
  onDescriptionChange,
  onPriorityChange,
  onDependencyIdsChange,
  onTypeChange,
  onParentWorkItemIdChange,
  onStoryPointsChange,
  onSave,
  onCancel,
}: Readonly<WorkItemEditContentProps>) {
  const dependencyCandidates = allItems
    .filter((item) => item.id !== currentItemId)
    .sort((a, b) => a.title.localeCompare(b.title));

  const toggleDependency = (dependencyId: string, checked: boolean) => {
    if (checked) {
      onDependencyIdsChange(
        Array.from(new Set([...dependencyIds, dependencyId])),
      );
      return;
    }

    onDependencyIdsChange(
      dependencyIds.filter((itemId) => itemId !== dependencyId),
    );
  };

  return (
    <>
      <WorkItemCoreFields
        title={title}
        description={description}
        priority={priority}
        titleError={errors.title}
        priorityError={errors.priority}
        onTitleChange={onTitleChange}
        onDescriptionChange={onDescriptionChange}
        onPriorityChange={onPriorityChange}
      />
      <WorkItemTypeFields
        currentItemId={currentItemId}
        allItems={allItems}
        type={type}
        parentWorkItemId={parentWorkItemId}
        storyPoints={storyPoints}
        errors={errors}
        onTypeChange={onTypeChange}
        onParentWorkItemIdChange={onParentWorkItemIdChange}
        onStoryPointsChange={onStoryPointsChange}
      />
      <WorkItemDependenciesField
        dependencyCandidates={dependencyCandidates}
        dependencyIds={dependencyIds}
        onToggleDependency={toggleDependency}
        error={errors.dependencyIds}
      />
      <WorkItemEditActions
        isSaving={isSaving}
        hasError={hasError}
        onSave={onSave}
        onCancel={onCancel}
      />
    </>
  );
}
