// apps/web/src/pages/scopes/ScopeDetailPage.tsx
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Globe, Building2, MapPin, Users, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScopeNode } from "@/hooks/useScope";
import { useScopeContext } from "@/context/ScopeContext";
import { ScopedDefaultsForm } from "@/components/harnesses/ScopedDefaultsForm";
import { ScopeMembersPanel } from "@/components/scope/ScopeMembersPanel";
import { ConfigOverridesTab } from "./tabs/ConfigOverridesTab";
import { ChildScopesTab } from "./tabs/ChildScopesTab";
import { ScopeAuditTab } from "./tabs/ScopeAuditTab";
import type { ScopeNodeType } from "@/lib/api/client.scope.types";

const TYPE_ICONS: Record<ScopeNodeType, React.ElementType> = {
  platform: Globe,
  org: Building2,
  region: MapPin,
  team: Users,
  project: FolderOpen,
};

const TYPE_LABELS: Record<ScopeNodeType, string> = {
  platform: "Platform",
  org: "Organisation",
  region: "Region",
  team: "Team",
  project: "Project",
};

export function ScopeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") ?? "members";
  const { data: node, isLoading, isError } = useScopeNode(id ?? "");
  const { setActiveScopeNodeId, setScopePath } = useScopeContext();

  if (isLoading) return <p className="p-8 text-muted-foreground">Loading...</p>;
  if (isError || !node) {
    return <p className="p-8 text-destructive">Scope not found.</p>;
  }

  const Icon = TYPE_ICONS[node.type] ?? FolderOpen;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Globe className="h-3.5 w-3.5" />
          <span>{node.slug}</span>
        </div>
        <div className="flex items-center gap-3">
          <Icon className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-2xl font-bold">{node.name}</h1>
          <Badge variant="outline">{TYPE_LABELS[node.type] ?? node.type}</Badge>
          <div className="ml-auto flex items-center gap-2">
            {node.type !== "project" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigate(`/scopes/${node.id}/manage`);
                }}
              >
                Manage hierarchy
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveScopeNodeId(node.id);
                setScopePath([node.name]);
              }}
            >
              Set as Active Scope
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          <TabsTrigger value="members">Members & Roles</TabsTrigger>
          <TabsTrigger value="overrides">Config Overrides</TabsTrigger>
          <TabsTrigger value="ai-defaults">AI Defaults</TabsTrigger>
          <TabsTrigger value="children">Child Scopes</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <ScopeMembersPanel scopeNodeId={node.id} />
        </TabsContent>
        <TabsContent value="overrides">
          <ConfigOverridesTab scopeNodeId={node.id} />
        </TabsContent>
        <TabsContent value="ai-defaults">
          <div className="pt-4">
            <ScopedDefaultsForm scopeNodeId={node.id} />
          </div>
        </TabsContent>
        <TabsContent value="children">
          <ChildScopesTab parentNode={node} />
        </TabsContent>
        <TabsContent value="audit">
          <ScopeAuditTab scopeNodeId={node.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
