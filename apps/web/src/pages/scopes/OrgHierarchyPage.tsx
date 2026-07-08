// apps/web/src/pages/scopes/OrgHierarchyPage.tsx
import { useParams } from "react-router-dom";
import { OrgHierarchyManager } from "@/components/scope/manage/OrgHierarchyManager";

export function OrgHierarchyPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return <p className="p-8 text-destructive">Scope not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Org hierarchy</h1>
      </div>
      <OrgHierarchyManager rootScopeNodeId={id} />
    </div>
  );
}
