export const SDK_NATIVE_SUBAGENT_TOOLS: string[] = [
  'bash',
  'edit',
  'find',
  'grep',
  'ls',
  'read',
  'write',
];

export function mergeSdkNativeToolsForSubagent(tools: string[]): string[] {
  const input = Array.isArray(tools) ? tools : [];
  const merged = new Set<string>([...SDK_NATIVE_SUBAGENT_TOOLS, ...input]);
  return [...merged].sort();
}
