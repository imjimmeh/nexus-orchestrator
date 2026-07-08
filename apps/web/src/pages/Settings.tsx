import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cog, GitBranch, MessagesSquare, PlugZap, Users } from "lucide-react";
import { McpServersCard } from "@/pages/settings/McpServersCard";
import { TelegramSettingsCard } from "@/pages/settings/TelegramSettingsCard";
import { AcpServersCard } from "@/pages/settings/AcpServersCard";
import { SystemSettingsCard } from "@/pages/settings/SystemSettingsCard";
import { KanbanSettingsCard } from "@/pages/settings/KanbanSettingsCard";
import { EnforcementModeCard } from "./settings/EnforcementModeCard";
import { FallbackSettingsCard } from "./settings/FallbackSettingsCard";
import { ProviderCooldownPanel } from "@/components/fallback/ProviderCooldownPanel";

export function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Configure Nexus Orchestrator</p>
      </div>

      <Tabs defaultValue="system" className="space-y-6">
        <TabsList>
          <TabsTrigger value="system" className="gap-2">
            <Cog className="h-4 w-4" />
            System
          </TabsTrigger>
          <TabsTrigger value="chat" className="gap-2">
            <MessagesSquare className="h-4 w-4" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="mcp" className="gap-2">
            <PlugZap className="h-4 w-4" />
            MCP Servers
          </TabsTrigger>
          <TabsTrigger value="acp" className="gap-2">
            <Users className="h-4 w-4" />
            ACP Servers
          </TabsTrigger>
          <TabsTrigger value="fallback" className="gap-2">
            <GitBranch className="h-4 w-4" />
            Fallback
          </TabsTrigger>
        </TabsList>

        <TabsContent value="system">
          <div className="space-y-6">
            <SystemSettingsCard />
            <KanbanSettingsCard />
            <EnforcementModeCard />
          </div>
        </TabsContent>
        <TabsContent value="chat">
          <TelegramSettingsCard />
        </TabsContent>
        <TabsContent value="mcp">
          <McpServersCard />
        </TabsContent>
        <TabsContent value="acp">
          <AcpServersCard />
        </TabsContent>
        <TabsContent value="fallback">
          <div className="space-y-6">
            <FallbackSettingsCard />
            <ProviderCooldownPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
