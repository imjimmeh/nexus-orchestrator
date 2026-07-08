import {
  CHARTER_SECTIONS,
  CHARTER_SECTION_TO_CATEGORY,
} from "@nexus/kanban-contracts";
import { CharterCategorySection } from "./CharterCategorySection";
import { GoalsTab } from "./GoalsTab";
import {
  useCharterMemories,
  useCreateCharterMemory,
  useUpdateCharterMemory,
  useDeleteCharterMemory,
} from "@/hooks/useCharterMemories";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CATEGORY_LABELS: Record<string, string> = {
  vision: "Vision",
  requirement: "Requirements",
  constraint: "Constraints",
  do_dont: "Dos & Don'ts",
  non_goal: "Non-Goals",
  success_criteria: "Success Criteria",
  decision: "Decisions",
  preference: "Preferences",
  glossary: "Glossary",
  stakeholder: "Stakeholders",
  open_question: "Open Questions",
};

interface CharterDocumentProps {
  readonly projectId: string;
  readonly onLaunchRefine: () => void;
}

export function CharterDocument({
  projectId,
  onLaunchRefine,
}: Readonly<CharterDocumentProps>) {
  const {
    data: memoriesByCategory,
    isLoading,
    isError,
  } = useCharterMemories(projectId);
  const createMutation = useCreateCharterMemory(projectId);
  const updateMutation = useUpdateCharterMemory(projectId);
  const deleteMutation = useDeleteCharterMemory(projectId);

  const handleAdd = (category: string) => (content: string) => {
    createMutation.mutate(
      { category, content },
      { onError: () => toast.error("Failed to add item") },
    );
  };

  const handleUpdate = (memoryId: string, content: string) => {
    updateMutation.mutate(
      { memoryId, content },
      { onError: () => toast.error("Failed to update item") },
    );
  };

  const handleDelete = (memoryId: string) => {
    deleteMutation.mutate(memoryId, {
      onError: () => toast.error("Failed to delete item"),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-live="polite" aria-busy="true">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">Failed to load charter data.</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onLaunchRefine}>
          Refine Charter
        </Button>
      </div>
      {CHARTER_SECTIONS.map((section) => {
        const category = CHARTER_SECTION_TO_CATEGORY[section];
        if (category === null) {
          return (
            <div key={section}>
              <h2 className="text-xl font-semibold mb-3">{section}</h2>
              <GoalsTab projectId={projectId} />
            </div>
          );
        }
        return (
          <div key={section}>
            <CharterCategorySection
              label={CATEGORY_LABELS[category] ?? section}
              category={category}
              items={memoriesByCategory?.[category] ?? []}
              onAdd={handleAdd(category)}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          </div>
        );
      })}
    </div>
  );
}
