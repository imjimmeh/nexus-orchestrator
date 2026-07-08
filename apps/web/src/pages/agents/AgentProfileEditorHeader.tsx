import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentProfileEditorHeaderProps {
  isEditMode: boolean;
  onBack: () => void;
}

export function AgentProfileEditorHeader({
  isEditMode,
  onBack,
}: Readonly<AgentProfileEditorHeaderProps>) {
  return (
    <div className="flex items-center gap-4">
      <Button variant="outline" size="icon" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div>
        <h2 className="text-3xl font-bold tracking-tight">
          {isEditMode ? "Edit Agent Profile" : "Create Agent Profile"}
        </h2>
        <p className="text-muted-foreground">
          {isEditMode
            ? "Update agent configuration"
            : "Configure a new AI agent"}
        </p>
      </div>
    </div>
  );
}
