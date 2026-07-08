import { useState } from "react";
import { STORY_POINT_VALUES } from "@nexus/kanban-contracts";
import { WorkItem } from "@/lib/api/work-items.types";

interface StoryPointChipProps {
  readonly item: WorkItem;
  readonly onChange?: (points: number) => void;
  readonly readOnly?: boolean;
}

const CHIP_CLASSNAME =
  "inline-block rounded px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700";

export function StoryPointChip({
  item,
  onChange,
  readOnly = false,
}: Readonly<StoryPointChipProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const isContainer = item.type === "epic" || item.hasChildren === true;

  if (isContainer) {
    return <span className={CHIP_CLASSNAME}>{item.rolledUpPoints ?? 0}</span>;
  }

  if (readOnly) {
    return <span className={CHIP_CLASSNAME}>{item.storyPoints ?? "—"}</span>;
  }

  if (isEditing) {
    return (
      <select
        aria-label="Story points"
        autoFocus
        defaultValue={item.storyPoints ?? ""}
        className={CHIP_CLASSNAME}
        onBlur={() => setIsEditing(false)}
        onChange={(event) => {
          onChange?.(Number(event.target.value));
          setIsEditing(false);
        }}
      >
        <option value="" disabled>
          --
        </option>
        {STORY_POINT_VALUES.map((points) => (
          <option key={points} value={points}>
            {points}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      type="button"
      className={CHIP_CLASSNAME}
      onClick={() => setIsEditing(true)}
    >
      {item.storyPoints ?? "—"}
    </button>
  );
}
