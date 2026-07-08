// apps/web/src/pages/scopes/tabs/ConfigOverridesTab.tsx
import { ScopedConfigViewer } from "@/pages/admin/ScopedConfigViewer";

interface ConfigOverridesTabProps {
  scopeNodeId: string;
}

export function ConfigOverridesTab({ scopeNodeId }: ConfigOverridesTabProps) {
  return (
    <div className="pt-4">
      <ScopedConfigViewer presetScopeNodeId={scopeNodeId} />
    </div>
  );
}
