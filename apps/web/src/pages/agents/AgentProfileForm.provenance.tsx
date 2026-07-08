import { FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AgentProfile } from "@/lib/api/agents.types";

function formatSource(source: AgentProfile["source"]): string {
  if (source === "seeded") {
    return "Seeded";
  }
  if (source === "agent_factory") {
    return "Agent Factory";
  }
  return "Admin";
}

function formatFactoryContext(
  context: AgentProfile["factory_context"],
): string {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return "-";
  }
  return JSON.stringify(context, null, 2);
}

export function AgentProfileProvenance({
  profile,
}: Readonly<{ profile: AgentProfile }>) {
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h4 className="text-sm font-medium">Provenance</h4>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <FormLabel>Source</FormLabel>
          <Input value={formatSource(profile.source)} readOnly />
        </div>
        <div className="space-y-2">
          <FormLabel>Created By Profile</FormLabel>
          <Input value={profile.created_by_profile ?? "-"} readOnly />
        </div>
        <div className="space-y-2">
          <FormLabel>Workflow Run ID</FormLabel>
          <Input value={profile.created_by_workflow_run_id ?? "-"} readOnly />
        </div>
      </div>
      <div className="space-y-2">
        <FormLabel>Factory Context</FormLabel>
        <Textarea
          value={formatFactoryContext(profile.factory_context)}
          className="min-h-[120px] font-mono text-xs"
          readOnly
        />
      </div>
    </div>
  );
}
