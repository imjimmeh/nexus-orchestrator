import type { ToolSchema } from "./mcp.types.js";

const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "exec",
    description: "Execute a command on the local machine",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        timeout: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "Read a local file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        encoding: { type: "string", enum: ["utf8", "base64"] },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a local file",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mode: { type: "number" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "ls",
    description: "List a local directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
        missing_ok: { type: "boolean" },
      },
      required: ["path"],
    },
  },
  {
    name: "delete",
    description: "Delete a local file or directory",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
      },
      required: ["path"],
    },
  },
];

export function getToolSchemas(): ToolSchema[] {
  return TOOL_SCHEMAS;
}
