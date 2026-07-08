import { ToolsPageView } from "./ToolsPageView";
import { useToolsPageViewModel } from "./ToolsPageView.hooks";

// Not wired to the active app scope (Phase 5 Task 8): tool.controller.ts's
// list endpoint reads from the global `tools` table (tool-registry.entity.ts),
// which has no scope or owner column at all - it is a global tool registry,
// not scope-partitioned.
export function Tools() {
  const model = useToolsPageViewModel();
  return <ToolsPageView {...model} />;
}
