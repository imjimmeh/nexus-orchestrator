import { ActiveSessionWorkspaceContent } from "./ActiveSessionWorkspaceContent";
import { useActiveSessionWorkspaceViewModel } from "./ActiveSessionWorkspaceViewModel";

export function ActiveSessionWorkspace() {
  const { guard, contentProps } = useActiveSessionWorkspaceViewModel();

  if (guard) {
    return guard;
  }

  if (!contentProps) {
    return null;
  }

  return <ActiveSessionWorkspaceContent {...contentProps} />;
}
