import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { PlusCircle, Rocket, Search } from "lucide-react";
import { useProjectList } from "@/hooks/useProjects";
import { useWorkflows } from "@/hooks/useWorkflows";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NAV_GROUPS } from "./navigation.config";
import { useKeyboardShortcuts } from "./KeyboardShortcutsProvider";

interface CommandAction {
  id: string;
  label: string;
  category: "Pages" | "Projects" | "Workflows" | "Actions";
  keywords: string[];
  onSelect: () => void;
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { isCommandPaletteOpen, setCommandPaletteOpen } =
    useKeyboardShortcuts();
  const { data: projects = [] } = useProjectList();
  const { data: workflows = [] } = useWorkflows();

  const actions = useMemo<CommandAction[]>(() => {
    const pageActions: CommandAction[] = NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => ({
        id: `page:${item.path}`,
        label: item.label,
        category: "Pages",
        keywords: [item.path, group.title],
        onSelect: () => {
          navigate(item.path);
          setCommandPaletteOpen(false);
        },
      })),
    );

    const projectActions: CommandAction[] = projects.map((project) => ({
      id: `project:${project.id}`,
      label: project.name,
      category: "Projects",
      keywords: [project.id, project.description ?? ""],
      onSelect: () => {
        navigate(`/projects/${project.id}`);
        setCommandPaletteOpen(false);
      },
    }));

    const workflowActions: CommandAction[] = workflows.map((workflow) => ({
      id: `workflow:${workflow.id}`,
      label: workflow.name,
      category: "Workflows",
      keywords: [workflow.id],
      onSelect: () => {
        navigate(`/workflows/${workflow.id}`);
        setCommandPaletteOpen(false);
      },
    }));

    const quickActions: CommandAction[] = [
      {
        id: "action:create-project",
        label: "Create Project",
        category: "Actions",
        keywords: ["new", "project"],
        onSelect: () => {
          navigate("/projects/new");
          setCommandPaletteOpen(false);
        },
      },
      {
        id: "action:start-workflow",
        label: "Open Workflows",
        category: "Actions",
        keywords: ["run", "workflow"],
        onSelect: () => {
          navigate("/workflows");
          setCommandPaletteOpen(false);
        },
      },
    ];

    return [
      ...quickActions,
      ...pageActions,
      ...projectActions,
      ...workflowActions,
    ];
  }, [navigate, projects, setCommandPaletteOpen, workflows]);

  const categories: Array<CommandAction["category"]> = [
    "Actions",
    "Pages",
    "Projects",
    "Workflows",
  ];

  return (
    <Dialog open={isCommandPaletteOpen} onOpenChange={setCommandPaletteOpen}>
      <DialogContent className="max-w-2xl p-0">
        <Command
          className="rounded-lg border-0 bg-card text-card-foreground"
          label="Global Command Palette"
        >
          <div className="flex items-center gap-2 border-b px-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Command.Input
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search pages, projects, workflows..."
            />
          </div>
          <Command.List className="max-h-[420px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching result.
            </Command.Empty>
            {categories.map((category) => {
              const entries = actions.filter(
                (entry) => entry.category === category,
              );
              if (entries.length === 0) {
                return null;
              }

              return (
                <Command.Group
                  key={category}
                  heading={category}
                  className="mb-2 text-xs text-muted-foreground"
                >
                  {entries.map((entry) => (
                    <Command.Item
                      key={entry.id}
                      value={`${entry.label} ${entry.keywords.join(" ")}`}
                      onSelect={entry.onSelect}
                      className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm aria-selected:bg-primary aria-selected:text-primary-foreground"
                    >
                      <span>{entry.label}</span>
                      {entry.category === "Actions" && (
                        <span className="text-muted-foreground aria-selected:text-primary-foreground">
                          {entry.id.includes("project") ? (
                            <PlusCircle className="h-4 w-4" />
                          ) : (
                            <Rocket className="h-4 w-4" />
                          )}
                        </span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
