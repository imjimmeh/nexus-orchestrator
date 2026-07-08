import type { ToolComponentType } from "./registry.types";
import { BashTool } from "./BashTool";
import { CommandResultTool } from "./CommandResultTool";
import { DelegateTool } from "./DelegateTool";
import { EditFileTool } from "./EditFileTool";
import { GenericTool } from "./GenericTool";
import { KanbanTool } from "./KanbanTool";
import { ManageTodoListTool } from "./ManageTodoListTool";
import { ReadFileTool } from "./ReadFileTool";
import { WriteFileTool } from "./WriteFileTool";

export type { ToolProps } from "./registry.types";

const exactRegistry: Record<string, ToolComponentType> = {
  bash: BashTool,
  edit_file: EditFileTool,
  manage_todo_list: ManageTodoListTool,
  read_file: ReadFileTool,
  write_file: WriteFileTool,
  ls: CommandResultTool,
  list_dir: CommandResultTool,
  grep: CommandResultTool,
  find: CommandResultTool,
};

/**
 * Harness tool names differ from the canonical registry keys (the harness emits
 * `read`/`write`/`edit`, and capitalised native variants like `Read`/`Bash`).
 * Map those spellings onto a canonical key; lookups are case-insensitive.
 */
const aliasRegistry: Record<string, string> = {
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
  bash: "bash",
};

interface Pattern {
  match: (name: string) => boolean;
  component: ToolComponentType;
}
const patternRegistry: Pattern[] = [
  { match: (n) => n.startsWith("delegate_"), component: DelegateTool },
  { match: (n) => n.startsWith("kanban."), component: KanbanTool },
];

const dynamicEntries = new Map<string, ToolComponentType>();

export function registerToolRenderable(
  toolName: string,
  component: ToolComponentType,
): void {
  dynamicEntries.set(toolName, component);
}

export function resolveTool(toolName: string): ToolComponentType {
  const dynamic = dynamicEntries.get(toolName);
  if (dynamic) return dynamic;
  const exact = exactRegistry[toolName];
  if (exact) return exact;
  const lower = toolName.toLowerCase();
  const aliasTarget = aliasRegistry[toolName] ?? aliasRegistry[lower];
  if (aliasTarget && exactRegistry[aliasTarget]) {
    return exactRegistry[aliasTarget];
  }
  if (exactRegistry[lower]) return exactRegistry[lower];
  const hit = patternRegistry.find((p) => p.match(toolName));
  if (hit) return hit.component;
  return GenericTool;
}

export function registerExactTool(
  toolName: string,
  component: ToolComponentType,
): void {
  exactRegistry[toolName] = component;
}

export function registerPatternTool(
  match: (name: string) => boolean,
  component: ToolComponentType,
): void {
  patternRegistry.push({ match, component });
}

export function resetToolRegistry(): void {
  dynamicEntries.clear();
  for (const key of Object.keys(exactRegistry)) {
    delete exactRegistry[key];
  }
  patternRegistry.length = 0;
}
