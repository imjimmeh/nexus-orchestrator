import { isRecord } from "./type-guards";
import { type ToolStatus } from "./summarize-tool-call.types";
export type { ToolStatus };

const STATUS_GLYPH: Record<ToolStatus, string> = {
  started: "●",
  updated: "●",
  finished: "✓",
};

function statusGlyph(status: ToolStatus, isError: boolean): string {
  return status === "finished" && isError ? "✗" : STATUS_GLYPH[status];
}

function stringFromRecord(record: unknown, field: string): string | undefined {
  return isRecord(record) && typeof record[field] === "string"
    ? record[field]
    : undefined;
}

function numberFromRecord(record: unknown, field: string): number | undefined {
  return isRecord(record) && typeof record[field] === "number"
    ? record[field]
    : undefined;
}

function countStatus(todos: unknown, status: string): number {
  if (!Array.isArray(todos)) return 0;
  return todos.filter((t) => isRecord(t) && t.status === status).length;
}

function summarizeReadFile(args: unknown): string {
  const path = stringFromRecord(args, "path") ?? "<unknown>";
  const offset = numberFromRecord(args, "offset");
  const limit = numberFromRecord(args, "limit");
  if (typeof offset === "number" && typeof limit === "number") {
    const end = offset + limit;
    return `📄 read ${path}:${offset}-${end}`;
  }
  return `📄 read ${path}`;
}

function summarizeWriteFile(args: unknown): string {
  const path = stringFromRecord(args, "path") ?? "<unknown>";
  return `🗑️ write ${path}`;
}

function countLineDiffs(
  oldLines: string[],
  newLines: string[],
): { added: number; removed: number } {
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const removed = oldLines.filter((l) => !newSet.has(l)).length;
  const added = newLines.filter((l) => !oldSet.has(l)).length;
  return { added, removed };
}

function editStrings(args: unknown): { oldStr: string; newStr: string } {
  if (isRecord(args) && Array.isArray(args.edits)) {
    const edits = args.edits.filter(isRecord);
    return {
      oldStr: edits.map((e) => stringFromRecord(e, "oldText") ?? "").join("\n"),
      newStr: edits.map((e) => stringFromRecord(e, "newText") ?? "").join("\n"),
    };
  }
  return {
    oldStr: stringFromRecord(args, "oldString") ?? "",
    newStr: stringFromRecord(args, "newString") ?? "",
  };
}

function summarizeEditFile(args: unknown): string {
  const path = stringFromRecord(args, "path") ?? "<unknown>";
  const { oldStr, newStr } = editStrings(args);
  const oldLines = oldStr ? oldStr.split("\n") : [];
  const newLines = newStr ? newStr.split("\n") : [];
  const { added, removed } = countLineDiffs(oldLines, newLines);
  return `✏️ edit ${path} +${added}/-${removed}`;
}

function summarizeBash(args: unknown): string {
  const cmd = stringFromRecord(args, "command") ?? "";
  const truncated = cmd.length > 60 ? `${cmd.slice(0, 60)}…` : cmd;
  return `$ ${truncated}`;
}

function summarizeTodoList(args: unknown): string {
  const todos = isRecord(args) ? (args.todo_list ?? args.todos) : undefined;
  const total = Array.isArray(todos) ? todos.length : 0;
  const done = countStatus(todos, "completed");
  return `☑ todos ${total} items (✓ ${done} done)`;
}

function summarizeDelegate(toolName: string): string {
  const suffix = toolName.slice("delegate_".length).replace(/_/g, " ");
  const label = suffix
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `🤝 delegate ${label}`;
}

const NAME_ALIASES: Record<string, string> = {
  read: "read_file",
  write: "write_file",
  edit: "edit_file",
};

function canonicalToolName(toolName: string): string {
  const lower = toolName.toLowerCase();
  return NAME_ALIASES[lower] ?? lower;
}

function summarizeArgs(toolName: string, args: unknown): string {
  const canonical = canonicalToolName(toolName);
  if (canonical === "read_file") return summarizeReadFile(args);
  if (canonical === "write_file") return summarizeWriteFile(args);
  if (canonical === "edit_file") return summarizeEditFile(args);
  if (canonical === "bash") return summarizeBash(args);
  if (canonical === "manage_todo_list") return summarizeTodoList(args);
  if (toolName.startsWith("delegate_")) return summarizeDelegate(toolName);
  return toolName;
}

export function summarizeToolCall(
  toolName: string,
  args: unknown,
  status: ToolStatus,
  isError: boolean,
): string {
  return `${summarizeArgs(toolName, args)} · ${statusGlyph(status, isError)}`;
}
