import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReactNode } from "react";

interface AgentProfileEditorTabsProps {
  basicInfo: ReactNode;
  toolsAndSkills: ReactNode;
  systemAndProvenance: ReactNode;
}

export function AgentProfileEditorTabs({
  basicInfo,
  toolsAndSkills,
  systemAndProvenance,
}: AgentProfileEditorTabsProps) {
  return (
    <Tabs defaultValue="basic" className="space-y-6">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="basic">Basic Info</TabsTrigger>
        <TabsTrigger value="tools">Tools & Skills</TabsTrigger>
        <TabsTrigger value="system">System & Provenance</TabsTrigger>
      </TabsList>
      <TabsContent value="basic">{basicInfo}</TabsContent>
      <TabsContent value="tools">{toolsAndSkills}</TabsContent>
      <TabsContent value="system">{systemAndProvenance}</TabsContent>
    </Tabs>
  );
}
